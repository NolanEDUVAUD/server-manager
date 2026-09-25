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

        let mut data = load_app_data(&data_path);
        migrate_to_master_key(&mut data, &data_path);

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
            schedules: Vec::new(),
            key_version: 1,
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

/// Charge la clé maître et, si besoin, migre les secrets de l'ancienne clé dérivée
/// (sel stocké à côté des données) vers la clé maître. data.json est sauvegardé
/// avant toute modification ; en cas d'échec, les données restent en l'état.
fn migrate_to_master_key(data: &mut crate::models::AppData, path: &std::path::Path) {
    use crate::crypto;
    let master = match crate::keystore::load_or_create_master_key() {
        Ok(k) => k,
        Err(e) => {
            log::warn!("{} — les secrets restent protégés par l'ancienne clé", e);
            return;
        }
    };
    crypto::set_master_key(master);
    if data.key_version >= crypto::KEY_VERSION_MASTER {
        return;
    }

    let backup = path.with_file_name("data.json.pre-master-key.bak");
    if path.exists() {
        if let Err(e) = std::fs::copy(path, &backup) {
            log::warn!("Sauvegarde avant migration impossible ({}), migration annulée", e);
            return;
        }
    }
    let legacy = crypto::derive_key(&data.encryption_salt);
    match crypto::reencrypt_all(data, &legacy, &master) {
        Ok(()) => {
            data.key_version = crypto::KEY_VERSION_MASTER;
            match serde_json::to_string_pretty(&*data).map(|json| std::fs::write(path, json)) {
                Ok(Ok(())) => {
                    // La sauvegarde contient les secrets sous l'ancienne clé (déchiffrables avec le
                    // seul data.json) : on la supprime dès que le fichier migré est relu et vérifié.
                    if verify_migrated(path, &master) {
                        let _ = std::fs::remove_file(&backup);
                        log::info!("Secrets migrés vers la clé maître et vérifiés");
                    } else {
                        log::warn!("Vérification après migration échouée : sauvegarde conservée {:?}", backup);
                    }
                }
                _ => log::warn!("Écriture après migration impossible : la sauvegarde {:?} est intacte", backup),
            }
        }
        Err(e) => log::warn!("Migration vers la clé maître impossible : {}", e),
    }
}

/// Relit le fichier migré et vérifie que chaque secret se déchiffre avec la clé maître
fn verify_migrated(path: &std::path::Path, master: &[u8; 32]) -> bool {
    let data = load_app_data(path);
    data.key_version >= crate::crypto::KEY_VERSION_MASTER
        && data.servers.iter().all(|s| crate::crypto::decrypt(&s.ssh_password, master).is_ok())
        && data.proxmox_connections.iter().all(|c| crate::crypto::decrypt(&c.token_secret, master).is_ok())
}
