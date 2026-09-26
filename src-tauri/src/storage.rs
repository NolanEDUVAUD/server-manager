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

        // La clé maître (coffre Windows, migration des anciens secrets, verrouillage
        // au démarrage) est prise en charge ensuite par `lock::boot_app`
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
            schedules: Vec::new(),
            key_version: 1,
            integrations: Vec::new(),
            alert_rules: crate::alerts::default_rules(),
            probes: Vec::new(),
            last_lab_running: Vec::new(),
            snippets: crate::commands::snippets::default_snippets(),
            batch_tasks: Vec::new(),
            ansible: None,
            // Organisation
            tags: Vec::new(),
            folders: Vec::new(),
            lock: crate::lock::LockConfig::default(),
            backup: crate::backup::BackupConfig::default(),
            ssh_keys: Vec::new(),
            extensions: Vec::new(),
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

/// Si besoin, migre les secrets de l'ancienne clé dérivée (sel stocké à côté des
/// données) vers la clé maître lue dans le coffre. data.json est sauvegardé avant
/// toute modification ; en cas d'échec, les données restent en l'état.
pub(crate) fn migrate_to_master_key(data: &mut crate::models::AppData, path: &std::path::Path, master: &[u8; 32]) {
    use crate::crypto;
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
    match crypto::reencrypt_all(data, &legacy, master) {
        Ok(()) => {
            data.key_version = crypto::KEY_VERSION_MASTER;
            match serde_json::to_string_pretty(&*data).map(|json| std::fs::write(path, json)) {
                Ok(Ok(())) => {
                    // La sauvegarde contient les secrets sous l'ancienne clé (déchiffrables avec le
                    // seul data.json) : on la supprime dès que le fichier migré est relu et vérifié.
                    if verify_migrated(path, master) {
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
        && data.ssh_keys.iter().all(|k| crate::crypto::decrypt(&k.private_key, master).is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Chemin de test unique (répertoire temporaire du système), pour ne jamais se marcher
    /// dessus si les tests tournent en parallèle.
    fn temp_data_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "server-manager-test-{}-{}-{}.json",
            name,
            std::process::id(),
            crate::events::now_ms()
        ))
    }

    /// Reproduit le scénario du bug rapporté : une règle d'alerte désactivée doit rester
    /// désactivée après un cycle sauvegarde (fermeture) + chargement (redémarrage) complet,
    /// tel qu'il se produit réellement via `AppState::save` / `load_app_data`.
    #[test]
    fn disabled_alert_rule_survives_save_and_load() {
        let path = temp_data_path("alert-rule");

        let mut data = crate::models::AppData::default();
        assert!(!data.alert_rules.is_empty(), "des règles par défaut doivent exister");
        data.alert_rules[0].enabled = false;
        let disabled_id = data.alert_rules[0].id.clone();

        // Écriture identique à `AppState::save`
        let content = serde_json::to_string_pretty(&data).expect("sérialisation");
        std::fs::write(&path, content).expect("écriture");

        // Lecture identique à celle faite au démarrage de l'app
        let reloaded = load_app_data(&path);
        let rule = reloaded
            .alert_rules
            .iter()
            .find(|r| r.id == disabled_id)
            .expect("la règle doit toujours exister après rechargement");
        assert!(!rule.enabled, "la règle désactivée doit le rester après redémarrage");

        let _ = std::fs::remove_file(&path);
    }

    /// Un data.json qui ne contient déjà plus de champ `alert_rules` (très vieux fichier,
    /// ou fichier tronqué par un outil externe) doit tomber sur `default_rules()` — c'est
    /// le seul cas légitime de réinitialisation, jamais un fichier v2 valide et complet.
    #[test]
    fn missing_alert_rules_field_falls_back_to_defaults_without_resetting_everything_else() {
        let path = temp_data_path("missing-rules");
        let mut data = crate::models::AppData::default();
        data.settings.general.language = "en".into();
        let mut value = serde_json::to_value(&data).expect("sérialisation");
        value.as_object_mut().unwrap().remove("alert_rules");
        std::fs::write(&path, serde_json::to_string_pretty(&value).unwrap()).expect("écriture");

        let reloaded = load_app_data(&path);
        // Le reste des données (ici : la langue) n'est pas perdu pour autant
        assert_eq!(reloaded.settings.general.language, "en");
        assert_eq!(reloaded.alert_rules.len(), crate::alerts::default_rules().len());

        let _ = std::fs::remove_file(&path);
    }
}
