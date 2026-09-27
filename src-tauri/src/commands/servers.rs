/// Commandes Tauri — CRUD des serveurs
use tauri::{Manager, State};

use crate::{
    crypto,
    models::{AppData, AuthMethod, Server, ServerPayload},
    organisation::ServerOrganisation,
    ssh_auth::{check_jump, jump_dependents},
    storage::AppState,
};

// ── Récupérer tous les serveurs ────────────────────────────────────────────
#[tauri::command]
pub fn get_servers(state: State<AppState>) -> Result<Vec<Server>, String> {
    let data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.servers.iter().map(without_secret).collect())
}

/// Copie envoyée au frontend : le mot de passe (même chiffré) reste côté Rust
pub(crate) fn without_secret(s: &Server) -> Server {
    Server { ssh_password: String::new(), ..s.clone() }
}

// ── Ajouter un serveur ────────────────────────────────────────────────────
#[tauri::command]
pub fn add_server(state: State<AppState>, payload: ServerPayload) -> Result<Server, String> {
    validate_server_payload(&payload)?;

    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    // Organisation (tags, dossier, favori, champs personnalisés), validée avant tout ajout
    let organisation = ServerOrganisation::from_payload(&data, &payload)?;

    // Chiffrer le mot de passe avant stockage
    let key = crypto::data_key(&data)?;
    let encrypted_password = crypto::encrypt(&payload.ssh_password, &key)?;
    let auth = auth_update(&data, "", AuthMethod::Password, &payload)?;

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
    organisation.apply(&mut server);
    if let Some(auth) = auth {
        auth.apply(&mut server, payload.clear_password);
    }

    data.servers.push(server.clone());
    drop(data);

    state.save()?;
    log::info!("Serveur ajouté : {} ({})", server.name, server.ip);
    Ok(without_secret(&server))
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
    // Organisation validée avant toute modification (None = champ inchangé)
    let organisation = ServerOrganisation::from_payload(&data, &payload)?;

    // Extraire le salt avant le borrow mutable sur servers
    let encrypted_password = if !payload.ssh_password.is_empty() {
        let key = crypto::data_key(&data)?;
        Some(crypto::encrypt(&payload.ssh_password, &key)?)
    } else {
        None
    };
    let current_method = data.servers.iter().find(|s| s.id == id).map(|s| s.auth_method).unwrap_or_default();
    let auth = auth_update(&data, &id, current_method, &payload)?;

    let server = data
        .servers
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Serveur introuvable: {}", id))?;

    // Rechiffrer le mot de passe uniquement s'il a changé (non vide)
    if let Some(enc) = encrypted_password {
        server.ssh_password = enc;
    }
    if let Some(auth) = auth {
        auth.apply(server, payload.clear_password);
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
    organisation.apply(server);

    let updated = server.clone();
    drop(data);

    state.save()?;
    log::info!("Serveur mis à jour : {} ({})", updated.name, updated.ip);
    Ok(without_secret(&updated))
}

// ── Supprimer un serveur ──────────────────────────────────────────────────
#[tauri::command]
pub fn delete_server(state: State<AppState>, id: String) -> Result<(), String> {
    let mut data = state
        .data
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    // Un rebond supprimé couperait l'accès aux serveurs qui passent par lui
    let dependents = jump_dependents(&data, &id);
    if !dependents.is_empty() {
        return Err(format!(
            "Ce serveur sert d'hôte de rebond à {} : choisis un autre rebond (ou la connexion directe) pour eux avant de le supprimer",
            dependents.join(", ")
        ));
    }

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

// ── Authentification SSH (1.2) : méthode, clé et rebond ───────────────────

/// Partie « authentification » d'un payload, validée
#[derive(Debug, PartialEq)]
pub(crate) struct AuthUpdate {
    method: AuthMethod,
    key_id: Option<String>,
    jump_id: Option<String>,
}

impl AuthUpdate {
    fn apply(self, server: &mut Server, clear_password: bool) {
        server.auth_method = self.method;
        server.ssh_key_id = self.key_id;
        server.jump_host_id = self.jump_id;
        if clear_password {
            server.ssh_password = String::new();
        }
    }
}

fn non_empty(v: &Option<String>) -> Option<String> {
    v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// Valide méthode, clé et rebond. `None` : payload sans `auth_method` (ancien écran), rien ne change.
/// `server_id` est vide pour un nouveau serveur.
pub(crate) fn auth_update(
    data: &AppData,
    server_id: &str,
    current: AuthMethod,
    payload: &ServerPayload,
) -> Result<Option<AuthUpdate>, String> {
    let Some(method) = payload.auth_method else {
        if payload.clear_password && current == AuthMethod::Password {
            return Err("Impossible d'effacer le mot de passe d'un serveur qui s'authentifie par mot de passe".into());
        }
        return Ok(None);
    };
    if payload.clear_password && method == AuthMethod::Password {
        return Err("Impossible d'effacer le mot de passe d'un serveur qui s'authentifie par mot de passe".into());
    }
    let key_id = non_empty(&payload.ssh_key_id);
    if method == AuthMethod::Key {
        let id = key_id.as_deref().ok_or("Choisis la clé SSH à utiliser (Paramètres → Clés SSH pour en créer une)")?;
        if !data.ssh_keys.iter().any(|k| k.id == id) {
            return Err("La clé SSH choisie n'existe plus".into());
        }
    }
    let jump_id = non_empty(&payload.jump_host_id);
    if let Some(jump) = jump_id.as_deref() {
        check_jump(data, server_id, payload.name.trim(), jump)?;
        let dependents = if server_id.is_empty() { Vec::new() } else { jump_dependents(data, server_id) };
        if !dependents.is_empty() {
            return Err(format!(
                "{} sert d'hôte de rebond à {} : il ne peut pas passer lui-même par un rebond (un seul niveau)",
                payload.name.trim(),
                dependents.join(", ")
            ));
        }
    }
    Ok(Some(AuthUpdate { method, key_id, jump_id }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_auth::tests::server;

    fn payload(method: Option<AuthMethod>, key: Option<&str>, jump: Option<&str>) -> ServerPayload {
        ServerPayload {
            name: "minipc".into(),
            ip: "192.168.1.10".into(),
            mac_address: String::new(),
            ssh_user: "root".into(),
            ssh_password: String::new(),
            ssh_port: 22,
            shutdown_command: None,
            reboot_command: None,
            os_type: crate::models::OsType::Linux,
            icon: None,
            notes: None,
            tag_ids: None,
            folder_id: None,
            favorite: None,
            custom_fields: None,
            auth_method: method,
            ssh_key_id: key.map(str::to_string),
            jump_host_id: jump.map(str::to_string),
            clear_password: false,
        }
    }

    fn fixture() -> AppData {
        let mut data = AppData::default();
        let master = crypto::data_key(&data).unwrap();
        data.ssh_keys.push(crate::ssh_keys::tests::sealed_key("minipc", &master).0);
        let a = server(&data, "a", "minipc", "192.168.1.10", "s3cret");
        let b = server(&data, "b", "FwNode", "192.168.1.1", "pw");
        data.servers.extend([a, b]);
        data
    }

    #[test]
    fn old_payload_leaves_authentication_untouched() {
        let data = fixture();
        assert_eq!(auth_update(&data, "a", AuthMethod::Key, &payload(None, None, None)).unwrap(), None);
    }

    #[test]
    fn key_method_requires_an_existing_key() {
        let data = fixture();
        let key = |k: Option<&str>| payload(Some(AuthMethod::Key), k, None);
        assert!(auth_update(&data, "a", AuthMethod::Password, &key(None)).unwrap_err().contains("Choisis la clé"));
        assert!(auth_update(&data, "a", AuthMethod::Password, &key(Some("absente"))).unwrap_err().contains("n'existe plus"));
        let ok = auth_update(&data, "a", AuthMethod::Password, &payload(Some(AuthMethod::Key), Some("id-minipc"), Some(" ")))
            .unwrap()
            .unwrap();
        assert_eq!(ok, AuthUpdate { method: AuthMethod::Key, key_id: Some("id-minipc".into()), jump_id: None });
    }

    #[test]
    fn jump_rules_on_save() {
        let mut data = fixture();
        let jump = |j: &str| payload(Some(AuthMethod::Password), None, Some(j));
        assert!(auth_update(&data, "a", AuthMethod::Password, &jump("a")).is_err());
        assert!(auth_update(&data, "a", AuthMethod::Password, &jump("absent")).is_err());
        assert!(auth_update(&data, "a", AuthMethod::Password, &payload(Some(AuthMethod::Password), None, Some("b"))).is_ok());
        // a passe par b : b ne peut pas passer par a (boucle) ni par un autre rebond
        data.servers[0].jump_host_id = Some("b".into());
        assert!(auth_update(&data, "b", AuthMethod::Password, &jump("a")).unwrap_err().contains("Boucle"));
        let c = server(&data, "c", "DockerHost", "192.168.1.30", "pw");
        data.servers.push(c);
        assert!(auth_update(&data, "b", AuthMethod::Password, &jump("c")).unwrap_err().contains("sert d'hôte de rebond"));
        // Nouveau serveur passant par a, qui a lui-même un rebond : refusé
        assert!(auth_update(&data, "", AuthMethod::Password, &jump("a")).unwrap_err().contains("un seul niveau"));
    }

    #[test]
    fn password_is_cleared_only_on_request_and_never_for_password_auth() {
        let data = fixture();
        let mut s = data.servers[0].clone();
        let mut p = payload(Some(AuthMethod::Key), Some("id-minipc"), None);
        auth_update(&data, "a", AuthMethod::Password, &p).unwrap().unwrap().apply(&mut s, p.clear_password);
        assert!(!s.ssh_password.is_empty(), "laissé vide = conservé");
        p.clear_password = true;
        auth_update(&data, "a", AuthMethod::Password, &p).unwrap().unwrap().apply(&mut s, p.clear_password);
        assert_eq!((s.auth_method, s.ssh_password.as_str()), (AuthMethod::Key, ""));
        let mut pw = payload(Some(AuthMethod::Password), None, None);
        pw.clear_password = true;
        assert!(auth_update(&data, "a", AuthMethod::Key, &pw).is_err());
    }

    #[test]
    fn server_view_never_carries_the_password() {
        let data = fixture();
        let view = serde_json::to_value(without_secret(&data.servers[0])).unwrap();
        assert_eq!(view["ssh_password"], "");
        assert_eq!(view["auth_method"], "Password");
    }
}
