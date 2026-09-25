/// Fichiers de clé PuTTY (.ppk) : lecture de l'en-tête et contrôle des paramètres avant le
/// déchiffrement, qui est confié à `ssh_key::PrivateKey::from_ppk` (ssh-key 0.7, via russh).
///
/// Format (documentation PuTTY, annexe C « PPK file format ») :
/// ```text
/// PuTTY-User-Key-File-3: ssh-ed25519
/// Encryption: aes256-cbc            (ou « none »)
/// Comment: …
/// Public-Lines: N    + N lignes base64 (blob public SSH)
/// Key-Derivation: Argon2id          (v3 chiffrée uniquement, avec Argon2-Memory/Passes/Parallelism/Salt)
/// Private-Lines: M   + M lignes base64 (blob privé, AES-256-CBC sans remplissage)
/// Private-MAC: hex
/// ```
/// ssh-key ne borne pas les paramètres Argon2 : un fichier piégé (Argon2-Memory énorme) ferait
/// échouer l'allocation et arrêterait l'app. Ils sont donc vérifiés ici, sans aucun calcul.
use crate::ssh_keys::KeyError;

/// Bornes des paramètres Argon2 (PuTTYgen utilise 8 Mio, quelques dizaines de passes, 1 fil)
const MAX_ARGON2_MEMORY_KIB: u32 = 256 * 1024;
const MAX_ARGON2_PASSES: u32 = 256;
const MAX_ARGON2_PARALLELISM: u32 = 16;
/// Nombre maximal de lignes base64 d'un bloc (le fichier fait de toute façon 64 Kio au plus)
const MAX_LINES: usize = 1024;

/// En-tête lisible sans phrase de passe
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PpkHeader {
    pub version: u8,
    pub algorithm: String,
    pub encrypted: bool,
    pub comment: String,
}

fn invalid(msg: &str) -> KeyError {
    KeyError::Invalid(format!("fichier PuTTY {}", msg))
}

/// Lit l'en-tête et vérifie la structure et les paramètres de dérivation de clé
pub fn header(content: &str) -> Result<PpkHeader, KeyError> {
    let mut lines = content.lines();
    let first = lines.next().unwrap_or_default();
    let (tag, algorithm) = first.split_once(": ").ok_or_else(|| invalid("mal formé"))?;
    let version = match tag {
        "PuTTY-User-Key-File-2" => 2,
        "PuTTY-User-Key-File-3" => 3,
        "PuTTY-User-Key-File-1" => {
            return Err(KeyError::Unsupported("format PPK v1 : réenregistre la clé avec un PuTTYgen récent".into()))
        }
        _ => return Err(invalid("de version inconnue")),
    };
    let mut encryption = None;
    let mut comment = None;
    let mut blocks = 0;
    while let Some(line) = lines.next() {
        let (key, value) = line.split_once(": ").ok_or_else(|| invalid("mal formé"))?;
        let value = value.trim();
        match key {
            "Encryption" => encryption = Some(value.to_string()),
            "Comment" => comment = Some(value.to_string()),
            "Public-Lines" | "Private-Lines" => {
                let count: usize = value.parse().map_err(|_| invalid("mal formé"))?;
                if count > MAX_LINES {
                    return Err(invalid("mal formé"));
                }
                for _ in 0..count {
                    lines.next().ok_or_else(|| invalid("tronqué"))?;
                }
                blocks += 1;
            }
            "Key-Derivation" => {
                if !matches!(value, "Argon2id" | "Argon2i" | "Argon2d") {
                    return Err(KeyError::Unsupported(format!("dérivation de clé « {} »", value)));
                }
            }
            "Argon2-Memory" | "Argon2-Passes" | "Argon2-Parallelism" => {
                let n: u32 = value.parse().map_err(|_| invalid("mal formé"))?;
                let max = match key {
                    "Argon2-Memory" => MAX_ARGON2_MEMORY_KIB,
                    "Argon2-Passes" => MAX_ARGON2_PASSES,
                    _ => MAX_ARGON2_PARALLELISM,
                };
                if n == 0 || n > max {
                    return Err(KeyError::Unsupported(format!("paramètre {} hors limites ({})", key, n)));
                }
            }
            "Argon2-Salt" | "Private-MAC" => {}
            _ => return Err(invalid("mal formé")),
        }
    }
    let encryption = encryption.ok_or_else(|| invalid("incomplet"))?;
    if encryption != "none" && encryption != "aes256-cbc" {
        return Err(KeyError::Unsupported(format!("chiffrement PPK « {} »", encryption)));
    }
    if blocks != 2 {
        return Err(invalid("incomplet"));
    }
    Ok(PpkHeader {
        version,
        algorithm: algorithm.trim().to_string(),
        encrypted: encryption != "none",
        comment: comment.unwrap_or_default(),
    })
}

