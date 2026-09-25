//! Verrouillage de l'application : configuration, démarrage (lecture du coffre),
//! déverrouillage (PIN, Windows Hello, mot de passe maître), mot de passe maître
//! qui enveloppe la clé, et verrouillage automatique (inactivité, session Windows).
pub mod platform;
pub mod policy;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use zeroize::Zeroizing;

use crate::crypto::{self, KdfParams, KeyVault, KEY_VERSION_MASTER};
use crate::keystore::{self, KeyringStore, SecretStore, StoredKey, WrappedKey, WRONG_MASTER_PASSWORD};
use crate::models::AppData;
use crate::storage::AppState;
use policy::{AttemptLimiter, IdleTimer};

/// Événement émis vers le frontend à chaque changement d'état
pub const LOCK_EVENT: &str = "lock-state";
const WRONG_PIN: &str = "PIN incorrect";
const PASSWORD_REQUIRED: &str =
    "Un mot de passe maître protège la clé : seul ce mot de passe peut déverrouiller l'application";
const NOT_CONFIGURED: &str =
    "Aucune méthode de déverrouillage n'est configurée (Paramètres → Sécurité)";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum LockMethod {
    #[default]
    None,
    Pin,
    /// Windows Hello, avec le PIN applicatif en secours
    Hello,
}

/// Configuration du verrouillage, rangée hors d'`AppSettings` : `get_settings` /
/// `update_settings` renvoient tout `AppSettings` au frontend, le hash n'y a pas sa place.
#[derive(Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct LockConfig {
    #[serde(default)]
    pub method: LockMethod,
    /// Hash Argon2id (format PHC) du PIN ; jamais envoyé au frontend ni exporté
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub pin_hash: String,
    /// Verrouillage après X minutes sans activité (0 = jamais)
    #[serde(default)]
    pub idle_minutes: u32,
    /// Verrouiller quand la session Windows est verrouillée
    #[serde(default)]
    pub lock_on_session_lock: bool,
}

// Debug manuel : le hash du PIN ne doit pas finir dans un journal
impl std::fmt::Debug for LockConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LockConfig")
            .field("method", &self.method)
            .field("has_pin", &!self.pin_hash.is_empty())
            .field("idle_minutes", &self.idle_minutes)
            .field("lock_on_session_lock", &self.lock_on_session_lock)
            .finish()
    }
}

impl LockConfig {
    /// PIN / Hello utilisables (Hello exige le PIN de secours)
    pub fn method_usable(&self) -> bool {
        self.method != LockMethod::None && !self.pin_hash.is_empty()
    }
}

/// Modification demandée par le frontend (le nouveau PIN est passé à part)
#[derive(Debug, Clone, Deserialize)]
pub struct LockConfigPayload {
    pub method: LockMethod,
    pub idle_minutes: u32,
    pub lock_on_session_lock: bool,
}

/// Vue envoyée au frontend : aucun hash, seulement des indicateurs
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LockStatus {
    /// Au moins un moyen de déverrouiller : le verrouillage est actif
    pub enabled: bool,
    pub locked: bool,
    pub method: LockMethod,
    pub has_pin: bool,
    pub master_password: bool,
    pub idle_minutes: u32,
    pub lock_on_session_lock: bool,
    pub hello_available: bool,
    /// Le verrouillage de la session Windows est détectable (Windows uniquement)
    pub session_detection: bool,
    /// Attente imposée avant le prochain essai (ms)
    pub retry_after_ms: u64,
}

struct Runtime {
    /// Le coffre contient la clé enveloppée (il fait foi, pas data.json)
    master_password: bool,
    idle: IdleTimer,
    limiter: AttemptLimiter,
    /// Disponibilité de Windows Hello (appel système lent, mis en cache)
    hello_available: Option<bool>,
}

