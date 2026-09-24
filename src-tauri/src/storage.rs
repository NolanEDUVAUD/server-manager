/// Module de persistance — lecture/écriture du fichier JSON de config
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::models::AppData;

// ── État Tauri partagé entre toutes les commandes ─────────────────────────
pub struct AppState {
    pub data: Mutex<AppData>,
    pub data_path: PathBuf,
    pub pending_import: Mutex<Option<crate::models::PendingImport>>,
}

impl AppState {
    /// Charge les données depuis le disque, ou crée une config par défaut
    pub fn load(app: &AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .expect("Impossible d'obtenir le répertoire de données de l'application");

        // Crée le répertoire si nécessaire
        std::fs::create_dir_all(&data_dir)
            .expect("Impossible de créer le répertoire de données");

        let data_path = data_dir.join("data.json");
        log::info!("Fichier de données : {:?}", data_path);

        let data = load_app_data(&data_path);

        AppState {
            data: Mutex::new(data),
            data_path,
            pending_import: Mutex::new(None),
        }
    }

    /// Sauvegarde les données sur le disque
    pub fn save(&self) -> Result<(), String> {
        let data = self
            .data
            .lock()
            .map_err(|e| format!("Erreur de verrouillage du mutex: {}", e))?;

        let content = serde_json::to_string_pretty(&*data)
            .map_err(|e| format!("Erreur de sérialisation JSON: {}", e))?;

        std::fs::write(&self.data_path, content)
            .map_err(|e| format!("Erreur d'écriture du fichier: {}", e))?;

        log::debug!("Données sauvegardées dans {:?}", self.data_path);
        Ok(())
    }
}

/// Charge les données depuis le disque avec gestion de la migration v1 → v2
pub fn load_app_data(path: &std::path::Path) -> crate::models::AppData {
    if !path.exists() {
        return crate::models::AppData::default();
    }
    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return crate::models::AppData::default(),
    };
    // Tentative 1 : format v2
    if let Ok(data) = serde_json::from_str::<crate::models::AppData>(&content) {
        log::info!(
            "Données chargées : {} serveurs, {} groupes",
            data.servers.len(),
            data.groups.len()
        );
        return data;
    }
    // Tentative 2 : format v1 → migration
    if let Ok(v1) = serde_json::from_str::<crate::models::AppDataV1>(&content) {
        log::info!("Migration AppData v1 → v2");
        let data = crate::models::AppData {
            servers: v1.servers,
            groups: v1.groups,
            settings: crate::models::AppSettings::from_v1(v1.settings),
            encryption_salt: v1.encryption_salt,
            proxmox_connections: Vec::new(),
        };
        // Sauvegarder immédiatement en format v2
        if let Ok(json) = serde_json::to_string_pretty(&data) {
            let _ = std::fs::write(path, json);
        }
        return data;
    }
    log::error!("Erreur de lecture du JSON (données réinitialisées)");
    crate::models::AppData::default()
}
