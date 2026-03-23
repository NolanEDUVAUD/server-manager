/// Module de chiffrement AES-256-GCM pour les mots de passe SSH
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

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