/// État Tauri du verrouillage
pub struct LockManager {
    store: Option<Box<dyn SecretStore>>,
    vault: &'static KeyVault,
    kdf: KdfParams,
    rt: Mutex<Runtime>,
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl LockManager {
    pub fn new(store: Option<Box<dyn SecretStore>>, vault: &'static KeyVault, kdf: KdfParams, now_ms: u64) -> Self {
        LockManager {
            store,
            vault,
            kdf,
            rt: Mutex::new(Runtime {
                master_password: false,
                idle: IdleTimer::new(now_ms),
                limiter: AttemptLimiter::default(),
                hello_available: None,
            }),
        }
    }

    fn rt(&self) -> MutexGuard<'_, Runtime> {
        self.rt.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn store(&self) -> Result<&dyn SecretStore, String> {
        self.store.as_deref().ok_or_else(|| "Gestionnaire d'identification Windows indisponible".to_string())
    }

    fn read_stored(&self) -> Result<Option<StoredKey>, String> {
        match self.store()?.read()? {
            Some(v) => StoredKey::parse(&v).map(Some),
            None => Ok(None),
        }
    }

    pub fn master_password_active(&self) -> bool {
        self.rt().master_password
    }

    pub fn is_enabled(&self, cfg: &LockConfig) -> bool {
        self.master_password_active() || cfg.method_usable()
    }

    pub fn is_locked(&self) -> bool {
        self.vault.is_locked()
    }

    pub fn hello_available_cached(&self) -> Option<bool> {
        self.rt().hello_available
    }

    pub fn set_hello_available(&self, available: bool) {
        self.rt().hello_available = Some(available);
    }

    pub fn status(&self, cfg: &LockConfig, now_ms: u64) -> LockStatus {
        let rt = self.rt();
        LockStatus {
            enabled: rt.master_password || cfg.method_usable(),
            locked: self.vault.is_locked(),
            method: cfg.method,
            has_pin: !cfg.pin_hash.is_empty(),
            master_password: rt.master_password,
            idle_minutes: cfg.idle_minutes,
            lock_on_session_lock: cfg.lock_on_session_lock,
            hello_available: rt.hello_available.unwrap_or(false),
            session_detection: platform::SESSION_DETECTION,
            retry_after_ms: rt.limiter.retry_after_ms(now_ms),
        }
    }

    // ── Démarrage ─────────────────────────────────────────────────────────

    /// Lit (ou crée) la clé du coffre, migre les secrets de l'ancienne clé dérivée,
    /// puis verrouille si une méthode est configurée ou si la clé est enveloppée par
    /// un mot de passe maître. Retourne l'état verrouillé.
    pub fn boot(&self, data: &mut AppData, path: &Path) -> bool {
        let stored = self.store().and_then(keystore::load_or_create);
        match stored {
            Ok(StoredKey::Raw(key)) => {
                self.vault.unlock(Some(key.clone()));
                crate::storage::migrate_to_master_key(data, path, &key);
            }
            Ok(StoredKey::Wrapped(_)) => self.rt().master_password = true,
            Err(e) => log::warn!("{} — les secrets restent protégés par l'ancienne clé", e),
        }
        let locked = self.is_enabled(&data.lock);
        if locked {
            self.vault.lock();
            log::info!("Démarrage verrouillé");
        }
        locked
    }

    // ── Verrouillage ──────────────────────────────────────────────────────

    /// Verrouille et efface la clé. Refusé sans moyen de déverrouiller.
    pub fn lock(&self, cfg: &LockConfig) -> Result<(), String> {
        if !self.is_enabled(cfg) {
            return Err(NOT_CONFIGURED.into());
        }
        self.vault.lock();
        Ok(())
    }

    pub fn touch(&self, now_ms: u64) {
        self.rt().idle.touch(now_ms);
    }

    /// Faut-il verrouiller maintenant ? (`session_locked` : état de la session Windows)
    pub fn should_auto_lock(&self, cfg: &LockConfig, now_ms: u64, session_locked: Option<bool>) -> Option<&'static str> {
        if !self.is_enabled(cfg) || self.is_locked() {
            return None;
        }
        if self.rt().idle.expired(cfg.idle_minutes, now_ms) {
            return Some("inactivité");
        }
        if cfg.lock_on_session_lock && session_locked == Some(true) {
            return Some("session Windows verrouillée");
        }
        None
    }

    // ── Essais limités ────────────────────────────────────────────────────

    fn check_attempt(&self, now_ms: u64) -> Result<(), String> {
        self.rt().limiter.check(now_ms)
    }

    /// Enregistre un échec et construit le message (avec l'attente imposée)
    fn failure(&self, message: &str, now_ms: u64) -> String {
        let mut rt = self.rt();
        rt.limiter.record_failure(now_ms);
        match rt.limiter.retry_after_ms(now_ms) {
            0 => message.to_string(),
            wait => format!("{} — réessaie dans {} s", message, wait.div_ceil(1000)),
        }
    }

    fn succeeded(&self, now_ms: u64) {
        let mut rt = self.rt();
        rt.limiter.record_success();
        rt.idle.touch(now_ms);
    }

    // ── Déverrouillage ────────────────────────────────────────────────────

    /// Après un PIN ou Windows Hello : la clé brute est relue dans le coffre
    fn unlock_from_store(&self, now_ms: u64) -> Result<(), String> {
        match self.read_stored() {
            Ok(Some(StoredKey::Raw(key))) => self.vault.unlock(Some(key)),
            Ok(Some(StoredKey::Wrapped(_))) => {
                self.rt().master_password = true;
                return Err(PASSWORD_REQUIRED.into());
            }
            // Coffre vide ou illisible : même comportement qu'au démarrage, l'app
            // s'ouvre sans clé maître (les secrets concernés restent illisibles)
            Ok(None) => {
                log::warn!("Clé maître absente du coffre au déverrouillage");
                self.vault.unlock(None);
            }
            Err(e) => {
                log::warn!("{} — déverrouillage sans clé maître", e);
                self.vault.unlock(None);
            }
        }
        self.succeeded(now_ms);
        Ok(())
    }

