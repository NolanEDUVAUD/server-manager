/// Commandes Tauri — Clés SSH (1.2) : liste, génération, import, renommage, suppression,
/// déploiement sur un serveur et état de l'agent SSH. La clé privée ne quitte jamais le backend.
use serde::Serialize;
use std::io::Read;
use std::sync::Mutex;
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    commands::{
        servers::without_secret,
        ssh::{connect_ssh, execute_ssh},
    },
    crypto,
    models::{AuthMethod, Server},
    ssh_agent::{self, AgentStatus},
    ssh_auth::{resolve_ssh, SshAuth},
    ssh_keys::{self, KeyError, KeyFileInfo, SshKeyView, DEPLOY_ADDED, DEPLOY_PRESENT, MAX_KEYS, MAX_KEY_FILE_BYTES},
    storage::AppState,
};

/// Fichier de clé choisi dans la boîte de dialogue, en attente du nom et de la phrase de passe.
/// Garder le contenu ici permet de corriger une phrase de passe sans rouvrir le fichier.
#[derive(Default)]
pub struct KeyImportState(Mutex<Option<Zeroizing<String>>>);

#[derive(Debug, Serialize)]
pub struct DeployReport {
    /// La ligne a été ajoutée (false : elle était déjà présente)
    pub added: bool,
    /// Une nouvelle connexion avec la clé a réussi
    pub verified: bool,
    /// Raison de l'échec de la vérification
    pub detail: Option<String>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[tauri::command]
pub fn ssh_keys_list(state: State<AppState>) -> Result<Vec<SshKeyView>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.ssh_keys.iter().map(SshKeyView::from).collect())
}

/// Enregistre une clé déchiffrée : nom validé, clé privée chiffrée par la clé maître
fn store_key(state: &AppState, name: &str, key: russh::keys::PrivateKey) -> Result<SshKeyView, String> {
    let prepared = ssh_keys::prepare(key)?;
    let view = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        if data.ssh_keys.len() >= MAX_KEYS {
            return Err(format!("{} clés au plus", MAX_KEYS));
        }
        let name = ssh_keys::validate_name(name, &data.ssh_keys, None)?;
        if let Some(twin) = data.ssh_keys.iter().find(|k| k.fingerprint == prepared.fingerprint) {
            return Err(format!("Cette clé est déjà enregistrée sous le nom « {} »", twin.name));
        }
        let master = crypto::data_key(&data)?;
        let key = ssh_keys::seal(Uuid::new_v4().to_string(), name, &prepared, &master, now_ms())?;
        let view = SshKeyView::from(&key);
        data.ssh_keys.push(key);
        view
    };
    state.save()?;
    log::info!("Clé SSH enregistrée : {} ({})", view.name, view.fingerprint);
    Ok(view)
}

/// Nouvelle paire ed25519 générée dans l'app
#[tauri::command]
pub fn ssh_key_generate(state: State<AppState>, name: String) -> Result<SshKeyView, String> {
    crypto::ensure_unlocked()?;
    {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        ssh_keys::validate_name(&name, &data.ssh_keys, None)?;
    }
    let key = ssh_keys::generate_ed25519(&format!("server-manager {}", name.trim()))?;
    store_key(&state, &name, key)
}

/// Lit un fichier de clé d'au plus 64 Kio, directement dans un Zeroizing
fn read_key_file(path: &std::path::Path) -> Result<Zeroizing<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Lecture du fichier impossible : {}", e))?;
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if len > MAX_KEY_FILE_BYTES as u64 {
        return Err(KeyError::TooLarge.into());
    }
    let mut bytes = Zeroizing::new(Vec::with_capacity(len as usize + 1));
    file.take(MAX_KEY_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Lecture du fichier impossible : {}", e))?;
    if bytes.len() > MAX_KEY_FILE_BYTES {
        return Err(KeyError::TooLarge.into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Ce fichier n'est pas une clé SSH (contenu binaire)".to_string())?;
    Ok(Zeroizing::new(text.to_string()))
}

/// Ouvre la boîte de dialogue native (côté Rust : le chemin ne vient jamais du webview), lit le
/// fichier et renvoie ce qu'on peut en dire sans phrase de passe. `None` si l'utilisateur annule.
#[tauri::command]
pub async fn ssh_key_import_pick(
    app: tauri::AppHandle,
    imports: State<'_, KeyImportState>,
) -> Result<Option<KeyFileInfo>, String> {
    crypto::ensure_unlocked()?;
    let picked = app.dialog().file().set_title("Importer une clé SSH privée (OpenSSH ou PuTTY .ppk)").blocking_pick_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let content = read_key_file(&path)?;
    let file_name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let info = ssh_keys::inspect(&file_name, &content)?;
    *imports.0.lock().map_err(|e| format!("Erreur mutex: {}", e))? = Some(content);
    Ok(Some(info))
}

/// Déchiffre (si besoin) et enregistre la clé choisie par `ssh_key_import_pick`.
/// En cas de phrase de passe absente ou incorrecte, le fichier reste en attente pour réessayer.
#[tauri::command]
pub fn ssh_key_import(
    state: State<AppState>,
    imports: State<KeyImportState>,
    name: String,
    passphrase: Option<Zeroizing<String>>,
) -> Result<SshKeyView, String> {
    crypto::ensure_unlocked()?;
    let key = {
        let pending = imports.0.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let content = pending.as_ref().ok_or("Aucun fichier de clé choisi")?;
        ssh_keys::parse_private_key(content, passphrase.as_deref().map(String::as_str))?
    };
    let view = store_key(&state, &name, key)?;
    *imports.0.lock().map_err(|e| format!("Erreur mutex: {}", e))? = None;
    Ok(view)
}

/// Oublie le fichier en attente (le contenu est effacé de la mémoire)
#[tauri::command]
pub fn ssh_key_import_cancel(imports: State<KeyImportState>) -> Result<(), String> {
    *imports.0.lock().map_err(|e| format!("Erreur mutex: {}", e))? = None;
    Ok(())
}

#[tauri::command]
pub fn ssh_key_rename(state: State<AppState>, id: String, name: String) -> Result<SshKeyView, String> {
    let view = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let name = ssh_keys::validate_name(&name, &data.ssh_keys, Some(&id))?;
        let key = data.ssh_keys.iter_mut().find(|k| k.id == id).ok_or("Clé SSH introuvable")?;
        key.name = name;
        SshKeyView::from(&*key)
    };
    state.save()?;
    Ok(view)
}

/// Supprime une clé ; refusé tant qu'un serveur s'authentifie avec elle
#[tauri::command]
pub fn ssh_key_delete(state: State<AppState>, id: String) -> Result<(), String> {
    crypto::ensure_unlocked()?;
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let users = ssh_keys::key_users(&data, &id);
        if !users.is_empty() {
            return Err(format!(
                "Clé utilisée par {} : choisis une autre méthode d'authentification pour ces serveurs avant de la supprimer",
                users.join(", ")
            ));
        }
        let before = data.ssh_keys.len();
        data.ssh_keys.retain(|k| k.id != id);
        if data.ssh_keys.len() == before {
            return Err("Clé SSH introuvable".into());
        }
        // Références restées sur des serveurs qui utilisent une autre méthode
        for s in data.servers.iter_mut().filter(|s| s.ssh_key_id.as_deref() == Some(id.as_str())) {
            s.ssh_key_id = None;
        }
    }
    state.save()?;
    log::info!("Clé SSH supprimée : {}", id);
    Ok(())
}

