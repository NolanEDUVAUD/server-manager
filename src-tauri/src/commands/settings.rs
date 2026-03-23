/// Commandes Tauri — Paramètres et import/export de configuration
use tauri::State;

use crate::{
    models::{AppData, AppSettings},
    storage::AppState,
};

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