    pub fn unlock_with_pin(&self, cfg: &LockConfig, pin: &str, now_ms: u64) -> Result<(), String> {
        self.check_attempt(now_ms)?;
        if self.master_password_active() {
            return Err(PASSWORD_REQUIRED.into());
        }
        if !cfg.method_usable() {
            return Err("Aucun PIN n'est configuré".into());
        }
        if policy::validate_pin(pin).is_err() || !crypto::verify_secret_phc(pin.as_bytes(), &cfg.pin_hash) {
            return Err(self.failure(WRONG_PIN, now_ms));
        }
        self.unlock_from_store(now_ms)
    }

    /// Windows Hello autorisé avec cette configuration ?
    pub fn check_hello_allowed(&self, cfg: &LockConfig) -> Result<(), String> {
        if self.master_password_active() {
            Err(PASSWORD_REQUIRED.into())
        } else if cfg.method != LockMethod::Hello || !cfg.method_usable() {
            Err("Windows Hello n'est pas la méthode de déverrouillage configurée".into())
        } else {
            Ok(())
        }
    }

    /// À appeler une fois la vérification Windows Hello réussie
    pub fn unlock_after_hello(&self, cfg: &LockConfig, now_ms: u64) -> Result<(), String> {
        self.check_hello_allowed(cfg)?;
        self.unlock_from_store(now_ms)
    }

    pub fn unlock_with_password(&self, password: &str, now_ms: u64) -> Result<(), String> {
        self.check_attempt(now_ms)?;
        if !self.master_password_active() {
            return Err("Aucun mot de passe maître n'est défini".into());
        }
        let Some(StoredKey::Wrapped(wrapped)) = self.read_stored()? else {
            return Err("La clé du coffre n'est pas protégée par un mot de passe maître".into());
        };
        match wrapped.open(password) {
            Ok(key) => {
                self.vault.unlock(Some(key));
                self.succeeded(now_ms);
                Ok(())
            }
            Err(e) if e == WRONG_MASTER_PASSWORD => Err(self.failure(WRONG_MASTER_PASSWORD, now_ms)),
            Err(e) => Err(e),
        }
    }

    /// Vérifie le secret actuel (mot de passe maître s'il est actif, sinon PIN)
    /// avant toute modification de la configuration. Sans verrouillage : rien à vérifier.
    pub fn verify_current(&self, cfg: &LockConfig, secret: Option<&str>, now_ms: u64) -> Result<(), String> {
        if !self.is_enabled(cfg) {
            return Ok(());
        }
        self.check_attempt(now_ms)?;
        let master = self.master_password_active();
        let Some(secret) = secret.filter(|s| !s.is_empty()) else {
            return Err(if master { "Saisis le mot de passe maître actuel" } else { "Saisis le PIN actuel" }.into());
        };
        if master {
            let Some(StoredKey::Wrapped(wrapped)) = self.read_stored()? else {
                return Err("La clé du coffre n'est pas protégée par un mot de passe maître".into());
            };
            return match wrapped.open(secret) {
                Ok(_) => {
                    self.succeeded(now_ms);
                    Ok(())
                }
                Err(e) if e == WRONG_MASTER_PASSWORD => Err(self.failure(WRONG_MASTER_PASSWORD, now_ms)),
                Err(e) => Err(e),
            };
        }
        if crypto::verify_secret_phc(secret.as_bytes(), &cfg.pin_hash) {
            self.succeeded(now_ms);
            Ok(())
        } else {
            Err(self.failure(WRONG_PIN, now_ms))
        }
    }

    // ── Configuration ─────────────────────────────────────────────────────

    /// Nouvelle configuration validée, PIN haché ; l'appelant l'enregistre.
    /// `new_pin` absent ou vide = garder le PIN actuel.
    pub fn build_config(
        &self,
        current: &LockConfig,
        payload: &LockConfigPayload,
        new_pin: Option<&str>,
        hello_available: bool,
    ) -> Result<LockConfig, String> {
        policy::validate_idle_minutes(payload.idle_minutes)?;
        let mut next = LockConfig {
            method: payload.method,
            pin_hash: current.pin_hash.clone(),
            idle_minutes: payload.idle_minutes,
            lock_on_session_lock: payload.lock_on_session_lock,
        };
        if payload.method == LockMethod::None {
            // Pas de hash orphelin : réactiver le verrouillage exigera un nouveau PIN
            next.pin_hash.clear();
            return Ok(next);
        }
        if payload.method == LockMethod::Hello && !hello_available {
            return Err("Windows Hello n'est pas disponible sur ce PC".into());
        }
        match new_pin.filter(|p| !p.is_empty()) {
            Some(pin) => {
                policy::validate_pin(pin)?;
                next.pin_hash = crypto::hash_secret_phc(pin.as_bytes(), &self.kdf)?;
            }
            None if next.pin_hash.is_empty() => {
                return Err(format!(
                    "Choisis un PIN de {} à {} chiffres{}",
                    policy::PIN_MIN_LEN,
                    policy::PIN_MAX_LEN,
                    if payload.method == LockMethod::Hello { " (secours si Windows Hello est indisponible)" } else { "" }
                ));
            }
            None => {}
        }
        Ok(next)
    }

    // ── Mot de passe maître ───────────────────────────────────────────────

