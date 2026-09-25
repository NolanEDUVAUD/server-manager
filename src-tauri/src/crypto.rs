/// Module de chiffrement AES-256-GCM pour les secrets, coffre en mémoire de la clé
/// maître (verrouillable) et primitives Argon2id réutilisables (mot de passe maître,
/// PIN de verrouillage, future sauvegarde chiffrée).
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};
use zeroize::Zeroizing;

use crate::models::AppData;

/// Version du schéma de clé : 1 = clé dérivée du sel stocké dans data.json
/// (obfuscation seulement), 2 = clé maître aléatoire gardée dans le
/// Gestionnaire d'identification Windows.
pub const KEY_VERSION_MASTER: u8 = 2;

/// Erreur renvoyée par toute opération qui a besoin d'un secret pendant le verrouillage
pub const LOCKED_MESSAGE: &str = "Application verrouillée : déverrouille-la pour continuer";

// ── Coffre en mémoire de la clé maître ────────────────────────────────────

/// Clé maître en mémoire. Verrouiller efface la clé (`Zeroizing` la met à zéro
/// en la libérant) : tant que l'app est verrouillée, aucun secret n'est déchiffrable.
pub struct KeyVault {
    state: RwLock<VaultState>,
}

struct VaultState {
    key: Option<Zeroizing<[u8; 32]>>,
    locked: bool,
}

impl Default for KeyVault {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyVault {
    pub const fn new() -> Self {
        KeyVault { state: RwLock::new(VaultState { key: None, locked: false }) }
    }

    // Un verrou empoisonné (panique d'un autre thread) garde un état cohérent :
    // on le récupère plutôt que de laisser l'app sans accès au coffre.
    fn read(&self) -> RwLockReadGuard<'_, VaultState> {
        self.state.read().unwrap_or_else(|e| e.into_inner())
    }

    fn write(&self) -> RwLockWriteGuard<'_, VaultState> {
        self.state.write().unwrap_or_else(|e| e.into_inner())
    }

    /// Déverrouille ; `key` = None garde l'absence de clé (coffre Windows indisponible,
    /// secrets encore sous l'ancienne clé dérivée).
    pub fn unlock(&self, key: Option<Zeroizing<[u8; 32]>>) {
        let mut s = self.write();
        if key.is_some() {
            s.key = key;
        }
        s.locked = false;
    }

    /// Verrouille et efface la clé de la mémoire
    pub fn lock(&self) {
        let mut s = self.write();
        // L'ancienne valeur est libérée ici : Zeroizing la remet à zéro
        s.key = None;
        s.locked = true;
    }

    pub fn is_locked(&self) -> bool {
        self.read().locked
    }

    #[cfg(test)]
    pub fn has_key(&self) -> bool {
        self.read().key.is_some()
    }

    pub fn ensure_unlocked(&self) -> Result<(), String> {
        if self.is_locked() {
            Err(LOCKED_MESSAGE.to_string())
        } else {
            Ok(())
        }
    }

    /// Copie de la clé maître (effacée à la libération)
    pub fn master_key(&self) -> Result<Zeroizing<[u8; 32]>, String> {
        let s = self.read();
        if s.locked {
            return Err(LOCKED_MESSAGE.to_string());
        }
        s.key.clone().ok_or_else(missing_key_message)
    }

    /// Clé à utiliser pour chiffrer / déchiffrer les secrets de `data`
    pub fn data_key(&self, data: &AppData) -> Result<Zeroizing<[u8; 32]>, String> {
        let s = self.read();
        // Refus même pour l'ancien schéma (clé dérivée du sel) : verrouillée, l'app
        // ne déchiffre rien, quelle que soit la façon dont les secrets sont protégés.
        if s.locked {
            return Err(LOCKED_MESSAGE.to_string());
        }
        if data.key_version >= KEY_VERSION_MASTER {
            s.key.clone().ok_or_else(missing_key_message)
        } else {
            Ok(Zeroizing::new(derive_key(&data.encryption_salt)))
        }
    }
}

fn missing_key_message() -> String {
    "Clé maître introuvable dans le Gestionnaire d'identification Windows : \
     ressaisis les mots de passe des serveurs"
        .to_string()
}

/// Coffre global de l'application
#[cfg(not(test))]
static VAULT: KeyVault = KeyVault::new();

#[cfg(not(test))]
pub fn vault() -> &'static KeyVault {
    &VAULT
}

