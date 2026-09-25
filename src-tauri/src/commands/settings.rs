/// Commandes Tauri — Paramètres et import/export de configuration
use tauri::State;
use tauri_plugin_dialog::DialogExt;
use chrono::Utc;

use crate::{
    models::{AppData, AppSettings},
    storage::AppState,
};

#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

// ── Récupérer les paramètres actuels ──────────────────────────────────────
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<AppSettings, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.settings.clone())
}

// ── Mettre à jour les paramètres ─────────────────────────────────────────
#[tauri::command]
pub fn update_settings(state: State<AppState>, settings: AppSettings) -> Result<(), String> {
    // Validation des valeurs réseau
    if settings.network.ping_interval_secs < 5 {
        return Err("L'intervalle de ping doit être d'au moins 5 secondes".to_string());
    }
    if settings.network.ping_timeout_ms < 500 || settings.network.ping_timeout_ms > 30_000 {
        return Err("Le timeout de ping doit être entre 500 ms et 30 000 ms".to_string());
    }
    if settings.network.ssh_timeout_secs < 5 || settings.network.ssh_timeout_secs > 120 {
        return Err("Le timeout SSH doit être entre 5 et 120 secondes".to_string());
    }
    settings.history.validate()?;
    if !crate::models::LANGUAGES.contains(&settings.general.language.as_str()) {
        return Err("Langue non prise en charge".to_string());
    }

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    data.settings = settings;
    drop(data);

    state.save()?;
    log::info!("Paramètres mis à jour");
    Ok(())
}

/// Taille maximale d'une configuration importée
const MAX_IMPORT_BYTES: usize = 10 * 1024 * 1024;

fn check_import_size(len: usize) -> Result<(), String> {
    if len > MAX_IMPORT_BYTES {
        return Err(format!("Fichier trop volumineux ({} Mo au plus)", MAX_IMPORT_BYTES / 1024 / 1024));
    }
    Ok(())
}

// ── Exporter la configuration en JSON (sans mots de passe) ────────────────
#[tauri::command]
pub fn export_config(state: State<AppState>) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let export_data = export_without_secrets(&data);
    serde_json::to_string_pretty(&export_data).map_err(|e| format!("Erreur de sérialisation: {}", e))
}

/// Copie de la configuration sans aucun secret (tags, dossiers, favoris et champs
/// personnalisés inclus : ce ne sont pas des secrets)
fn export_without_secrets(data: &AppData) -> AppData {
    // Copie sans aucun secret : mots de passe SSH, jetons Proxmox, secrets des
    // intégrations et des sondes (même chiffrés, ils ne quittent pas cette machine)
    let mut export_data = data.clone();
    for field in crate::crypto::secret_fields_mut(&mut export_data) {
        field.clear();
    }
    // Verrouillage (hash du PIN, méthode) et sauvegarde automatique (dossier local) :
    // propres à cette machine, jamais exportés
    export_data.lock = crate::lock::LockConfig::default();
    export_data.backup = crate::backup::BackupConfig::default();
    export_data
}

// ── Importer une configuration depuis un JSON ─────────────────────────────
#[tauri::command]
pub fn import_config(state: State<AppState>, json: String) -> Result<String, String> {
    check_import_size(json.len())?;
    let imported: AppData =
        serde_json::from_str(&json).map_err(|e| format!("JSON invalide: {}", e))?;

    let server_count = imported.servers.len();
    let group_count = imported.groups.len();

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    merge_config(&mut data, imported);

    // Conserver les paramètres actuels (ne pas les écraser)
    drop(data);
    state.save()?;

    Ok(format!(
        "Import réussi : {} serveurs, {} groupes traités",
        server_count, group_count
    ))
}

/// Fusion d'une configuration importée (ancienne API) : serveurs par IP, groupes par
/// nom, tags et dossiers par nom ; les paramètres actuels sont conservés
fn merge_config(data: &mut AppData, imported: AppData) {
    // Organisation d'abord : les serveurs importés sont rattachés aux tags et dossiers locaux
    let remap = crate::organisation::merge_definitions(data, imported.tags, imported.folders);

    // Fusionner : ajouter les serveurs importés qui n'existent pas déjà (par IP)
    for mut server in imported.servers {
        if !data.servers.iter().any(|s| s.ip == server.ip) {
            remap.apply_to_server(&mut server);
            data.servers.push(server);
        }
    }

    // Fusionner les groupes (par nom)
    for group in imported.groups {
        if !data.groups.iter().any(|g| g.name == group.name) {
            data.groups.push(group);
        }
    }
    crate::organisation::normalize(data);
}

