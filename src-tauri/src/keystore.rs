/// Coffre de la clé maître : Gestionnaire d'identification Windows (via `keyring`).
/// Il contient soit la clé brute (base64), soit, quand un mot de passe maître est
/// actif, la clé enveloppée par Argon2id + AES-256-GCM (blob JSON versionné).
use base64::{engine::general_purpose::STANDARD, Engine as _};
use keyring::Entry;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::crypto::{self, generate_key, KdfParams};

const SERVICE: &str = "com.homelab.server-manager";
const ACCOUNT: &str = "master-key";

/// Version du format du blob enveloppé
pub const WRAPPED_KEY_VERSION: u8 = 1;
/// Taille maximale acceptée à la lecture (le Gestionnaire d'identification plafonne à 2,5 Kio)
const MAX_BLOB_LEN: usize = 4096;

pub const WRONG_MASTER_PASSWORD: &str = "Mot de passe maître incorrect";

// ── Accès au coffre (abstrait pour les tests) ─────────────────────────────

pub trait SecretStore: Send + Sync {
    /// Contenu actuel ; None = aucune entrée
    fn read(&self) -> Result<Option<Zeroizing<String>>, String>;
    fn write(&self, value: &str) -> Result<(), String>;
}

/// Entrée du Gestionnaire d'identification Windows. Une seule `Entry`, réutilisée
/// pour toutes les opérations (écriture puis relecture de la même entrée).
pub struct KeyringStore {
    entry: Entry,
}

impl KeyringStore {
    pub fn open() -> Result<Self, String> {
        Entry::new(SERVICE, ACCOUNT)
            .map(|entry| KeyringStore { entry })
            .map_err(|e| format!("Coffre indisponible : {}", e))
    }
}

impl SecretStore for KeyringStore {
    fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
        match self.entry.get_password() {
            Ok(v) => Ok(Some(Zeroizing::new(v))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Lecture de la clé maître impossible : {}", e)),
        }
    }

    fn write(&self, value: &str) -> Result<(), String> {
        self.entry
            .set_password(value)
            .map_err(|e| format!("Impossible d'enregistrer la clé maître : {}", e))
    }
}

// ── Contenu du coffre ─────────────────────────────────────────────────────