// En test, un coffre par thread : les tests tournent en parallèle dans le même
// processus, et le verrouillage d'un test ne doit pas faire échouer les autres.
#[cfg(test)]
thread_local! {
    static VAULT: &'static KeyVault = Box::leak(Box::new(KeyVault::new()));
}

#[cfg(test)]
pub fn vault() -> &'static KeyVault {
    VAULT.with(|v| *v)
}

/// Installe une clé et déverrouille (tests et outils de développement ; l'app passe
/// par `lock::LockManager::boot`)
#[cfg(test)]
pub fn set_master_key(key: [u8; 32]) {
    vault().unlock(Some(Zeroizing::new(key)));
}

/// Clé à utiliser pour chiffrer / déchiffrer les secrets de `data`
pub fn data_key(data: &AppData) -> Result<Zeroizing<[u8; 32]>, String> {
    vault().data_key(data)
}

/// Garde des commandes sensibles qui n'appellent pas forcément `data_key`
/// (WoL, console déjà ouverte, exports…)
pub fn ensure_unlocked() -> Result<(), String> {
    vault().ensure_unlocked()
}

pub fn is_locked() -> bool {
    vault().is_locked()
}

pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

/// Rechiffre tous les secrets (mots de passe SSH, secrets de jetons Proxmox)
/// de l'ancienne clé vers la nouvelle. Tout ou rien : en cas d'échec, `data`
/// n'est pas modifié.
pub fn reencrypt_all(data: &mut AppData, from: &[u8; 32], to: &[u8; 32]) -> Result<(), String> {
    let servers = data
        .servers
        .iter()
        .map(|s| encrypt(&decrypt(&s.ssh_password, from)?, to))
        .collect::<Result<Vec<_>, String>>()?;
    let tokens = data
        .proxmox_connections
        .iter()
        .map(|c| encrypt(&decrypt(&c.token_secret, from)?, to))
        .collect::<Result<Vec<_>, String>>()?;
    let integrations = data
        .integrations
        .iter()
        .map(|i| encrypt(&decrypt(&i.secret, from)?, to))
        .collect::<Result<Vec<_>, String>>()?;
    for (s, enc) in data.servers.iter_mut().zip(servers) {
        s.ssh_password = enc;
    }
    for (c, enc) in data.proxmox_connections.iter_mut().zip(tokens) {
        c.token_secret = enc;
    }
    for (i, enc) in data.integrations.iter_mut().zip(integrations) {
        i.secret = enc;
    }
    Ok(())
}

/// Génère un salt aléatoire de 32 bytes encodé en base64
pub fn generate_salt() -> String {
    let mut salt = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut salt);
    STANDARD.encode(salt)
}

/// Dérive une clé AES-256 (32 bytes) depuis un salt base64
/// Utilise SHA-256 avec une constante applicative pour éviter les collisions
pub fn derive_key(salt_b64: &str) -> [u8; 32] {
    let salt = STANDARD.decode(salt_b64).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(b"server-power-manager-v1-encryption-key");
    hasher.update(&salt);
    hasher.finalize().into()
}

/// Chiffre un mot de passe en clair avec AES-256-GCM
/// Retourne : base64(nonce_12_bytes || ciphertext)
pub fn encrypt(plaintext: &str, key_bytes: &[u8; 32]) -> Result<String, String> {
    if plaintext.is_empty() {
        return Ok(String::new());
    }

    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);

    // Nonce aléatoire de 12 bytes (requis par AES-GCM)
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Erreur de chiffrement: {}", e))?;

    // Concaténer nonce + ciphertext, puis encoder en base64
    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    Ok(STANDARD.encode(&combined))
}

/// Déchiffre un mot de passe chiffré avec AES-256-GCM
/// Attend : base64(nonce_12_bytes || ciphertext)
pub fn decrypt(encrypted_b64: &str, key_bytes: &[u8; 32]) -> Result<String, String> {
    if encrypted_b64.is_empty() {
        return Ok(String::new());
    }

    let combined = STANDARD
        .decode(encrypted_b64)
        .map_err(|e| format!("Erreur de décodage base64: {}", e))?;

    if combined.len() < 12 {
        return Err("Données chiffrées invalides (trop courtes)".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Déchiffrement échoué — clé incorrecte ou données corrompues".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Données UTF-8 invalides: {}", e))
}

