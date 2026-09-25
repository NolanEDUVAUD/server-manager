/// Commandes Tauri — CRUD des serveurs
use tauri::{Manager, State};

use crate::{
    crypto,
    models::{AppData, Server, ServerPayload},
    storage::AppState,
};

// ── Récupérer tous les serveurs ────────────────────────────────────────────
#[tauri::command]
pub fn get_servers(state: State<AppState>) -> Result<Vec<Server>, String> {
    let data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.servers.clone())
}

// ── Ajouter un serveur ────────────────────────────────────────────────────
#[tauri::command]
pub fn add_server(state: State<AppState>, payload: ServerPayload) -> Result<Server, String> {
    validate_server_payload(&payload)?;

    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    // Chiffrer le mot de passe avant stockage
    let key = crypto::data_key(&data)?;
    let encrypted_password = crypto::encrypt(&payload.ssh_password, &key)?;

    let mut server = Server::new(
        payload.name,
        payload.ip,
        payload.mac_address,
        payload.ssh_user,
        encrypted_password,
        payload.ssh_port,
        payload.os_type,
        payload.icon,
        payload.notes,
    );

    // Appliquer les commandes personnalisées si renseignées
    if let Some(cmd) = payload.shutdown_command {
        if !cmd.trim().is_empty() {
            server.shutdown_command = cmd;
        }
    }
    if let Some(cmd) = payload.reboot_command {
        if !cmd.trim().is_empty() {
            server.reboot_command = cmd;
        }
    }

    data.servers.push(server.clone());
    drop(data);

    state.save()?;
    log::info!("Serveur ajouté : {} ({})", server.name, server.ip);
    Ok(server)
}

// ── Modifier un serveur ───────────────────────────────────────────────────
#[tauri::command]
pub fn update_server(
    state: State<AppState>,
    id: String,
    payload: ServerPayload,
) -> Result<Server, String> {
    validate_server_payload(&payload)?;

    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    // Extraire le salt avant le borrow mutable sur servers
    let encrypted_password = if !payload.ssh_password.is_empty() {
        let key = crypto::data_key(&data)?;
        Some(crypto::encrypt(&payload.ssh_password, &key)?)
    } else {
        None
    };

    let server = data
        .servers
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Serveur introuvable: {}", id))?;

    // Rechiffrer le mot de passe uniquement s'il a changé (non vide)
    if let Some(enc) = encrypted_password {
        server.ssh_password = enc;
    }

    server.name = payload.name;
    server.ip = payload.ip;
    server.mac_address = payload.mac_address;
    server.ssh_user = payload.ssh_user;
    server.ssh_port = payload.ssh_port;
    server.os_type = payload.os_type.clone();
    server.icon = payload.icon;
    server.notes = payload.notes;

    // Commandes : garder les commandes par défaut si champ vide
    server.shutdown_command = payload
        .shutdown_command
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| payload.os_type.default_shutdown_command().to_string());

    server.reboot_command = payload
        .reboot_command
        .filter(|c| !c.trim().is_empty())
        .unwrap_or_else(|| payload.os_type.default_reboot_command().to_string());

    let updated = server.clone();
    drop(data);

    state.save()?;
    log::info!("Serveur mis à jour : {} ({})", updated.name, updated.ip);
    Ok(updated)
}

// ── Supprimer un serveur ──────────────────────────────────────────────────
#[tauri::command]
pub fn delete_server(state: State<AppState>, id: String) -> Result<(), String> {
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    let len_before = data.servers.len();
    data.servers.retain(|s| s.id != id);

    if data.servers.len() == len_before {
        return Err(format!("Serveur introuvable: {}", id));
    }

    // Retirer le serveur de tous les groupes
    for group in data.groups.iter_mut() {
        group.server_ids.retain(|sid| sid != &id);
    }

    drop(data);
    state.save()?;
    log::info!("Serveur supprimé : {}", id);
    Ok(())
}

// ── Décrypter le mot de passe d'un serveur (usage SSH) ───────────────────
pub fn get_decrypted_password(data: &AppData, server_id: &str) -> Result<String, String> {
    let server = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;

    let key = crypto::data_key(&data)?;
    crypto::decrypt(&server.ssh_password, &key)
}

// ── Téléverser une icône personnalisée pour un serveur ────────────────────
#[tauri::command]
pub async fn upload_server_icon(
    server_id: String,
    file_path: String,
    state: tauri::State<'_, crate::storage::AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let src = std::path::Path::new(&file_path);
    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    if ext != "png" && ext != "svg" {
        return Err("Seuls les fichiers PNG et SVG sont acceptés".to_string());
    }
    let icons_dir = app.path().app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?
        .join("icons");
    std::fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;
    let file_name = format!("{}.{}", server_id, ext);
    let dest = icons_dir.join(&file_name);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    if let Some(srv) = data.servers.iter_mut().find(|s| s.id == server_id) {
        srv.icon = Some(format!("file:{}", file_name));
    }
    drop(data);
    state.save()?;
    Ok(file_name)
}

// ── Validation des données d'un serveur ───────────────────────────────────
fn validate_server_payload(p: &ServerPayload) -> Result<(), String> {
    if p.name.trim().is_empty() {
        return Err("Le nom du serveur est requis".to_string());
    }
    if !is_valid_ip(&p.ip) {
        return Err(format!("Adresse IP invalide: {}", p.ip));
    }
    if !p.mac_address.is_empty() && !is_valid_mac(&p.mac_address) {
        return Err(format!("Adresse MAC invalide: {}", p.mac_address));
    }
    if p.ssh_port == 0 {
        return Err("Port SSH invalide (doit être entre 1 et 65535)".to_string());
    }
    Ok(())
}

fn is_valid_ip(ip: &str) -> bool {
    ip.parse::<std::net::Ipv4Addr>().is_ok()
}

fn is_valid_mac(mac: &str) -> bool {
    let parts: Vec<&str> = mac.split(':').collect();
    parts.len() == 6 && parts.iter().all(|p| p.len() == 2 && u8::from_str_radix(p, 16).is_ok())
}
