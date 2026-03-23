/// Module de persistance — lecture/écriture du fichier JSON de config
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

use crate::models::AppData;

// ── État Tauri partagé entre toutes les commandes ─────────────────────────
pub struct AppState {
    pub data: Mutex<AppData>,
    pub data_path: PathBuf,
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

        let data = if data_path.exists() {
            let content = std::fs::read_to_string(&data_path).unwrap_or_default();
            match serde_json::from_str::<AppData>(&content) {
                Ok(d) => {
                    log::info!(
                        "Données chargées : {} serveurs, {} groupes",
                        d.servers.len(),
                        d.groups.len()
                    );
                    d
                }
                Err(e) => {
                    log::error!("Erreur de lecture du JSON (données réinitialisées) : {}", e);
                    AppData::default()
                }
            }
        } else {
            log::info!("Aucune donnée existante, création d'un profil par défaut");
            AppData::default()
        };

        AppState {
            data: Mutex::new(data),
            data_path,
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
