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

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    data.settings = settings;
    drop(data);

    state.save()?;
    log::info!("Paramètres mis à jour");
    Ok(())
}

// ── Exporter la configuration en JSON (sans mots de passe) ────────────────
#[tauri::command]
pub fn export_config(state: State<AppState>) -> Result<String, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;

    // Créer une copie sans les mots de passe pour l'export
    let mut export_data = data.clone();
    for server in export_data.servers.iter_mut() {
        server.ssh_password = String::new(); // Ne pas exporter les mots de passe
    }

    serde_json::to_string_pretty(&export_data).map_err(|e| format!("Erreur de sérialisation: {}", e))
}

// ── Importer une configuration depuis un JSON ─────────────────────────────
#[tauri::command]
pub fn import_config(state: State<AppState>, json: String) -> Result<String, String> {
    let imported: AppData =
        serde_json::from_str(&json).map_err(|e| format!("JSON invalide: {}", e))?;

    let server_count = imported.servers.len();
    let group_count = imported.groups.len();

    let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;

    // Fusionner : ajouter les serveurs importés qui n'existent pas déjà (par IP)
    for server in imported.servers {
        if !data.servers.iter().any(|s| s.ip == server.ip) {
            data.servers.push(server);
        }
    }

    // Fusionner les groupes (par nom)
    for group in imported.groups {
        if !data.groups.iter().any(|g| g.name == group.name) {
            data.groups.push(group);
        }
    }

    // Conserver les paramètres actuels (ne pas les écraser)
    drop(data);
    state.save()?;

    Ok(format!(
        "Import réussi : {} serveurs, {} groupes traités",
        server_count, group_count
    ))
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
    let data = state.data.lock().map_err(|e| e.to_string())?;
    // Exclure les mots de passe SSH
    let servers_clean: Vec<serde_json::Value> = data.servers.iter().map(|s| {
        let mut v = serde_json::to_value(s).unwrap_or_default();
        if let Some(obj) = v.as_object_mut() {
            obj.insert("ssh_password".to_string(), serde_json::Value::String(String::new()));
        }
        v
    }).collect();
    let exported_at = Utc::now().to_rfc3339();
    let default_filename = format!("spm-config-{}.json", &exported_at[..10]);
    let export = serde_json::json!({
        "config_version": "2.0",
        "exported_at": exported_at,
        "servers": servers_clean,
        "groups": data.groups,
        "settings": data.settings,
    });
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
    let content = std::fs::read_to_string(&file_path_buf).map_err(|e| e.to_string())?;
    let v = validate_import_json(&content)?;
    let servers: Vec<crate::models::Server> = serde_json::from_value(
        v["servers"].clone()
    ).map_err(|e| format!("Erreur parsing servers : {}", e))?;
    let groups: Vec<crate::models::Group> = serde_json::from_value(
        v["groups"].clone()
    ).map_err(|e| format!("Erreur parsing groups : {}", e))?;
    let settings: Option<crate::models::AppSettings> = v.get("settings")
        .and_then(|s| serde_json::from_value(s.clone()).ok());
    let summary = crate::models::ImportSummary {
        servers_count: servers.len(),
        groups_count: groups.len(),
        settings_present: settings.is_some(),
        config_version: v["config_version"].as_str().unwrap_or("?").to_string(),
        exported_at: v.get("exported_at").and_then(|d| d.as_str()).map(|s| s.to_string()),
    };
    *state.pending_import.lock().map_err(|e| e.to_string())? = Some(
        crate::models::PendingImport {
            servers,
            groups,
            settings,
            config_version: summary.config_version.clone(),
        }
    );
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
    match mode.as_str() {
        "replace" => {
            data.servers = pending.servers;
            data.groups = pending.groups;
            if let Some(s) = pending.settings { data.settings = s; }
        }
        _ => {
            // fusion : ajouter les serveurs importés qui n'existent pas déjà (par IP)
            let existing_ips: std::collections::HashSet<String> =
                data.servers.iter().map(|s| s.ip.clone()).collect();
            for srv in pending.servers {
                if !existing_ips.contains(&srv.ip) {
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
    drop(data);
    state.save()
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