// ── Retourner le chemin du fichier de données ─────────────────────────────
#[tauri::command]
pub fn get_data_path(state: State<AppState>) -> String {
    state.data_path.to_string_lossy().into_owned()
}

// ── Autostart (Windows registry) ──────────────────────────────────────────

const AUTOSTART_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE: &str = "ServerPowerManager";

#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        match hkcu.open_subkey(AUTOSTART_KEY) {
            Ok(run_key) => Ok(run_key.get_value::<String, _>(AUTOSTART_VALUE).is_ok()),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
pub fn set_autostart(
    enabled: bool,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = hkcu
            .create_subkey(AUTOSTART_KEY)
            .map_err(|e| e.to_string())?;
        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            run_key.set_value(AUTOSTART_VALUE, &exe_path)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = run_key.delete_value(AUTOSTART_VALUE);
        }
    }
    // Mettre à jour data.json en miroir
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.settings.general.auto_start = enabled;
    drop(data);
    state.save()
}

// ── Export/Import de configuration avec dialogue fichier ──────────────────

/// Valide la structure d'un JSON de configuration importé
fn validate_import_json(json: &str) -> Result<serde_json::Value, String> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("JSON invalide : {}", e))?;
    if v.get("config_version").is_none() {
        return Err("Champ 'config_version' manquant".to_string());
    }
    let servers = v.get("servers").and_then(|s| s.as_array())
        .ok_or_else(|| "Champ 'servers' manquant ou invalide".to_string())?;
    v.get("groups").and_then(|g| g.as_array())
        .ok_or_else(|| "Champ 'groups' manquant ou invalide".to_string())?;
    for (i, srv) in servers.iter().enumerate() {
        for field in &["id", "name", "ip", "mac_address"] {
            if srv.get(field).and_then(|f| f.as_str()).map(|s| s.is_empty()).unwrap_or(true) {
                return Err(format!("Champ 'servers[{}].{}' manquant ou vide", i, field));
            }
        }
    }
    Ok(v)
}

#[tauri::command]
pub async fn export_full_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    let data = state.data.lock().map_err(|e| e.to_string())?;
    let exported_at = Utc::now().to_rfc3339();
    let default_filename = format!("spm-config-{}.json", &exported_at[..10]);
    let export = full_export(&data, &exported_at);
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    drop(data); // relâcher le verrou avant le dialogue
    let file_path = app.dialog()
        .file()
        .set_title("Exporter la configuration")
        .set_file_name(&default_filename)
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let file_path_buf = match file_path {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("Export annulé".to_string()),
    };
    std::fs::write(&file_path_buf, &json).map_err(|e| e.to_string())?;
    Ok(file_path_buf.to_string_lossy().to_string())
}

/// Contenu de l'export complet, sans secret
fn full_export(data: &AppData, exported_at: &str) -> serde_json::Value {
    // Exclure les mots de passe SSH
    let servers_clean: Vec<serde_json::Value> = data.servers.iter().map(|s| {
        let mut v = serde_json::to_value(s).unwrap_or_default();
        if let Some(obj) = v.as_object_mut() {
            obj.insert("ssh_password".to_string(), serde_json::Value::String(String::new()));
        }
        v
    }).collect();
    serde_json::json!({
        "config_version": "2.0",
        "exported_at": exported_at,
        "servers": servers_clean,
        "groups": data.groups,
        "settings": data.settings,
        // Organisation : tags et dossiers (favoris et champs personnalisés sont dans chaque serveur)
        "tags": data.tags,
        "folders": data.folders,
    })
}