/// Ajoute la clé publique à ~/.ssh/authorized_keys du serveur (via sa méthode d'authentification
/// actuelle), puis vérifie qu'une connexion par clé fonctionne.
#[tauri::command]
pub async fn ssh_key_deploy(state: State<'_, AppState>, server_id: String, key_id: String) -> Result<DeployReport, String> {
    crypto::ensure_unlocked()?;
    let (target, key_target, public_line, timeout, name) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        ssh_keys::deploy_supported(&server.os_type)?;
        let key = data.ssh_keys.iter().find(|k| k.id == key_id).ok_or("Clé SSH introuvable")?;
        let target = resolve_ssh(&data, &server_id)?;
        let master = crypto::data_key(&data)?;
        let key_target = target.with_auth(SshAuth::Key(ssh_keys::decrypt_private_key(key, &master)?));
        (target, key_target, key.public_key.clone(), data.settings.network.ssh_timeout_secs, server.name.clone())
    };
    let command = ssh_keys::deploy_command(&public_line)?;
    log::info!("Déploiement de la clé SSH sur {} ({}:{})", name, target.host, target.port);
    let result = execute_ssh(&target, &command, timeout).await?;
    drop(target);
    let added = if result.output.contains(DEPLOY_ADDED) {
        true
    } else if result.output.contains(DEPLOY_PRESENT) {
        false
    } else {
        let why = result.error.map(|e| format!("{} — {}", e, result.output)).unwrap_or(result.output);
        return Err(format!("Déploiement de la clé échoué sur {} : {}", name, why));
    };
    let verified = connect_ssh(&key_target, timeout).await.map(drop);
    Ok(DeployReport { added, verified: verified.is_ok(), detail: verified.err() })
}

/// Bascule un serveur sur une clé de l'app, en effaçant éventuellement son mot de passe enregistré
#[tauri::command]
pub fn ssh_key_use_for_server(
    state: State<AppState>,
    server_id: String,
    key_id: String,
    clear_password: bool,
) -> Result<Server, String> {
    crypto::ensure_unlocked()?;
    let view = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        if !data.ssh_keys.iter().any(|k| k.id == key_id) {
            return Err("Clé SSH introuvable".into());
        }
        let server = data
            .servers
            .iter_mut()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        server.auth_method = AuthMethod::Key;
        server.ssh_key_id = Some(key_id);
        if clear_password {
            server.ssh_password = String::new();
        }
        without_secret(server)
    };
    state.save()?;
    log::info!("{} utilise désormais une clé SSH de l'app", view.name);
    Ok(view)
}

/// Agents SSH joignables et clés proposées (publiques uniquement)
#[tauri::command]
pub async fn ssh_agent_status() -> Result<AgentStatus, String> {
    Ok(ssh_agent::status().await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_file_reading_is_bounded() {
        let dir = std::env::temp_dir().join(format!("spm-keyfile-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big");
        std::fs::write(&big, vec![b'A'; MAX_KEY_FILE_BYTES + 1]).unwrap();
        assert!(read_key_file(&big).unwrap_err().contains("64 Kio"));
        let binary = dir.join("bin");
        std::fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_key_file(&binary).unwrap_err().contains("binaire"));
        let ok = dir.join("id_ed25519");
        std::fs::write(&ok, "-----BEGIN OPENSSH PRIVATE KEY-----\n").unwrap();
        assert!(read_key_file(&ok).unwrap().starts_with("-----BEGIN"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