    /// Enveloppe la clé maître : le coffre ne contient plus la clé brute.
    pub fn enable_master_password(&self, key_version: u8, password: &str) -> Result<(), String> {
        policy::validate_master_password(password)?;
        if self.master_password_active() {
            return Err("Un mot de passe maître est déjà défini".into());
        }
        if key_version < KEY_VERSION_MASTER {
            return Err("Les secrets sont encore protégés par l'ancienne clé dérivée : redémarre l'application \
                        pour terminer leur migration avant d'activer un mot de passe maître"
                .into());
        }
        let key = self.vault.master_key()?;
        let store = self.store()?;
        let previous = store.read()?.ok_or("Clé maître absente du coffre")?;
        match StoredKey::parse(&previous)? {
            StoredKey::Raw(k) if *k == *key => {}
            _ => return Err("La clé du coffre ne correspond pas à la clé en mémoire : redémarre l'application".into()),
        }
        let blob = self.sealed_verified(&key, password)?;
        keystore::replace_verified(store, &previous, &blob, &|s| opens_to(s, password, &key))?;
        self.rt().master_password = true;
        log::info!("Mot de passe maître activé");
        Ok(())
    }

    pub fn change_master_password(&self, current: &str, new: &str, now_ms: u64) -> Result<(), String> {
        policy::validate_master_password(new)?;
        let (previous, key) = self.open_current_wrapped(current, now_ms)?;
        let blob = self.sealed_verified(&key, new)?;
        keystore::replace_verified(self.store()?, &previous, &blob, &|s| opens_to(s, new, &key))?;
        log::info!("Mot de passe maître changé");
        Ok(())
    }

    /// Retire le mot de passe maître : la clé brute est réécrite dans le coffre
    pub fn remove_master_password(&self, current: &str, now_ms: u64) -> Result<(), String> {
        let (previous, key) = self.open_current_wrapped(current, now_ms)?;
        let raw = StoredKey::Raw(key.clone()).encode();
        keystore::replace_verified(self.store()?, &previous, &raw, &|s| matches!(s, StoredKey::Raw(k) if **k == *key))?;
        self.rt().master_password = false;
        log::info!("Mot de passe maître retiré");
        Ok(())
    }

    /// Ouvre l'enveloppe actuelle avec le mot de passe saisi (essais limités) et
    /// vérifie qu'elle contient bien la clé en mémoire.
    fn open_current_wrapped(&self, current: &str, now_ms: u64) -> Result<(Zeroizing<String>, Zeroizing<[u8; 32]>), String> {
        self.check_attempt(now_ms)?;
        let in_memory = self.vault.master_key()?;
        let store = self.store()?;
        let previous = store.read()?.ok_or("Clé maître absente du coffre")?;
        let StoredKey::Wrapped(wrapped) = StoredKey::parse(&previous)? else {
            return Err("Aucun mot de passe maître n'est défini".into());
        };
        let key = match wrapped.open(current) {
            Ok(k) => k,
            Err(e) if e == WRONG_MASTER_PASSWORD => return Err(self.failure(WRONG_MASTER_PASSWORD, now_ms)),
            Err(e) => return Err(e),
        };
        self.succeeded(now_ms);
        if *key != *in_memory {
            return Err("La clé du coffre ne correspond pas à la clé en mémoire : redémarre l'application".into());
        }
        Ok((previous, key))
    }

    /// Nouvelle enveloppe, vérifiée en mémoire avant de toucher au coffre
    fn sealed_verified(&self, key: &[u8; 32], password: &str) -> Result<String, String> {
        let wrapped = WrappedKey::seal(key, password, self.kdf)?;
        if *wrapped.open(password)? != *key {
            return Err("Vérification de l'enveloppe échouée".into());
        }
        Ok(wrapped.to_blob())
    }
}

/// Le contenu relu du coffre s'ouvre-t-il avec `password` sur la clé `key` ?
fn opens_to(stored: &StoredKey, password: &str, key: &[u8; 32]) -> bool {
    match stored {
        StoredKey::Wrapped(w) => w.open(password).map(|k| *k == *key).unwrap_or(false),
        StoredKey::Raw(_) => false,
    }
}

// ── Intégration à l'application Tauri ─────────────────────────────────────

/// Crée l'état du verrouillage au démarrage (coffre Windows, migration, état initial)
pub fn boot_app(state: &AppState) -> LockManager {
    let store: Option<Box<dyn SecretStore>> = match KeyringStore::open() {
        Ok(s) => Some(Box::new(s)),
        Err(e) => {
            log::warn!("{}", e);
            None
        }
    };
    let manager = LockManager::new(store, crypto::vault(), KdfParams::DEFAULT, now_ms());
    match state.data.lock() {
        Ok(mut data) => {
            manager.boot(&mut data, &state.data_path);
        }
        Err(e) => log::error!("Données inaccessibles au démarrage du verrouillage : {}", e),
    }
    manager
}

pub fn lock_config(app: &AppHandle) -> Result<LockConfig, String> {
    let state = app.state::<AppState>();
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.lock.clone())
}