/// Lit un export complet : import en attente et récapitulatif à présenter
fn parse_full_import(content: &str) -> Result<(crate::models::PendingImport, crate::models::ImportSummary), String> {
    check_import_size(content.len())?;
    let v = validate_import_json(content)?;
    let servers: Vec<crate::models::Server> = serde_json::from_value(
        v["servers"].clone()
    ).map_err(|e| format!("Erreur parsing servers : {}", e))?;
    let groups: Vec<crate::models::Group> = serde_json::from_value(
        v["groups"].clone()
    ).map_err(|e| format!("Erreur parsing groups : {}", e))?;
    let settings: Option<crate::models::AppSettings> = v.get("settings")
        .and_then(|s| serde_json::from_value(s.clone()).ok());
    // Organisation : absente d'un export antérieur = rien à importer
    let tags: Vec<crate::organisation::Tag> = match v.get("tags") {
        Some(t) => serde_json::from_value(t.clone()).map_err(|e| format!("Erreur parsing tags : {}", e))?,
        None => Vec::new(),
    };
    let folders: Vec<crate::organisation::Folder> = match v.get("folders") {
        Some(f) => serde_json::from_value(f.clone()).map_err(|e| format!("Erreur parsing folders : {}", e))?,
        None => Vec::new(),
    };
    let summary = crate::models::ImportSummary {
        servers_count: servers.len(),
        groups_count: groups.len(),
        settings_present: settings.is_some(),
        config_version: v["config_version"].as_str().unwrap_or("?").to_string(),
        exported_at: v.get("exported_at").and_then(|d| d.as_str()).map(|s| s.to_string()),
        tags_count: tags.len(),
        folders_count: folders.len(),
    };
    let pending = crate::models::PendingImport {
        servers,
        groups,
        settings,
        config_version: summary.config_version.clone(),
        tags,
        folders,
    };
    Ok((pending, summary))
}

#[tauri::command]
pub async fn import_full_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<crate::models::ImportSummary, String> {
    let file_path = app.dialog()
        .file()
        .set_title("Importer une configuration")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    let file_path_buf = match file_path {
        Some(p) => p.into_path().map_err(|e| e.to_string())?,
        None => return Err("Import annulé".to_string()),
    };
    // Taille vérifiée avant lecture : un fichier démesuré n'est jamais chargé en mémoire
    let size = std::fs::metadata(&file_path_buf).map_err(|e| e.to_string())?.len();
    check_import_size(usize::try_from(size).unwrap_or(usize::MAX))?;
    let content = std::fs::read_to_string(&file_path_buf).map_err(|e| e.to_string())?;
    let (pending, summary) = parse_full_import(&content)?;
    *state.pending_import.lock().map_err(|e| e.to_string())? = Some(pending);
    Ok(summary)
}

#[tauri::command]
pub fn apply_import_config(
    mode: String,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    let pending = state.pending_import.lock().map_err(|e| e.to_string())?
        .take()
        .ok_or("Aucun import en attente")?;
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    apply_import(&mut data, pending, &mode);
    drop(data);
    state.save()
}

/// Applique un import en attente : « replace » remplace serveurs, groupes, paramètres,
/// tags et dossiers ; sinon fusion (serveurs par IP, groupes par id, tags et dossiers par nom)
fn apply_import(data: &mut AppData, pending: crate::models::PendingImport, mode: &str) {
    match mode {
        "replace" => {
            // Organisation revalidée comme n'importe quelle donnée importée
            data.tags.clear();
            data.folders.clear();
            let remap = crate::organisation::merge_definitions(data, pending.tags, pending.folders);
            data.servers = pending.servers;
            for srv in data.servers.iter_mut() {
                remap.apply_to_server(srv);
            }
            data.groups = pending.groups;
            if let Some(s) = pending.settings { data.settings = s; }
        }
        _ => {
            let remap = crate::organisation::merge_definitions(data, pending.tags, pending.folders);
            // fusion : ajouter les serveurs importés qui n'existent pas déjà (par IP)
            let existing_ips: std::collections::HashSet<String> =
                data.servers.iter().map(|s| s.ip.clone()).collect();
            for mut srv in pending.servers {
                if !existing_ips.contains(&srv.ip) {
                    remap.apply_to_server(&mut srv);
                    data.servers.push(srv);
                }
            }
            let existing_ids: std::collections::HashSet<String> =
                data.groups.iter().map(|g| g.id.clone()).collect();
            for grp in pending.groups {
                if !existing_ids.contains(&grp.id) {
                    data.groups.push(grp);
                }
            }
        }
    }
    // Références orphelines (services non importés, tags écartés) et champs invalides retirés
    crate::organisation::normalize(data);
}

