/// Module de chiffrement AES-256-GCM pour les mots de passe SSH
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

use crate::models::AppData;

/// Version du schéma de clé : 1 = clé dérivée du sel stocké dans data.json
/// (obfuscation seulement), 2 = clé maître aléatoire gardée dans le
/// Gestionnaire d'identification Windows.
pub const KEY_VERSION_MASTER: u8 = 2;

/// Clé maître chargée au démarrage depuis le coffre du système
static MASTER_KEY: OnceLock<[u8; 32]> = OnceLock::new();

pub fn set_master_key(key: [u8; 32]) {
    let _ = MASTER_KEY.set(key);
}

pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

/// Clé à utiliser pour chiffrer / déchiffrer les secrets de `data`
pub fn data_key(data: &AppData) -> Result<[u8; 32], String> {
    if data.key_version >= KEY_VERSION_MASTER {
        MASTER_KEY.get().copied().ok_or_else(|| {
            "Clé maître introuvable dans le Gestionnaire d'identification Windows : \
             ressaisis les mots de passe des serveurs"
                .to_string()
        })
    } else {
        Ok(derive_key(&data.encryption_salt))
    }
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
    for (s, enc) in data.servers.iter_mut().zip(servers) {
        s.ssh_password = enc;
    }
    for (c, enc) in data.proxmox_connections.iter_mut().zip(tokens) {
        c.token_secret = enc;
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(data_key(&data).unwrap(), derive_key(&data.encryption_salt));
    }
}