pub fn status(app: &AppHandle) -> LockStatus {
    let cfg = lock_config(app).unwrap_or_default();
    app.state::<LockManager>().status(&cfg, now_ms())
}

pub fn emit_status(app: &AppHandle) {
    let _ = app.emit(LOCK_EVENT, status(app));
}

/// Verrouille l'application et coupe ce qui donne accès aux serveurs
pub fn lock_app(app: &AppHandle, reason: &str) -> Result<(), String> {
    let cfg = lock_config(app)?;
    app.state::<LockManager>().lock(&cfg)?;
    // Consoles SSH : sessions déjà authentifiées, fermées
    app.state::<crate::terminal::TerminalState>().close_all();
    // Onglets web : webviews natives, dessinées par-dessus l'écran de verrouillage
    if let Ok(webviews) = app.state::<crate::dashboard_state::DashboardState>().webviews.lock() {
        for webview in webviews.values() {
            let _ = webview.hide();
        }
    }
    crate::tray::refresh_menu(app);
    emit_status(app);
    log::info!("Application verrouillée ({})", reason);
    Ok(())
}

/// Suites d'un déverrouillage ou d'un changement de configuration
pub fn notify_changed(app: &AppHandle) {
    crate::tray::refresh_menu(app);
    emit_status(app);
}