// ── Thèmes personnalisés ───────────────────────────────────────────────────

#[tauri::command]
pub fn save_custom_theme(
    theme: crate::models::Theme,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    if theme.id.is_empty() || theme.name.is_empty() {
        return Err("L'id et le nom du thème sont requis".to_string());
    }
    if !theme.id.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err("L'id doit contenir uniquement des caractères alphanumériques et des tirets".to_string());
    }
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let pos = data.settings.appearance.custom_themes.iter().position(|t| t.id == theme.id);
    match pos {
        Some(i) => data.settings.appearance.custom_themes[i] = theme,
        None => data.settings.appearance.custom_themes.push(theme),
    }
    drop(data);
    state.save()
}

#[tauri::command]
pub fn delete_custom_theme(
    id: String,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.settings.appearance.custom_themes.retain(|t| t.id != id);
    drop(data);
    state.save()
}

// ── Tests unitaires ───────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_json() -> &'static str {
        r#"{
            "config_version": "2.0",
            "servers": [{"id":"1","name":"srv","ip":"1.1.1.1","mac_address":"AA:BB:CC:DD:EE:FF","ssh_user":"root","ssh_password":"","ssh_port":22,"shutdown_command":"poweroff","reboot_command":"reboot","os_type":"Linux","icon":null,"notes":null}],
            "groups": []
        }"#
    }

    #[test]
    fn export_never_contains_the_lock_configuration() {
        let data = AppData {
            lock: crate::lock::LockConfig {
                method: crate::lock::LockMethod::Pin,
                pin_hash: "$argon2id$v=19$m=64,t=1,p=1$c2VsLWZhY3RpY2U$aGFzaC1mYWN0aWNl".into(),
                idle_minutes: 5,
                lock_on_session_lock: true,
            },
            ..AppData::default()
        };
        let json = serde_json::to_string(&export_without_secrets(&data)).unwrap();
        assert!(!json.contains("argon2id"), "hash du PIN exporté");
        let back: AppData = serde_json::from_str(&json).unwrap();
        assert_eq!(back.lock, crate::lock::LockConfig::default());
    }

    #[test]
    fn test_validate_import_json_valid() {
        let result = validate_import_json(make_valid_json());
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_import_json_missing_version() {
        let json = r#"{"servers":[],"groups":[]}"#;
        let result = validate_import_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("config_version"));
    }

    // ── Organisation : export / import ────────────────────────────────────

    use crate::organisation::{self, CustomField, Folder, Tag};

    /// Configuration organisée : 2 tags, 1 dossier, un serveur favori avec des champs personnalisés
    fn organised_data() -> AppData {
        let mut data = AppData::default();
        let key = crate::crypto::derive_key(&data.encryption_salt);
        let prod = organisation::save_tag(&mut data, Tag { id: String::new(), name: "Prod".into(), color: "#ff0000".into() }).unwrap();
        let media = organisation::save_tag(&mut data, Tag { id: String::new(), name: "Média".into(), color: "#00ff00".into() }).unwrap();
        let lab = organisation::save_folder(&mut data, Folder { id: String::new(), name: "Lab".into() }).unwrap();
        let mut s = crate::models::Server::new(
            "minipc".into(), "192.168.1.10".into(), "02:00:00:00:00:01".into(), "root".into(),
            crate::crypto::encrypt("hunter2", &key).unwrap(), 22, crate::models::OsType::Linux, None, None,
        );
        s.tag_ids = vec![prod.id, media.id];
        s.folder_id = Some(lab.id);
        s.favorite = true;
        s.custom_fields = vec![CustomField { key: "Emplacement".into(), value: "Baie 2".into() }];
        data.servers.push(s);
        data
    }

    fn org_of(s: &crate::models::Server) -> (Vec<String>, Option<String>, bool, Vec<CustomField>) {
        (s.tag_ids.clone(), s.folder_id.clone(), s.favorite, s.custom_fields.clone())
    }

    #[test]
    fn exports_contain_no_secret_of_any_kind() {
        let key = crate::crypto::generate_key();
        let mut data = crate::crypto::test_support::data_with_every_secret(&key);
        data.backup.enabled = true;
        data.backup.folder = "/sauvegardes".into();
        let ciphertexts: Vec<String> = crate::crypto::secret_fields_mut(&mut data).iter().map(|f| f.to_string()).collect();
        let exported = export_without_secrets(&data);
        let json = serde_json::to_string(&exported).unwrap() + &full_export(&data, "2026-09-25T00:00:00Z").to_string();
        for c in &ciphertexts {
            assert!(!c.is_empty() && !json.contains(c.as_str()), "secret chiffré présent dans l'export");
        }
        for plain in ["secret-ssh", "secret-proxmox", "secret-ntfy", "secret-sonde", "secret-sauvegarde", "/sauvegardes"] {
            assert!(!json.contains(plain), "{} présent dans l'export", plain);
        }
    }

    #[test]
    fn full_export_import_roundtrip_keeps_organisation_without_secrets() {
        let data = organised_data();
        let json = serde_json::to_string_pretty(&full_export(&data, "2026-09-25T00:00:00Z")).unwrap();
        assert!(!json.contains(&data.servers[0].ssh_password), "aucun secret dans l'export");
        assert!(json.contains("Emplacement") && json.contains("Média"));

        let (pending, summary) = parse_full_import(&json).unwrap();
        assert_eq!((summary.tags_count, summary.folders_count, summary.servers_count), (2, 1, 1));
        assert!(pending.servers[0].ssh_password.is_empty());

        // Remplacement dans une installation vierge : tout revient à l'identique
        let mut target = AppData::default();
        apply_import(&mut target, pending, "replace");
        assert_eq!(target.tags, data.tags);
        assert_eq!(target.folders, data.folders);
        assert_eq!(org_of(&target.servers[0]), org_of(&data.servers[0]));
    }

    #[test]
    fn full_import_merge_links_to_existing_tags_by_name() {
        let json = serde_json::to_string(&full_export(&organised_data(), "2026-09-25T00:00:00Z")).unwrap();
        let (pending, _) = parse_full_import(&json).unwrap();

        // L'installation locale a déjà un tag « PROD » (autre identifiant) et un service étiqueté
        let mut target = AppData::default();
        let local = organisation::save_tag(&mut target, Tag { id: String::new(), name: "PROD".into(), color: "#123456".into() }).unwrap();
        apply_import(&mut target, pending, "merge");
        assert_eq!(target.tags.len(), 2, "« Prod » rattaché à « PROD », « Média » ajouté");
        assert_eq!(target.tags[0], local);
        let s = &target.servers[0];
        assert_eq!(s.tag_ids[0], local.id);
        assert_eq!(s.tag_ids[1], target.tags[1].id);
        assert_eq!(s.folder_id.as_deref(), Some(target.folders[0].id.as_str()));
        assert!(s.favorite);
    }

    #[test]
    fn replace_import_cleans_references_of_services_kept_locally() {
        let json = serde_json::to_string(&full_export(&organised_data(), "2026-09-25T00:00:00Z")).unwrap();
        let (pending, _) = parse_full_import(&json).unwrap();
        let mut target = AppData::default();
        let old = organisation::save_tag(&mut target, Tag { id: String::new(), name: "Ancien".into(), color: "#123456".into() }).unwrap();
        target.probes.push(serde_json::from_value(serde_json::json!({
            "id": "p1", "name": "Jellyfin", "enabled": true, "kind": {"type": "Tcp", "host": "192.168.1.20", "port": 8096},
            "interval_secs": 60, "tag_ids": [old.id], "favorite": true
        })).unwrap());
        apply_import(&mut target, pending, "replace");
        assert!(target.probes[0].tag_ids.is_empty(), "tag remplacé : référence retirée du service");
        assert!(target.probes[0].favorite, "le favori du service est conservé");
    }

    #[test]
    fn import_sanitizes_invalid_organisation() {
        let fields: Vec<_> = (0..30).map(|i| serde_json::json!({"key": format!("k{i}"), "value": "v"})).collect();
        let json = serde_json::json!({
            "config_version": "2.0",
            "servers": [{"id":"1","name":"minipc","ip":"192.168.1.10","mac_address":"02:00:00:00:00:01","ssh_user":"root",
                         "ssh_password":"","ssh_port":22,"shutdown_command":"poweroff","reboot_command":"reboot","os_type":"Linux",
                         "tag_ids": ["t1", "t2", "inconnu"], "folder_id": "inconnu", "custom_fields": fields}],
            "groups": [],
            "tags": [{"id": "t1", "name": "Prod", "color": "#FF0000"}, {"id": "t2", "name": "Rouge", "color": "red"},
                     {"id": "t3", "name": "", "color": "#000000"}],
            "folders": [{"id": "f1", "name": "x".repeat(41)}]
        }).to_string();
        let (pending, _) = parse_full_import(&json).unwrap();
        let mut target = AppData::default();
        apply_import(&mut target, pending, "merge");
        assert_eq!(target.tags, vec![Tag { id: "t1".into(), name: "Prod".into(), color: "#ff0000".into() }]);
        assert!(target.folders.is_empty());
        let s = &target.servers[0];
        assert_eq!(s.tag_ids, vec!["t1".to_string()]);
        assert_eq!(s.folder_id, None);
        assert_eq!(s.custom_fields.len(), organisation::MAX_CUSTOM_FIELDS);

        // Structure invalide : refusée avec un message clair
        let bad = r#"{"config_version":"2.0","servers":[],"groups":[],"tags":"oups"}"#;
        assert!(parse_full_import(bad).unwrap_err().contains("tags"));
    }

    #[test]
    fn import_of_an_old_export_without_organisation_works() {
        let (pending, summary) = parse_full_import(make_valid_json()).unwrap();
        assert_eq!((summary.tags_count, summary.folders_count), (0, 0));
        let mut target = AppData::default();
        apply_import(&mut target, pending, "merge");
        assert!(target.servers[0].tag_ids.is_empty() && !target.servers[0].favorite);
    }

    #[test]
    fn oversized_import_is_refused() {
        let huge = format!("{{\"config_version\":\"2.0\",\"servers\":[],\"groups\":[],\"x\":\"{}\"}}", "a".repeat(MAX_IMPORT_BYTES));
        assert!(parse_full_import(&huge).unwrap_err().contains("volumineux"));
    }

    #[test]
    fn legacy_export_config_roundtrip_keeps_organisation_without_secrets() {
        let mut data = organised_data();
        data.probes.push(serde_json::from_value(serde_json::json!({
            "id": "p1", "name": "Jellyfin", "enabled": true, "kind": {"type": "Tcp", "host": "192.168.1.20", "port": 8096},
            "interval_secs": 60, "tag_ids": [data.tags[0].id], "folder_id": data.folders[0].id, "favorite": true
        })).unwrap());
        let exported = export_without_secrets(&data);
        assert!(exported.servers[0].ssh_password.is_empty());
        let json = serde_json::to_string_pretty(&exported).unwrap();
        let imported: AppData = serde_json::from_str(&json).unwrap();
        assert_eq!(imported.tags, data.tags);
        assert_eq!(imported.folders, data.folders);
        assert_eq!(org_of(&imported.servers[0]), org_of(&data.servers[0]));
        assert_eq!(imported.probes[0].tag_ids, data.probes[0].tag_ids);
        assert!(imported.probes[0].favorite);

        // Fusion (import_config) dans une installation qui a déjà un dossier « lab »
        let mut target = AppData::default();
        let lab = organisation::save_folder(&mut target, Folder { id: String::new(), name: "lab".into() }).unwrap();
        merge_config(&mut target, imported);
        assert_eq!(target.folders, vec![lab.clone()]);
        assert_eq!(target.tags.len(), 2);
        assert_eq!(target.servers[0].folder_id, Some(lab.id));
        assert_eq!(target.servers[0].custom_fields, data.servers[0].custom_fields);
    }

    #[test]
    fn test_validate_import_json_missing_ip() {
        let json = r#"{
            "config_version":"2.0",
            "servers":[{"id":"1","name":"srv","mac_address":"AA:BB:CC:DD:EE:FF"}],
            "groups":[]
        }"#;
        let result = validate_import_json(json);
        assert!(result.is_err());
    }
}