// ── Argon2id + AES-GCM (mot de passe maître, PIN, sauvegardes chiffrées) ───

/// Longueur du sel des dérivations Argon2id
pub const KDF_SALT_LEN: usize = 16;

/// Paramètres Argon2id, stockés avec chaque blob qui en dépend
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    /// Mémoire en Kio
    pub m_kib: u32,
    /// Nombre de passes
    pub t: u32,
    /// Parallélisme
    pub p: u32,
}

impl KdfParams {
    /// m = 64 Mio, t = 3, p = 1
    pub const DEFAULT: KdfParams = KdfParams { m_kib: 64 * 1024, t: 3, p: 1 };

    /// Bornes : les paramètres sont relus depuis un blob, qui ne doit pas pouvoir
    /// réclamer des gigaoctets de mémoire ou des minutes de calcul.
    pub fn validate(&self) -> Result<(), String> {
        let ok = (1..=16).contains(&self.p)
            && (1..=16).contains(&self.t)
            && self.m_kib >= 8 * self.p
            && self.m_kib <= 1024 * 1024;
        if ok {
            Ok(())
        } else {
            Err("Paramètres Argon2id hors limites".to_string())
        }
    }

    fn argon2(&self) -> Result<Argon2<'static>, String> {
        self.validate()?;
        let params = Params::new(self.m_kib, self.t, self.p, Some(32))
            .map_err(|e| format!("Paramètres Argon2id invalides : {}", e))?;
        Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
    }
}

impl Default for KdfParams {
    fn default() -> Self {
        Self::DEFAULT
    }
}

pub fn random_kdf_salt() -> [u8; KDF_SALT_LEN] {
    let mut salt = [0u8; KDF_SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    salt
}

/// Dérive une clé de chiffrement de clé (KEK) de 32 octets par Argon2id
pub fn derive_kek(password: &[u8], salt: &[u8], params: &KdfParams) -> Result<Zeroizing<[u8; 32]>, String> {
    if salt.len() < 8 {
        return Err("Sel Argon2id trop court".to_string());
    }
    let mut out = Zeroizing::new([0u8; 32]);
    params
        .argon2()?
        .hash_password_into(password, salt, &mut out[..])
        .map_err(|e| format!("Dérivation Argon2id impossible : {}", e))?;
    Ok(out)
}

/// Chiffre des octets en AES-256-GCM (nonce aléatoire) ; `aad` est authentifié
/// sans être chiffré (version, paramètres du blob…). Retourne (nonce, chiffré).
pub fn seal(plaintext: &[u8], key: &[u8; 32], aad: &[u8]) -> Result<([u8; 12], Vec<u8>), String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|_| "Chiffrement impossible".to_string())?;
    Ok((nonce, ct))
}

/// Inverse de `seal`. Une clé fausse et des données altérées donnent la même
/// erreur, volontairement sans détail.
pub fn open(nonce: &[u8], ciphertext: &[u8], key: &[u8; 32], aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if nonce.len() != 12 {
        return Err("Nonce invalide".to_string());
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ciphertext, aad })
        .map(Zeroizing::new)
        .map_err(|_| "Déchiffrement refusé".to_string())
}

/// Enveloppe une clé de 32 octets avec une KEK
pub fn wrap_key(key: &[u8; 32], kek: &[u8; 32], aad: &[u8]) -> Result<([u8; 12], Vec<u8>), String> {
    seal(key, kek, aad)
}

/// Désenveloppe une clé de 32 octets
pub fn unwrap_key(nonce: &[u8], ciphertext: &[u8], kek: &[u8; 32], aad: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let plain = open(nonce, ciphertext, kek, aad)?;
    let mut key = Zeroizing::new([0u8; 32]);
    if plain.len() != 32 {
        return Err("Clé enveloppée de taille invalide".to_string());
    }
    key.copy_from_slice(&plain);
    Ok(key)
}

/// Hash Argon2id au format PHC (`$argon2id$v=19$m=…,t=…,p=…$sel$hash`)
pub fn hash_secret_phc(secret: &[u8], params: &KdfParams) -> Result<String, String> {
    let salt = SaltString::encode_b64(&random_kdf_salt()).map_err(|e| format!("Sel invalide : {}", e))?;
    params
        .argon2()?
        .hash_password(secret, &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("Hash Argon2id impossible : {}", e))
}