/// Clé maître enveloppée par un mot de passe maître
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WrappedKey {
    pub v: u8,
    pub kdf: String,
    pub m: u32,
    pub t: u32,
    pub p: u32,
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

impl WrappedKey {
    /// Données associées authentifiées par AES-GCM : version et paramètres du blob
    fn aad(v: u8, params: &KdfParams) -> Vec<u8> {
        format!("server-power-manager/master-key/v{}/argon2id/m={},t={},p={}", v, params.m_kib, params.t, params.p).into_bytes()
    }

    pub fn params(&self) -> KdfParams {
        KdfParams { m_kib: self.m, t: self.t, p: self.p }
    }

    /// Enveloppe `key` avec une KEK dérivée de `password` (sel aléatoire)
    pub fn seal(key: &[u8; 32], password: &str, params: KdfParams) -> Result<Self, String> {
        let salt = crypto::random_kdf_salt();
        let kek = crypto::derive_kek(password.as_bytes(), &salt, &params)?;
        let (nonce, ct) = crypto::wrap_key(key, &kek, &Self::aad(WRAPPED_KEY_VERSION, &params))?;
        Ok(WrappedKey {
            v: WRAPPED_KEY_VERSION,
            kdf: "argon2id".into(),
            m: params.m_kib,
            t: params.t,
            p: params.p,
            salt: STANDARD.encode(salt),
            nonce: STANDARD.encode(nonce),
            ct: STANDARD.encode(ct),
        })
    }

    /// Désenveloppe avec les paramètres lus dans le blob. Mauvais mot de passe et
    /// blob altéré donnent la même erreur, sans détail.
    pub fn open(&self, password: &str) -> Result<Zeroizing<[u8; 32]>, String> {
        let params = self.params();
        let decode = |s: &str| STANDARD.decode(s).map_err(|_| unreadable());
        let (salt, nonce, ct) = (decode(&self.salt)?, decode(&self.nonce)?, decode(&self.ct)?);
        if salt.len() != crypto::KDF_SALT_LEN || nonce.len() != 12 {
            return Err(unreadable());
        }
        let kek = crypto::derive_kek(password.as_bytes(), &salt, &params)?;
        crypto::unwrap_key(&nonce, &ct, &kek, &Self::aad(self.v, &params)).map_err(|_| WRONG_MASTER_PASSWORD.to_string())
    }

    pub fn to_blob(&self) -> String {
        // Sérialiser une struct de chaînes et d'entiers ne peut pas échouer
        serde_json::to_string(self).unwrap_or_default()
    }

    pub fn from_blob(blob: &str) -> Result<Self, String> {
        if blob.len() > MAX_BLOB_LEN {
            return Err(unreadable());
        }
        let raw: serde_json::Value = serde_json::from_str(blob).map_err(|_| unreadable())?;
        // Version vérifiée avant le reste : un format futur doit donner un message clair
        match raw.get("v").and_then(|v| v.as_u64()) {
            Some(v) if v == u64::from(WRAPPED_KEY_VERSION) => {}
            Some(v) => {
                return Err(format!(
                    "Format de clé maître inconnu (version {}) : cette version de l'application ne sait pas le lire",
                    v
                ))
            }
            None => return Err(unreadable()),
        }
        let w: WrappedKey = serde_json::from_value(raw).map_err(|_| unreadable())?;
        if w.kdf != "argon2id" {
            return Err(format!("Dérivation de clé non prise en charge : {}", w.kdf));
        }
        w.params().validate()?;
        Ok(w)
    }
}

fn unreadable() -> String {
    "Clé maître du coffre illisible (format inattendu)".to_string()
}

/// Ce que contient le coffre
pub enum StoredKey {
    Raw(Zeroizing<[u8; 32]>),
    Wrapped(WrappedKey),
}

impl StoredKey {
    pub fn parse(value: &str) -> Result<Self, String> {
        let value = value.trim();
        if value.starts_with('{') {
            return WrappedKey::from_blob(value).map(StoredKey::Wrapped);
        }
        let bytes = Zeroizing::new(STANDARD.decode(value).map_err(|e| format!("Clé maître illisible : {}", e))?);
        if bytes.len() != 32 {
            return Err("Clé maître de taille invalide".into());
        }
        let mut key = Zeroizing::new([0u8; 32]);
        key.copy_from_slice(&bytes);
        Ok(StoredKey::Raw(key))
    }

    pub fn encode(&self) -> Zeroizing<String> {
        match self {
            StoredKey::Raw(k) => Zeroizing::new(STANDARD.encode(&k[..])),
            StoredKey::Wrapped(w) => Zeroizing::new(w.to_blob()),
        }
    }
}

/// Lit la clé du coffre, ou crée une clé brute si le coffre est vide.
pub fn load_or_create(store: &dyn SecretStore) -> Result<StoredKey, String> {
    if let Some(value) = store.read()? {
        return StoredKey::parse(&value);
    }
    let key = Zeroizing::new(generate_key());
    let encoded = StoredKey::Raw(key.clone()).encode();
    store.write(&encoded)?;
    // Relecture : on ne migre rien tant que la clé n'est pas réellement récupérable
    match store.read()?.map(|v| StoredKey::parse(&v)) {
        Some(Ok(StoredKey::Raw(k))) if *k == *key => {}
        _ => return Err("La clé maître relue ne correspond pas".into()),
    }
    log::info!("Clé maître créée dans le Gestionnaire d'identification Windows");
    Ok(StoredKey::Raw(key))
}

/// Remplace le contenu du coffre par `new`, relit et vérifie avec `check`. En cas
/// d'échec (écriture, relecture ou vérification), `previous` est réécrit : la clé
/// n'est jamais perdue, même si le coffre se comporte mal.
pub fn replace_verified(
    store: &dyn SecretStore,
    previous: &str,
    new: &str,
    check: &dyn Fn(&StoredKey) -> bool,
) -> Result<(), String> {
    let verified = store.write(new).and_then(|_| {
        let stored = store.read()?.ok_or("Clé maître absente après écriture")?;
        let parsed = StoredKey::parse(&stored)?;
        if check(&parsed) {
            Ok(())
        } else {
            Err("La clé maître relue ne correspond pas".to_string())
        }
    });
    if let Err(e) = verified {
        log::warn!("Écriture de la clé maître non vérifiée ({}), restauration de l'ancienne valeur", e);
        let restored = store.write(previous).and_then(|_| match store.read()? {
            Some(v) if v.as_str() == previous => Ok(()),
            _ => Err("relecture différente".to_string()),
        });
        return Err(match restored {
            Ok(()) => format!("Coffre non modifié : {}", e),
            Err(r) => format!("{} — restauration de l'ancienne clé impossible ({}) : ne ferme pas l'application", e, r),
        });
    }
    Ok(())
}

/// Clé brute du coffre (outils de développement). Refuse si un mot de passe maître est actif.
#[cfg(test)]
pub fn load_or_create_master_key() -> Result<[u8; 32], String> {
    match load_or_create(&KeyringStore::open()?)? {
        StoredKey::Raw(k) => Ok(*k),
        StoredKey::Wrapped(_) => Err("Clé maître protégée par un mot de passe maître".into()),
    }
}

/// Coffre en mémoire pour les tests, avec pannes simulées
#[cfg(test)]
pub mod memory {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemoryStore {
        pub value: Mutex<Option<String>>,
        /// La prochaine écriture enregistre une valeur corrompue
        pub corrupt_next_write: AtomicBool,
        pub fail_reads: AtomicBool,
    }

    impl MemoryStore {
        pub fn with(value: &str) -> Self {
            let s = Self::default();
            *s.value.lock().unwrap() = Some(value.to_string());
            s
        }
        pub fn get(&self) -> Option<String> {
            self.value.lock().unwrap().clone()
        }
    }

    impl SecretStore for MemoryStore {
        fn read(&self) -> Result<Option<Zeroizing<String>>, String> {
            if self.fail_reads.load(Ordering::SeqCst) {
                return Err("coffre indisponible".into());
            }
            Ok(self.value.lock().unwrap().clone().map(Zeroizing::new))
        }
        fn write(&self, value: &str) -> Result<(), String> {
            let v = if self.corrupt_next_write.swap(false, Ordering::SeqCst) { "corrompu".to_string() } else { value.to_string() };
            *self.value.lock().unwrap() = Some(v);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::memory::MemoryStore;
    use super::*;
    use crate::crypto::TEST_KDF_PARAMS as FAST;

    #[test]
    fn wrapped_key_round_trip_with_params_read_from_blob() {
        let key = generate_key();
        let params = KdfParams { m_kib: 128, t: 2, p: 1 };
        let blob = WrappedKey::seal(&key, "mot de passe maître", params).unwrap().to_blob();
        let parsed = WrappedKey::from_blob(&blob).unwrap();
        assert_eq!(parsed.params(), params, "paramètres relus depuis le blob");
        assert_eq!(parsed.v, WRAPPED_KEY_VERSION);
        assert_eq!(*parsed.open("mot de passe maître").unwrap(), key);
    }

    #[test]
    fn wrong_password_gives_a_clean_error() {
        let key = generate_key();
        let w = WrappedKey::seal(&key, "bon mot de passe", FAST).unwrap();
        let err = w.open("mauvais").unwrap_err();
        assert_eq!(err, WRONG_MASTER_PASSWORD);
        assert!(!err.contains(&STANDARD.encode(key)));
    }

    #[test]
    fn tampered_blob_is_refused() {
        let key = generate_key();
        let w = WrappedKey::seal(&key, "pw-pw-pw", FAST).unwrap();
        let mut ct = STANDARD.decode(&w.ct).unwrap();
        ct[5] ^= 0x40;
        let altered = WrappedKey { ct: STANDARD.encode(&ct), ..w.clone() };
        assert!(altered.open("pw-pw-pw").is_err());
        // Paramètres modifiés (authentifiés comme données associées) : refus aussi
        let reparam = WrappedKey { t: 2, ..w.clone() };
        assert!(reparam.open("pw-pw-pw").is_err());
        // Sel tronqué ou base64 invalide : erreur de format, pas de panique
        assert!(WrappedKey { salt: "AAAA".into(), ..w.clone() }.open("pw-pw-pw").is_err());
        assert!(WrappedKey { nonce: "@@".into(), ..w }.open("pw-pw-pw").is_err());
    }

    #[test]
    fn unknown_version_or_kdf_is_refused() {
        let w = WrappedKey::seal(&generate_key(), "pw", FAST).unwrap();
        let v2 = w.to_blob().replace("\"v\":1", "\"v\":2");
        assert!(WrappedKey::from_blob(&v2).unwrap_err().contains("version 2"));
        let scrypt = w.to_blob().replace("argon2id", "scrypt");
        assert!(WrappedKey::from_blob(&scrypt).is_err());
        assert!(WrappedKey::from_blob("{}").is_err());
        assert!(WrappedKey::from_blob(&"x".repeat(MAX_BLOB_LEN + 1)).is_err());
        let huge = w.to_blob().replace("\"m\":64", "\"m\":99999999");
        assert!(WrappedKey::from_blob(&huge).is_err(), "paramètres bornés");
    }

    #[test]
    fn blob_contains_no_trace_of_the_raw_key() {
        let key = generate_key();
        let w = WrappedKey::seal(&key, "Mot-De-Passe-Unique", FAST).unwrap();
        let blob = w.to_blob();
        let hex: String = key.iter().map(|b| format!("{:02x}", b)).collect();
        assert!(!blob.contains(&STANDARD.encode(key)));
        assert!(!blob.to_lowercase().contains(&hex));
        let ct = STANDARD.decode(&w.ct).unwrap();
        assert!(!ct.windows(32).any(|win| win == key), "clé brute dans le chiffré");
        assert!(!blob.contains("Mot-De-Passe-Unique"));
    }

    #[test]
    fn stored_key_parses_raw_and_wrapped() {
        let key = generate_key();
        match StoredKey::parse(&STANDARD.encode(key)).unwrap() {
            StoredKey::Raw(k) => assert_eq!(*k, key),
            StoredKey::Wrapped(_) => panic!("clé brute attendue"),
        }
        let blob = WrappedKey::seal(&key, "pw", FAST).unwrap().to_blob();
        assert!(matches!(StoredKey::parse(&blob).unwrap(), StoredKey::Wrapped(_)));
        assert!(StoredKey::parse("AAAA").is_err());
        assert!(StoredKey::parse("pas du base64 !").is_err());
    }

    #[test]
    fn load_or_create_creates_then_reuses_a_raw_key() {
        let store = MemoryStore::default();
        let StoredKey::Raw(first) = load_or_create(&store).unwrap() else { panic!() };
        let StoredKey::Raw(again) = load_or_create(&store).unwrap() else { panic!() };
        assert_eq!(*first, *again);
    }

    #[test]
    fn replace_verified_restores_previous_value_on_bad_readback() {
        let key = generate_key();
        let previous = STANDARD.encode(key);
        let store = MemoryStore::with(&previous);
        store.corrupt_next_write.store(true, std::sync::atomic::Ordering::SeqCst);
        let new = WrappedKey::seal(&key, "pw", FAST).unwrap().to_blob();
        let err = replace_verified(&store, &previous, &new, &|_| true).unwrap_err();
        assert!(err.contains("Coffre non modifié"), "{}", err);
        assert_eq!(store.get().as_deref(), Some(previous.as_str()));

        // Vérification métier négative : même restauration
        let err = replace_verified(&store, &previous, &new, &|_| false).unwrap_err();
        assert!(err.contains("ne correspond pas"));
        assert_eq!(store.get().as_deref(), Some(previous.as_str()));

        // Cas nominal
        replace_verified(&store, &previous, &new, &|s| matches!(s, StoredKey::Wrapped(_))).unwrap();
        assert_eq!(store.get().as_deref(), Some(new.as_str()));
    }
}