/// Boucle de fond : c'est le backend qui décide du verrouillage automatique (les
/// minuteurs JavaScript d'une fenêtre masquée sont ralentis).
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let Ok(cfg) = lock_config(&app) else { continue };
            let manager = app.state::<LockManager>();
            if !manager.is_enabled(&cfg) || manager.is_locked() {
                continue;
            }
            // Appel WTS léger, seulement si l'option est active
            let session = if cfg.lock_on_session_lock { platform::session_locked() } else { None };
            if let Some(reason) = manager.should_auto_lock(&cfg, now_ms(), session) {
                if let Err(e) = lock_app(&app, reason) {
                    log::warn!("Verrouillage automatique impossible : {}", e);
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::{generate_key, TEST_KDF_PARAMS as FAST};
    use crate::keystore::memory::MemoryStore;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use std::sync::Arc;

    const T0: u64 = 1_700_000_000_000;

    /// Coffre partagé entre le test et le gestionnaire
    struct Shared(Arc<MemoryStore>);
    impl SecretStore for Shared {
        fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
            self.0.read()
        }
        fn write(&self, value: &str) -> Result<(), String> {
            self.0.write(value)
        }
    }

    fn leaked_vault() -> &'static KeyVault {
        Box::leak(Box::new(KeyVault::new()))
    }

    /// Gestionnaire démarré sur un coffre contenant une clé brute connue
    fn setup(cfg: &LockConfig) -> (LockManager, Arc<MemoryStore>, [u8; 32], AppData) {
        let key = generate_key();
        let store = Arc::new(MemoryStore::with(&STANDARD.encode(key)));
        let manager = LockManager::new(Some(Box::new(Shared(store.clone()))), leaked_vault(), FAST, T0);
        let mut data = AppData { key_version: KEY_VERSION_MASTER, lock: cfg.clone(), ..AppData::default() };
        manager.boot(&mut data, Path::new("inutilise.json"));
        (manager, store, key, data)
    }

    fn pin_config(pin: &str, method: LockMethod) -> LockConfig {
        LockConfig { method, pin_hash: crypto::hash_secret_phc(pin.as_bytes(), &FAST).unwrap(), idle_minutes: 10, lock_on_session_lock: true }
    }

    fn key_in_vault(m: &LockManager) -> Option<[u8; 32]> {
        m.vault.master_key().ok().map(|k| *k)
    }

    #[test]
    fn old_data_json_without_lock_block_means_lock_disabled() {
        let json = r#"{
            "servers": [], "groups": [],
            "settings": {
                "general": {"start_minimized": false, "auto_start": false, "notifications": true},
                "appearance": {"brightness": 1.0, "font_size": 14, "density": "Normal", "active_theme": "one-half-dark", "custom_themes": []},
                "network": {"ping_interval_secs": 30, "ping_timeout_ms": 2000, "ssh_timeout_secs": 30}
            },
            "encryption_salt": "abc123", "key_version": 2
        }"#;
        let data: AppData = serde_json::from_str(json).unwrap();
        assert_eq!(data.lock, LockConfig::default());
        let (m, _, key, _) = setup(&data.lock);
        assert!(!m.is_enabled(&data.lock));
        assert!(!m.is_locked(), "sans méthode, démarrage inchangé");
        assert_eq!(key_in_vault(&m), Some(key));
        assert_eq!(m.lock(&data.lock).unwrap_err(), NOT_CONFIGURED);
    }

    #[test]
    fn status_view_never_contains_the_pin_hash() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, _, _) = setup(&cfg);
        let json = serde_json::to_string(&m.status(&cfg, T0)).unwrap();
        assert!(!json.contains(&cfg.pin_hash));
        assert!(!json.contains("argon2"));
        assert!(json.contains("\"has_pin\":true"));
        assert!(!format!("{:?}", cfg).contains(&cfg.pin_hash), "Debug masque le hash");
        // Le hash est bien persisté dans data.json (et seulement là)
        assert!(serde_json::to_string(&cfg).unwrap().contains(&cfg.pin_hash));
    }

    #[test]
    fn pin_lock_starts_locked_and_unlocks_with_the_right_pin() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, key, mut data) = setup(&cfg);
        assert!(m.is_locked());
        assert_eq!(key_in_vault(&m), None, "clé effacée au démarrage verrouillé");
        data.key_version = KEY_VERSION_MASTER;
        assert_eq!(m.vault.data_key(&data).unwrap_err(), crypto::LOCKED_MESSAGE);

        assert_eq!(m.unlock_with_pin(&cfg, "0000", T0).unwrap_err(), WRONG_PIN);
        assert_eq!(m.unlock_with_pin(&cfg, "abc", T0).unwrap_err(), WRONG_PIN, "format invalide compté");
        assert!(m.is_locked());
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        assert!(!m.is_locked());
        assert_eq!(*m.vault.data_key(&data).unwrap(), key, "clé relue dans le coffre");
    }

    #[test]
    fn wrong_pins_trigger_growing_delays() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, _, _) = setup(&cfg);
        for _ in 0..2 {
            assert_eq!(m.unlock_with_pin(&cfg, "1111", T0).unwrap_err(), WRONG_PIN);
        }
        assert!(m.unlock_with_pin(&cfg, "1111", T0).unwrap_err().contains("réessaie dans 5 s"));
        // Pendant l'attente, même le bon PIN est refusé
        assert!(m.unlock_with_pin(&cfg, "4821", T0 + 1_000).unwrap_err().contains("Trop d'essais"));
        assert_eq!(m.status(&cfg, T0 + 1_000).retry_after_ms, 4_000);
        assert!(m.unlock_with_pin(&cfg, "1111", T0 + 5_000).unwrap_err().contains("10 s"));
        m.unlock_with_pin(&cfg, "4821", T0 + 15_000).unwrap();
        assert_eq!(m.status(&cfg, T0 + 15_000).retry_after_ms, 0);
    }

    #[test]
    fn lock_erases_key_and_refuses_then_unlock_restores_everything() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, key, data) = setup(&cfg);
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        assert!(m.vault.ensure_unlocked().is_ok());
        m.lock(&cfg).unwrap();
        assert_eq!(key_in_vault(&m), None);
        assert!(m.vault.ensure_unlocked().is_err());
        assert!(m.vault.data_key(&data).is_err());
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        assert_eq!(*m.vault.data_key(&data).unwrap(), key);
    }

    #[test]
    fn hello_unlock_requires_hello_method_and_no_master_password() {
        let pin_only = pin_config("4821", LockMethod::Pin);
        let (m, _, key, _) = setup(&pin_only);
        assert!(m.unlock_after_hello(&pin_only, T0).is_err());
        let hello = pin_config("4821", LockMethod::Hello);
        m.unlock_after_hello(&hello, T0).unwrap();
        assert_eq!(key_in_vault(&m), Some(key));
        // Le PIN de secours fonctionne aussi en mode Hello
        m.lock(&hello).unwrap();
        m.unlock_with_pin(&hello, "4821", T0).unwrap();
    }

    #[test]
    fn master_password_enable_unlock_change_remove() {
        let (m, store, key, data) = setup(&LockConfig::default());
        assert!(!m.is_locked());
        m.enable_master_password(data.key_version, "phrase secrète 1").unwrap();
        assert!(m.master_password_active());
        let blob = store.get().unwrap();
        assert!(blob.starts_with('{') && !blob.contains(&STANDARD.encode(key)), "clé brute retirée du coffre");

        // Le mot de passe maître suffit à activer le verrouillage
        let none = LockConfig::default();
        assert!(m.is_enabled(&none));
        m.lock(&none).unwrap();
        assert!(m.unlock_with_password("mauvais mot de passe", T0).unwrap_err().starts_with(WRONG_MASTER_PASSWORD));
        m.unlock_with_password("phrase secrète 1", T0).unwrap();
        assert_eq!(key_in_vault(&m), Some(key));

        m.change_master_password("phrase secrète 1", "phrase secrète 2", T0).unwrap();
        m.lock(&none).unwrap();
        assert!(m.unlock_with_password("phrase secrète 1", T0).is_err());
        m.unlock_with_password("phrase secrète 2", T0).unwrap();

        assert!(m.remove_master_password("pas le bon", T0).is_err());
        m.remove_master_password("phrase secrète 2", T0).unwrap();
        assert!(!m.master_password_active());
        assert_eq!(store.get().unwrap(), STANDARD.encode(key), "clé brute réécrite");
        assert!(!m.is_enabled(&none));
    }

    #[test]
    fn with_master_password_pin_and_hello_cannot_unlock() {
        let cfg = pin_config("4821", LockMethod::Hello);
        let (m, _, _, data) = setup(&cfg);
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        m.enable_master_password(data.key_version, "phrase secrète").unwrap();
        m.lock(&cfg).unwrap();
        assert_eq!(m.unlock_with_pin(&cfg, "4821", T0).unwrap_err(), PASSWORD_REQUIRED);
        assert_eq!(m.unlock_after_hello(&cfg, T0).unwrap_err(), PASSWORD_REQUIRED);
        assert!(m.is_locked());
        m.unlock_with_password("phrase secrète", T0).unwrap();
    }

    #[test]
    fn boot_with_wrapped_key_starts_locked_and_needs_the_password() {
        let key = generate_key();
        let blob = WrappedKey::seal(&key, "phrase secrète", FAST).unwrap().to_blob();
        let store = Arc::new(MemoryStore::with(&blob));
        let m = LockManager::new(Some(Box::new(Shared(store))), leaked_vault(), FAST, T0);
        let mut data = AppData { key_version: KEY_VERSION_MASTER, ..AppData::default() };
        assert!(m.boot(&mut data, Path::new("inutilise.json")), "blob enveloppé ⇒ démarrage verrouillé");
        assert!(m.master_password_active());
        assert_eq!(key_in_vault(&m), None);
        m.unlock_with_password("phrase secrète", T0).unwrap();
        assert_eq!(*m.vault.data_key(&data).unwrap(), key);
    }

    #[test]
    fn enabling_master_password_is_refused_on_legacy_key_or_bad_readback() {
        let (m, store, key, _) = setup(&LockConfig::default());
        assert!(m.enable_master_password(1, "phrase secrète").unwrap_err().contains("ancienne clé"));
        assert!(m.enable_master_password(KEY_VERSION_MASTER, "court").is_err());
        store.corrupt_next_write.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(m.enable_master_password(KEY_VERSION_MASTER, "phrase secrète").is_err());
        assert!(!m.master_password_active());
        assert_eq!(store.get().unwrap(), STANDARD.encode(key), "ancienne clé restaurée");
    }

    #[test]
    fn current_secret_is_required_to_change_the_configuration() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, _, _) = setup(&cfg);
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        assert!(m.verify_current(&cfg, None, T0).unwrap_err().contains("PIN actuel"));
        assert_eq!(m.verify_current(&cfg, Some("0000"), T0).unwrap_err(), WRONG_PIN);
        m.verify_current(&cfg, Some("4821"), T0).unwrap();
        // Sans verrouillage configuré, rien à vérifier
        assert!(m.verify_current(&LockConfig::default(), None, T0).is_ok());
    }

    #[test]
    fn build_config_validates_and_hashes_the_pin() {
        let (m, _, _, _) = setup(&LockConfig::default());
        let payload = |method, idle| LockConfigPayload { method, idle_minutes: idle, lock_on_session_lock: true };
        let none = LockConfig::default();
        let pin = LockMethod::Pin;
        assert!(m.build_config(&none, &payload(pin, 5), None, false).unwrap_err().contains("Choisis un PIN"));
        assert!(m.build_config(&none, &payload(pin, 5), Some("12"), false).is_err());
        assert!(m.build_config(&none, &payload(pin, 2000), Some("1234"), false).is_err());
        let hello = m.build_config(&none, &payload(LockMethod::Hello, 5), Some("1234"), false);
        assert!(hello.unwrap_err().contains("Windows Hello"));

        let cfg = m.build_config(&none, &payload(pin, 5), Some("1234"), false).unwrap();
        assert!(cfg.pin_hash.starts_with("$argon2id$") && !cfg.pin_hash.contains("1234"));
        assert!(crypto::verify_secret_phc(b"1234", &cfg.pin_hash));
        assert_eq!((cfg.idle_minutes, cfg.lock_on_session_lock), (5, true));
        // PIN vide = garder l'actuel
        let kept = m.build_config(&cfg, &payload(LockMethod::Hello, 5), Some(""), true).unwrap();
        assert_eq!(kept.pin_hash, cfg.pin_hash);
        // Désactivation : plus de hash orphelin
        let off = m.build_config(&cfg, &payload(LockMethod::None, 5), None, false).unwrap();
        assert!(off.pin_hash.is_empty());
    }

    // ── Gardes des commandes sensibles ────────────────────────────────────

    /// Corps d'une fonction (`fn nom(` jusqu'à la première accolade fermante en colonne 0)
    fn function_body<'a>(src: &'a str, name: &str) -> Option<&'a str> {
        let start = src.find(&format!("fn {}(", name))?;
        let rest = &src[start..];
        Some(&rest[..rest.find("\n}\n")?])
    }

    /// Chaque commande sensible appelle la garde : un oubli laisserait agir sur les
    /// serveurs (ou lire un secret) pendant le verrouillage.
    #[test]
    fn sensitive_commands_call_the_guard() {
        let sources: [(&str, &str, &[&str]); 10] = [
            ("ssh.rs", include_str!("../commands/ssh.rs"), &["connect_ssh", "ssh_shutdown", "ssh_reboot", "ssh_execute", "ssh_shutdown_group"]),
            ("terminal.rs", include_str!("../commands/terminal.rs"), &["terminal_open", "terminal_write", "terminal_resize"]),
            ("wol.rs", include_str!("../commands/wol.rs"), &["wake_on_lan", "wake_group_inner"]),
            ("settings.rs", include_str!("../commands/settings.rs"), &["export_config", "export_full_config"]),
            ("lab_power.rs", include_str!("../commands/lab_power.rs"), &["lab_power_plan", "lab_power_execute"]),
            ("batch.rs", include_str!("../commands/batch.rs"), &["run_batch", "batch_send_input", "ansible_run"]),
            ("schedules.rs", include_str!("../commands/schedules.rs"), &["run_schedule_now"]),
            ("probes.rs", include_str!("../commands/probes.rs"), &["run_probe_now"]),
            ("dashboards.rs", include_str!("../commands/dashboards.rs"), &["open_dashboard_tab", "set_dashboard_tab_visible"]),
            ("lock.rs", include_str!("../commands/lock.rs"), &["lock_configure", "master_password_enable", "master_password_change", "master_password_remove"]),
        ];
        for (file, src, functions) in sources {
            for f in functions {
                let body = function_body(src, f).unwrap_or_else(|| panic!("{} introuvable dans {}", f, file));
                assert!(body.contains("crypto::ensure_unlocked()?"), "{} : {} n'appelle pas crypto::ensure_unlocked()", file, f);
            }
        }
        // La commande de groupe et la zone de notification passent par la fonction gardée
        let wol = include_str!("../commands/wol.rs");
        assert!(function_body(wol, "wake_group").unwrap().contains("wake_group_inner("));
    }

    #[tokio::test]
    async fn ssh_connection_is_refused_before_any_network_access_while_locked() {
        // Coffre propre à ce thread de test (voir crypto::vault)
        crypto::set_master_key(generate_key());
        crypto::vault().lock();
        // Port 1 de la boucle locale : sans la garde, l'erreur serait « connexion refusée »
        let err = crate::commands::ssh::connect_ssh("127.0.0.1", 1, "root", "x", 2).await.err().unwrap();
        assert_eq!(err, crypto::LOCKED_MESSAGE);
        let err = crate::commands::ssh::execute_ssh("127.0.0.1", 1, "root", "x", "true", 2).await.unwrap_err();
        assert_eq!(err, crypto::LOCKED_MESSAGE);
        crypto::vault().unlock(None);
        let err = crate::commands::ssh::connect_ssh("127.0.0.1", 1, "root", "x", 2).await.err().unwrap();
        assert_ne!(err, crypto::LOCKED_MESSAGE, "déverrouillée, la connexion est tentée");
    }

    #[test]
    fn server_password_is_unreadable_while_locked() {
        let key = generate_key();
        crypto::set_master_key(key);
        let mut data = AppData { key_version: KEY_VERSION_MASTER, ..AppData::default() };
        let server = crate::models::Server::new(
            "minipc".into(), "192.168.1.10".into(), "02:00:00:00:00:01".into(), "root".into(),
            crypto::encrypt("hunter2", &key).unwrap(), 22, crate::models::OsType::Linux, None, None,
        );
        let id = server.id.clone();
        data.servers.push(server);
        let read = |d: &AppData| crate::commands::servers::get_decrypted_password(d, &id);
        assert_eq!(read(&data).unwrap(), "hunter2");
        crypto::vault().lock();
        assert_eq!(read(&data).unwrap_err(), crypto::LOCKED_MESSAGE);
        crypto::vault().unlock(Some(Zeroizing::new(key)));
        assert_eq!(read(&data).unwrap(), "hunter2");
    }

    #[test]
    fn auto_lock_on_idle_or_session_lock_only_when_enabled() {
        let cfg = pin_config("4821", LockMethod::Pin);
        let (m, _, _, _) = setup(&cfg);
        m.unlock_with_pin(&cfg, "4821", T0).unwrap();
        assert_eq!(m.should_auto_lock(&cfg, T0 + 9 * 60_000, Some(false)), None);
        assert_eq!(m.should_auto_lock(&cfg, T0 + 10 * 60_000, None), Some("inactivité"));
        m.touch(T0 + 10 * 60_000);
        assert_eq!(m.should_auto_lock(&cfg, T0 + 11 * 60_000, None), None);
        assert_eq!(m.should_auto_lock(&cfg, T0 + 11 * 60_000, Some(true)), Some("session Windows verrouillée"));
        let no_session = LockConfig { lock_on_session_lock: false, idle_minutes: 0, ..cfg.clone() };
        assert_eq!(m.should_auto_lock(&no_session, T0 + 99 * 60_000, Some(true)), None);
        // Verrouillage non configuré : jamais de verrouillage automatique
        assert_eq!(m.should_auto_lock(&LockConfig::default(), T0 + 99 * 60_000, Some(true)), None);
        // Déjà verrouillée : rien à faire
        m.lock(&cfg).unwrap();
        assert_eq!(m.should_auto_lock(&cfg, T0 + 99 * 60_000, Some(true)), None);
    }
}