/// Vecteurs de test : fichiers .ppk construits à partir d'une clé connue, au format exact de
/// PuTTYgen (vérifié octet par octet contre puttygen 0.81 pour une clé non chiffrée).
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use aes_gcm::aes::cipher::{BlockEncrypt, KeyInit};
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use russh::keys::ssh_key::{private::KeypairData, PrivateKey};
    use sha1::Digest as _;

    fn put_string(out: &mut Vec<u8>, bytes: &[u8]) {
        out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        out.extend_from_slice(bytes);
    }

    /// HMAC (RFC 2104) sur SHA-1 ou SHA-256 (blocs de 64 octets)
    fn hmac(sha256: bool, key: &[u8], data: &[u8]) -> Vec<u8> {
        let hash = |parts: &[&[u8]]| -> Vec<u8> {
            if sha256 {
                let mut h = <sha2::Sha256 as sha2::Digest>::new();
                parts.iter().for_each(|p| sha2::Digest::update(&mut h, p));
                sha2::Digest::finalize(h).to_vec()
            } else {
                let mut h = sha1::Sha1::new();
                parts.iter().for_each(|p| h.update(p));
                h.finalize().to_vec()
            }
        };
        let mut k = [0u8; 64];
        k[..key.len()].copy_from_slice(key);
        let ipad: Vec<u8> = k.iter().map(|b| b ^ 0x36).collect();
        let opad: Vec<u8> = k.iter().map(|b| b ^ 0x5c).collect();
        let inner = hash(&[&ipad, data]);
        hash(&[&opad, &inner])
    }

    fn sha1(parts: &[&[u8]]) -> Vec<u8> {
        let mut h = sha1::Sha1::new();
        parts.iter().for_each(|p| h.update(p));
        h.finalize().to_vec()
    }

    fn aes256_cbc_encrypt(key: &[u8], iv: &[u8], data: &mut [u8]) {
        let cipher = aes_gcm::aes::Aes256::new_from_slice(key).unwrap();
        let mut prev: [u8; 16] = iv.try_into().unwrap();
        for block in data.chunks_mut(16) {
            block.iter_mut().zip(prev).for_each(|(b, p)| *b ^= p);
            let ga = aes_gcm::aes::Block::from_mut_slice(block);
            cipher.encrypt_block(ga);
            prev.copy_from_slice(block);
        }
    }

    fn b64_lines(bytes: &[u8]) -> (usize, String) {
        let b64 = STANDARD.encode(bytes);
        let lines: Vec<&str> = b64.as_bytes().chunks(64).map(|c| std::str::from_utf8(c).unwrap()).collect();
        (lines.len(), lines.join("\n"))
    }

    /// Construit un fichier .ppk (PuTTY : clé ed25519 privée en chaîne de 32 octets, RSA en mpint).
    /// `argon` : (mémoire Kio, passes) pour une v3 chiffrée, petits pour garder le test rapide.
    pub(crate) fn encode_ppk(version: u8, key: &PrivateKey, passphrase: Option<&str>, argon: (u32, u32)) -> String {
        let algorithm = key.algorithm().as_str().to_string();
        let comment = key.comment().as_str_lossy().to_string();
        let public = key.public_key().to_bytes().unwrap();
        let mut private = Vec::new();
        match key.key_data() {
            KeypairData::Ed25519(k) => put_string(&mut private, &k.private.to_bytes()),
            KeypairData::Rsa(k) => {
                let p = k.private();
                for m in [p.d(), p.p(), p.q(), p.iqmp()] {
                    put_string(&mut private, m.as_bytes());
                }
            }
            _ => panic!("algorithme de test non géré"),
        }
        let encryption = if passphrase.is_some() { "aes256-cbc" } else { "none" };
        let pass = passphrase.unwrap_or("").as_bytes();
        let mut kdf_lines = String::new();
        let (aes_key, iv, mac_key): (Vec<u8>, Vec<u8>, Vec<u8>) = match (version, passphrase.is_some()) {
            (2, encrypted) => {
                let key = [sha1(&[&[0, 0, 0, 0], pass]), sha1(&[&[0, 0, 0, 1], pass])].concat()[..32].to_vec();
                let mac = sha1(&[b"putty-private-key-file-mac-key", if encrypted { pass } else { b"" }]);
                (key, vec![0; 16], mac)
            }
            (_, true) => {
                let salt = [0x5au8; 16];
                kdf_lines = format!(
                    "Key-Derivation: Argon2id\nArgon2-Memory: {}\nArgon2-Passes: {}\nArgon2-Parallelism: 1\nArgon2-Salt: {}\n",
                    argon.0,
                    argon.1,
                    salt.iter().map(|b| format!("{:02x}", b)).collect::<String>()
                );
                let params = argon2::Params::new(argon.0, argon.1, 1, Some(80)).unwrap();
                let mut out = [0u8; 80];
                argon2::Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params)
                    .hash_password_into(pass, &salt, &mut out)
                    .unwrap();
                (out[..32].to_vec(), out[32..48].to_vec(), out[48..].to_vec())
            }
            (_, false) => (vec![0; 32], vec![0; 16], Vec::new()),
        };
        if passphrase.is_some() {
            // Remplissage jusqu'à un multiple de 16 (PuTTY y met d'autres octets, sans importance)
            while private.len() % 16 != 0 {
                private.push(0xA5);
            }
        }
        let mut mac_input = Vec::new();
        for part in [algorithm.as_bytes(), encryption.as_bytes(), comment.as_bytes(), &public, &private] {
            put_string(&mut mac_input, part);
        }
        let mac = hmac(version == 3, &mac_key, &mac_input);
        if passphrase.is_some() {
            aes256_cbc_encrypt(&aes_key, &iv, &mut private);
        }
        let (pub_n, pub_b64) = b64_lines(&public);
        let (priv_n, priv_b64) = b64_lines(&private);
        format!(
            "PuTTY-User-Key-File-{}: {}\nEncryption: {}\nComment: {}\nPublic-Lines: {}\n{}\n{}Private-Lines: {}\n{}\nPrivate-MAC: {}\n",
            version,
            algorithm,
            encryption,
            comment,
            pub_n,
            pub_b64,
            kdf_lines,
            priv_n,
            priv_b64,
            mac.iter().map(|b| format!("{:02x}", b)).collect::<String>()
        )
    }

    #[test]
    fn header_is_read_without_passphrase() {
        let key = crate::ssh_keys::generate_ed25519("eddsa-key-20260925").unwrap();
        let file = encode_ppk(3, &key, Some("p"), (64, 1));
        assert_eq!(
            header(&file).unwrap(),
            PpkHeader { version: 3, algorithm: "ssh-ed25519".into(), encrypted: true, comment: "eddsa-key-20260925".into() }
        );
        assert!(!header(&encode_ppk(2, &key, None, (0, 0))).unwrap().encrypted);
    }

    #[test]
    fn dangerous_or_malformed_headers_are_refused() {
        let key = crate::ssh_keys::generate_ed25519("k").unwrap();
        let file = encode_ppk(3, &key, Some("p"), (64, 1));
        // Paramètres Argon2 démesurés refusés avant tout calcul (sinon allocation géante)
        let heavy = file.replace("Argon2-Memory: 64", "Argon2-Memory: 4194304");
        assert!(matches!(header(&heavy), Err(KeyError::Unsupported(_))));
        let passes = file.replace("Argon2-Passes: 1", "Argon2-Passes: 100000");
        assert!(matches!(header(&passes), Err(KeyError::Unsupported(_))));
        assert!(matches!(header("PuTTY-User-Key-File-1: ssh-rsa\n"), Err(KeyError::Unsupported(_))));
        assert!(header("PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n").is_err());
        let truncated: String = file.lines().take(5).collect::<Vec<_>>().join("\n");
        assert!(header(&truncated).is_err());
        assert!(matches!(header(&file.replace("aes256-cbc", "des-cbc")), Err(KeyError::Unsupported(_))));
    }
}