/// Vérifie un secret contre un hash PHC Argon2id (paramètres lus dans le hash, bornés)
pub fn verify_secret_phc(secret: &[u8], phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else { return false };
    if parsed.algorithm.as_str() != "argon2id" {
        return false;
    }
    let Ok(params) = Params::try_from(&parsed) else { return false };
    let bounded = KdfParams { m_kib: params.m_cost(), t: params.t_cost(), p: params.p_cost() };
    if bounded.validate().is_err() {
        return false;
    }
    Argon2::default().verify_password(secret, &parsed).is_ok()
}

/// Paramètres réduits pour les tests : ils n'ont pas besoin de 64 Mio par dérivation
#[cfg(test)]
pub(crate) const TEST_KDF_PARAMS: KdfParams = KdfParams { m_kib: 64, t: 1, p: 1 };

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: KdfParams = TEST_KDF_PARAMS;

    #[test]
    fn reencrypt_all_moves_secrets_to_the_new_key() {
        let mut data = AppData::default();
        let legacy = derive_key(&data.encryption_salt);
        let mut server = crate::models::Server::new(
            "s".into(), "10.0.0.1".into(), String::new(), "root".into(),
            encrypt("hunter2", &legacy).unwrap(), 22, crate::models::OsType::Linux, None, None,
        );
        data.servers.push(server.clone());
        server.ssh_password = String::new();
        data.servers.push(server);

        let master = generate_key();
        reencrypt_all(&mut data, &legacy, &master).unwrap();

        assert_eq!(decrypt(&data.servers[0].ssh_password, &master).unwrap(), "hunter2");
        assert!(decrypt(&data.servers[0].ssh_password, &legacy).is_err());
        assert_eq!(data.servers[1].ssh_password, "");
    }

    #[test]
    fn reencrypt_all_is_all_or_nothing() {
        let mut data = AppData::default();
        let legacy = derive_key(&data.encryption_salt);
        let ok = encrypt("a", &legacy).unwrap();
        let foreign = encrypt("b", &generate_key()).unwrap();
        for pwd in [ok.clone(), foreign] {
            data.servers.push(crate::models::Server::new(
                "s".into(), "10.0.0.1".into(), String::new(), "root".into(),
                pwd, 22, crate::models::OsType::Linux, None, None,
            ));
        }
        assert!(reencrypt_all(&mut data, &legacy, &generate_key()).is_err());
        assert_eq!(data.servers[0].ssh_password, ok);
    }

    #[test]
    fn data_key_uses_legacy_derivation_before_migration() {
        let data = AppData::default();
        assert_eq!(data.key_version, 1);
        assert_eq!(*data_key(&data).unwrap(), derive_key(&data.encryption_salt));
    }

    // ── Argon2id ──────────────────────────────────────────────────────────

    #[test]
    fn default_kdf_params_are_the_documented_ones() {
        assert_eq!(KdfParams::default(), KdfParams { m_kib: 65_536, t: 3, p: 1 });
        assert!(KdfParams::DEFAULT.validate().is_ok());
    }

    #[test]
    fn kek_derivation_is_deterministic_and_salted() {
        let salt = [7u8; KDF_SALT_LEN];
        let a = derive_kek(b"correct horse", &salt, &FAST).unwrap();
        let b = derive_kek(b"correct horse", &salt, &FAST).unwrap();
        assert_eq!(*a, *b);
        assert_ne!(*a, *derive_kek(b"correct horse", &[8u8; KDF_SALT_LEN], &FAST).unwrap());
        assert_ne!(*a, *derive_kek(b"correct horsE", &salt, &FAST).unwrap());
        // Les paramètres font partie de la dérivation
        let other = KdfParams { t: 2, ..FAST };
        assert_ne!(*a, *derive_kek(b"correct horse", &salt, &other).unwrap());
    }

    #[test]
    fn kek_derivation_rejects_out_of_bounds_params() {
        let salt = [1u8; KDF_SALT_LEN];
        for bad in [
            KdfParams { m_kib: 2 * 1024 * 1024, t: 3, p: 1 },
            KdfParams { m_kib: 64, t: 0, p: 1 },
            KdfParams { m_kib: 64, t: 1, p: 0 },
            KdfParams { m_kib: 64, t: 99, p: 1 },
        ] {
            assert!(derive_kek(b"x", &salt, &bad).is_err(), "{:?}", bad);
        }
        assert!(derive_kek(b"x", &[1u8; 4], &FAST).is_err(), "sel trop court");
    }

    #[test]
    fn wrap_round_trip_and_tamper_detection() {
        let key = generate_key();
        let kek = derive_kek(b"pw", &[3u8; 16], &FAST).unwrap();
        let (nonce, ct) = wrap_key(&key, &kek, b"ctx").unwrap();
        assert_eq!(*unwrap_key(&nonce, &ct, &kek, b"ctx").unwrap(), key);
        // Mauvaise KEK, données associées différentes, chiffré altéré : refus
        assert!(unwrap_key(&nonce, &ct, &generate_key(), b"ctx").is_err());
        assert!(unwrap_key(&nonce, &ct, &kek, b"autre").is_err());
        let mut altered = ct.clone();
        altered[0] ^= 1;
        assert!(unwrap_key(&nonce, &altered, &kek, b"ctx").is_err());
        assert!(unwrap_key(&nonce[..8], &ct, &kek, b"ctx").is_err());
    }

    #[test]
    fn phc_hash_verifies_only_the_right_secret() {
        let phc = hash_secret_phc(b"4821", &FAST).unwrap();
        assert!(phc.starts_with("$argon2id$v=19$m=64,t=1,p=1$"), "{}", phc);
        assert!(!phc.contains("4821"));
        assert!(verify_secret_phc(b"4821", &phc));
        assert!(!verify_secret_phc(b"4822", &phc));
        assert!(!verify_secret_phc(b"4821", "pas un hash"));
        // Deux hash du même secret diffèrent (sel aléatoire)
        assert_ne!(phc, hash_secret_phc(b"4821", &FAST).unwrap());
    }

    #[test]
    fn phc_with_other_algorithm_or_huge_params_is_rejected() {
        let phc = hash_secret_phc(b"4821", &FAST).unwrap();
        assert!(!verify_secret_phc(b"4821", &phc.replacen("argon2id", "argon2i", 1)));
        assert!(!verify_secret_phc(b"4821", &phc.replacen("m=64", "m=4194304", 1)));
    }

    // ── Coffre verrouillable ──────────────────────────────────────────────

    #[test]
    fn locked_vault_refuses_every_secret_then_unlocks() {
        let vault = KeyVault::new();
        let key = generate_key();
        vault.unlock(Some(Zeroizing::new(key)));
        let data = AppData { key_version: KEY_VERSION_MASTER, ..AppData::default() };
        assert_eq!(*vault.data_key(&data).unwrap(), key);

        vault.lock();
        assert!(vault.is_locked());
        assert_eq!(vault.data_key(&data).unwrap_err(), LOCKED_MESSAGE);
        assert_eq!(vault.ensure_unlocked().unwrap_err(), LOCKED_MESSAGE);
        assert!(vault.master_key().is_err());
        // Même l'ancien schéma (clé dérivée du sel) est refusé
        assert_eq!(vault.data_key(&AppData::default()).unwrap_err(), LOCKED_MESSAGE);

        vault.unlock(Some(Zeroizing::new(key)));
        assert!(vault.ensure_unlocked().is_ok());
        assert_eq!(*vault.data_key(&data).unwrap(), key);
    }

    #[test]
    fn locking_erases_the_key_from_memory() {
        let vault = KeyVault::new();
        vault.unlock(Some(Zeroizing::new(generate_key())));
        assert!(vault.has_key());
        vault.lock();
        assert!(!vault.has_key(), "la clé doit être effacée au verrouillage");
        // Déverrouiller sans clé (coffre Windows indisponible) ne la fait pas réapparaître
        vault.unlock(None);
        assert!(!vault.has_key());
        let data = AppData { key_version: KEY_VERSION_MASTER, ..AppData::default() };
        assert!(vault.data_key(&data).unwrap_err().contains("introuvable"));
    }

    #[test]
    fn global_guards_follow_the_vault() {
        // Coffre propre à ce thread de test (voir `vault()`)
        set_master_key(generate_key());
        assert!(ensure_unlocked().is_ok());
        vault().lock();
        assert!(is_locked());
        assert_eq!(ensure_unlocked().unwrap_err(), LOCKED_MESSAGE);
        assert_eq!(data_key(&AppData::default()).unwrap_err(), LOCKED_MESSAGE);
        vault().unlock(None);
        assert!(!is_locked());
    }
}
