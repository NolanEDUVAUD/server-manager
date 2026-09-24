/// Commandes Tauri — Connexions Proxmox et opérations VM/LXC
use tauri::State;

use crate::{
    crypto,
    models::AppData,
    proxmox::{
        client::ProxmoxClient,
        models::{ProxmoxConnection, ProxmoxConnectionPayload},
    },
    storage::AppState,
};

fn validate_connection_payload(p: &ProxmoxConnectionPayload) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("Le nom de la connexion est requis".to_string());
    }
    if !p.api_url.starts_with("http://") && !p.api_url.starts_with("https://") {
        return Err("L'URL de l'API doit commencer par http:// ou https://".to_string());
    }
    if p.token_id.trim().is_empty() {
        return Err("Le token ID est requis (format: user@realm!tokenid)".to_string());
    }
    Ok(())
}

/// Construit un client Proxmox pour une connexion sauvegardée (secret déchiffré)
pub fn build_client(data: &AppData, connection_id: &str) -> Result<ProxmoxClient, String> {
    let conn = data
        .proxmox_connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connexion Proxmox introuvable: {}", connection_id))?;
    let key = crypto::derive_key(&data.encryption_salt);
    let secret = crypto::decrypt(&conn.token_secret, &key)?;
    ProxmoxClient::new(
        &conn.api_url,
        &conn.token_id,
        &secret,
        conn.verify_tls,
        data.settings.network.proxmox_timeout_secs,
    )
}

fn without_secret(c: ProxmoxConnection) -> ProxmoxConnection {
    ProxmoxConnection { token_secret: String::new(), ..c }
}

#[tauri::command]
pub fn proxmox_list_connections(state: State<AppState>) -> Result<Vec<ProxmoxConnection>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.proxmox_connections.iter().cloned().map(without_secret).collect())
}

#[tauri::command]
pub fn proxmox_add_connection(
    state: State<AppState>,
    payload: ProxmoxConnectionPayload,
) -> Result<ProxmoxConnection, String> {
    validate_connection_payload(&payload)?;

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let key = crypto::derive_key(&data.encryption_salt);
    let encrypted_secret = crypto::encrypt(&payload.token_secret, &key)?;

    let connection = ProxmoxConnection::new(
        payload.name,
        payload.api_url,
        payload.token_id,
        encrypted_secret,
        payload.verify_tls,
    );
    data.proxmox_connections.push(connection.clone());
    drop(data);

    state.save()?;
    log::info!("Connexion Proxmox ajoutée : {}", connection.name);
    Ok(without_secret(connection))
}

#[tauri::command]
pub fn proxmox_update_connection(
    state: State<AppState>,
    id: String,
    payload: ProxmoxConnectionPayload,
) -> Result<ProxmoxConnection, String> {
    validate_connection_payload(&payload)?;

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let encrypted_secret = if !payload.token_secret.is_empty() {
        let key = crypto::derive_key(&data.encryption_salt);
        Some(crypto::encrypt(&payload.token_secret, &key)?)
    } else {
        None
    };

    let conn = data
        .proxmox_connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connexion introuvable: {}", id))?;

    if let Some(enc) = encrypted_secret {
        conn.token_secret = enc;
    }
    conn.name = payload.name;
    conn.api_url = payload.api_url;
    conn.token_id = payload.token_id;
    conn.verify_tls = payload.verify_tls;

    let updated = conn.clone();
    drop(data);
    state.save()?;
    log::info!("Connexion Proxmox mise à jour : {}", updated.name);
    Ok(without_secret(updated))
}

#[tauri::command]
pub fn proxmox_delete_connection(state: State<AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let len_before = data.proxmox_connections.len();
    data.proxmox_connections.retain(|c| c.id != id);
    if data.proxmox_connections.len() == len_before {
        return Err(format!("Connexion introuvable: {}", id));
    }
    drop(data);
    state.save()?;
    log::info!("Connexion Proxmox supprimée : {}", id);
    Ok(())
}

#[tauri::command]
pub async fn proxmox_test_connection(
    state: State<'_, AppState>,
    payload: ProxmoxConnectionPayload,
) -> Result<(), String> {
    validate_connection_payload(&payload)?;
    let timeout = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.settings.network.proxmox_timeout_secs
    };
    let client = ProxmoxClient::new(
        &payload.api_url,
        &payload.token_id,
        &payload.token_secret,
        payload.verify_tls,
        timeout,
    )?;
    client.test_connection().await
}
