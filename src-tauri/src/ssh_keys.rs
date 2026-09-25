/// Clés SSH de l'app : génération ed25519, import (OpenSSH, PuTTY .ppk), stockage chiffré par
/// la clé maître, et déploiement de la clé publique dans ~/.ssh/authorized_keys.
///
/// La clé privée n'existe en clair que dans des `Zeroizing` (lecture du fichier, conversion,
/// authentification) : au repos elle est chiffrée, et elle n'est jamais renvoyée au frontend.
use rand::RngCore;
use russh::keys::ssh_key::{
    self,
    private::{Ed25519Keypair, KeypairData},
    Algorithm, EcdsaCurve, HashAlg, LineEnding, PrivateKey,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use zeroize::Zeroizing;

use crate::{
    cron::shell_quote,
    models::{AppData, AuthMethod, OsType},
};

/// Taille maximale d'un fichier de clé importé (une clé RSA 16384 bits chiffrée fait ~13 Kio)
pub const MAX_KEY_FILE_BYTES: usize = 64 * 1024;
/// Nombre maximal de clés enregistrées
pub const MAX_KEYS: usize = 100;
const MAX_NAME_CHARS: usize = 64;
const MAX_COMMENT_CHARS: usize = 100;
/// Longueur maximale d'une ligne authorized_keys acceptée (RSA 16384 bits ≈ 2,8 Kio)
const MAX_PUBLIC_LINE_BYTES: usize = 8 * 1024;

/// Algorithmes de clé publique acceptés (ceux que russh 0.44 sait utiliser)
const SUPPORTED_ALGORITHMS: [&str; 5] =
    ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"];

// ── Modèle ────────────────────────────────────────────────────────────────

/// Clé enregistrée dans data.json
#[derive(Clone, Serialize, Deserialize)]
pub struct SshKey {
    pub id: String,
    pub name: String,
    /// « ssh-ed25519 », « ssh-rsa », « ecdsa-sha2-nistp256 »…
    pub algorithm: String,
    /// Ligne authorized_keys : « ssh-ed25519 AAAA… commentaire »
    pub public_key: String,
    /// Empreinte « SHA256:… »
    pub fingerprint: String,
    /// Clé privée au format OpenSSH, chiffrée AES-256-GCM par la clé maître (base64)
    pub private_key: String,
    /// Création (ms depuis l'époque Unix)
    pub created_at: i64,
}

/// `AppData` dérive `Debug` : la clé privée (même chiffrée) n'apparaît jamais dans un journal
impl fmt::Debug for SshKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SshKey")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("algorithm", &self.algorithm)
            .field("fingerprint", &self.fingerprint)
            .field("private_key", &"<chiffrée>")
            .finish()
    }
}

/// Vue envoyée au frontend : jamais la clé privée, seulement sa présence
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SshKeyView {
    pub id: String,
    pub name: String,
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub created_at: i64,
    pub has_private_key: bool,
}

impl From<&SshKey> for SshKeyView {
    fn from(k: &SshKey) -> Self {
        SshKeyView {
            id: k.id.clone(),
            name: k.name.clone(),
            algorithm: k.algorithm.clone(),
            public_key: k.public_key.clone(),
            fingerprint: k.fingerprint.clone(),
            created_at: k.created_at,
            has_private_key: !k.private_key.is_empty(),
        }
    }
}

/// Ce que l'on peut dire d'un fichier de clé sans la déchiffrer (affiché avant l'import)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct KeyFileInfo {
    pub file_name: String,
    /// « OpenSSH », « PuTTY (PPK v2) », « PuTTY (PPK v3) »
    pub format: String,
    pub encrypted: bool,
    pub algorithm: Option<String>,
    /// Commentaire lisible sans phrase de passe (PPK uniquement : chiffré dans une clé OpenSSH)
    pub comment: Option<String>,
}

// ── Erreurs d'import (jamais d'écho de la phrase de passe) ─────────────────

#[derive(Debug, PartialEq, Eq)]
pub enum KeyError {
    NeedsPassphrase,
    WrongPassphrase,
    TooLarge,
    Unsupported(String),
    Invalid(String),
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            KeyError::NeedsPassphrase => write!(f, "Cette clé est protégée par une phrase de passe : saisis-la"),
            KeyError::WrongPassphrase => write!(f, "Phrase de passe incorrecte"),
            KeyError::TooLarge => write!(f, "Fichier trop volumineux pour une clé SSH (64 Kio au plus)"),
            KeyError::Unsupported(m) => write!(f, "Clé non prise en charge : {}", m),
            KeyError::Invalid(m) => write!(f, "Fichier de clé invalide : {}", m),
        }
    }
}

impl From<KeyError> for String {
    fn from(e: KeyError) -> String {
        e.to_string()
    }
}

// ── Lecture d'un fichier de clé ───────────────────────────────────────────

const PEM_LEGACY: [&str; 5] = [
    "-----BEGIN RSA PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----",
    "-----BEGIN DSA PRIVATE KEY-----",
];

/// Contenu normalisé (BOM et fins de ligne Windows retirés), gardé dans un Zeroizing
fn normalize(content: &str) -> Zeroizing<String> {
    Zeroizing::new(content.trim_start_matches('\u{feff}').replace("\r\n", "\n").trim().to_string())
}

fn check_size(content: &str) -> Result<(), KeyError> {
    if content.len() > MAX_KEY_FILE_BYTES {
        return Err(KeyError::TooLarge);
    }
    Ok(())
}

fn unrecognized(content: &str) -> KeyError {
    if PEM_LEGACY.iter().any(|h| content.contains(h)) {
        return KeyError::Unsupported(
            "ancien format PEM. Convertis-la au format OpenSSH (« ssh-keygen -p -f fichier ») \
             ou exporte-la depuis PuTTYgen (Conversions → Export OpenSSH key)"
                .into(),
        );
    }
    if SUPPORTED_ALGORITHMS.iter().any(|a| content.starts_with(a)) || content.starts_with("ssh-") {
        return KeyError::Invalid("c'est une clé publique ; choisis le fichier de la clé privée (sans .pub)".into());
    }
    KeyError::Invalid("format non reconnu (clé OpenSSH ou PuTTY .ppk attendue)".into())
}

/// Format, chiffrement, algorithme et commentaire, sans phrase de passe
pub fn inspect(file_name: &str, content: &str) -> Result<KeyFileInfo, KeyError> {
    check_size(content)?;
    let content = normalize(content);
    if content.starts_with("PuTTY-User-Key-File-") {
        let h = crate::ppk::header(&content)?;
        return Ok(KeyFileInfo {
            file_name: file_name.to_string(),
            format: format!("PuTTY (PPK v{})", h.version),
            encrypted: h.encrypted,
            algorithm: Some(h.algorithm),
            comment: Some(sanitize_comment(&h.comment)).filter(|c| !c.is_empty()),
        });
    }
    if content.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        let key = PrivateKey::from_openssh(content.as_bytes())
            .map_err(|_| KeyError::Invalid("clé OpenSSH illisible".into()))?;
        return Ok(KeyFileInfo {
            file_name: file_name.to_string(),
            format: "OpenSSH".into(),
            encrypted: key.is_encrypted(),
            algorithm: Some(key.algorithm().as_str().to_string()),
            comment: Some(sanitize_comment(key.comment().as_str_lossy())).filter(|c| !c.is_empty()),
        });
    }
    Err(unrecognized(&content))
}

/// Déchiffre une clé .ppk avec ssh-key (en-tête et paramètres Argon2 vérifiés avant)
fn decode_ppk(content: &str, passphrase: Option<&str>) -> Result<PrivateKey, KeyError> {
    let header = crate::ppk::header(content)?;
    if header.encrypted && passphrase.is_none() {
        return Err(KeyError::NeedsPassphrase);
    }
    let passphrase = if header.encrypted { passphrase.map(str::to_string) } else { None };
    PrivateKey::from_ppk(content, passphrase).map_err(|e| match e {
        // Le type d'erreur PPK de ssh-key est privé : seul son nom (Debug) est comparé. Le texte
        // de l'erreur n'est jamais repris (il peut citer des lignes du fichier).
        ssh_key::Error::Ppk(p) if format!("{:?}", p) == "IncorrectMac" => {
            if header.encrypted {
                KeyError::WrongPassphrase
            } else {
                KeyError::Invalid("fichier PuTTY altéré (MAC incorrect)".into())
            }
        }
        // PuTTY écrit la clé privée ed25519 sur 32 octets bruts ; ssh-key la relit comme un entier
        // « mpint » et refuse le cas rare (≈ 1 clé sur 512) où elle commence par un octet nul.
        ssh_key::Error::Encoding(ssh_key::encoding::Error::MpintEncoding) if header.algorithm == "ssh-ed25519" => {
            KeyError::Unsupported(
                "cette clé PuTTY ed25519 ne peut pas être relue directement (cas rare). Exporte-la au format \
                 OpenSSH depuis PuTTYgen (Conversions → Export OpenSSH key) puis importe ce fichier"
                    .into(),
            )
        }
        ssh_key::Error::AlgorithmUnknown | ssh_key::Error::AlgorithmUnsupported { .. } => {
            KeyError::Unsupported(format!("algorithme {}", header.algorithm))
        }
        _ => KeyError::Invalid("fichier PuTTY illisible ou corrompu".into()),
    })
}

/// Lit une clé privée (OpenSSH ou PuTTY .ppk), en la déchiffrant avec la phrase de passe si besoin.
pub fn parse_private_key(content: &str, passphrase: Option<&str>) -> Result<PrivateKey, KeyError> {
    check_size(content)?;
    let content = normalize(content);
    let passphrase = passphrase.filter(|p| !p.is_empty());
    let key = if content.starts_with("PuTTY-User-Key-File-") {
        decode_ppk(&content, passphrase)?
    } else if content.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----") {
        let key = PrivateKey::from_openssh(content.as_bytes())
            .map_err(|_| KeyError::Invalid("clé OpenSSH illisible".into()))?;
        if key.is_encrypted() {
            let pass = passphrase.ok_or(KeyError::NeedsPassphrase)?;
            key.decrypt(pass).map_err(|e| match e {
                // Octets de contrôle incohérents après déchiffrement = mauvaise phrase de passe
                ssh_key::Error::Crypto => KeyError::WrongPassphrase,
                other => KeyError::Unsupported(format!("chiffrement de la clé ({})", other)),
            })?
        } else {
            key
        }
    } else {
        return Err(unrecognized(&content));
    };
    check_algorithm(&key)?;
    Ok(key)
}

/// N'accepte que ce que russh sait utiliser, et refuse les clés RSA trop courtes
fn check_algorithm(key: &PrivateKey) -> Result<(), KeyError> {
    match key.algorithm() {
        Algorithm::Ed25519 => Ok(()),
        Algorithm::Ecdsa { curve: EcdsaCurve::NistP256 | EcdsaCurve::NistP384 | EcdsaCurve::NistP521 } => Ok(()),
        Algorithm::Rsa { .. } => match key.key_data() {
            KeypairData::Rsa(k) if k.key_size() >= 2048 => Ok(()),
            _ => Err(KeyError::Unsupported("clé RSA de moins de 2048 bits".into())),
        },
        other => Err(KeyError::Unsupported(format!("algorithme {}", other.as_str()))),
    }
}

/// Nouvelle paire ed25519 (graine de 32 octets du générateur du système)
pub fn generate_ed25519(comment: &str) -> Result<PrivateKey, String> {
    let mut seed = Zeroizing::new([0u8; 32]);
    rand::rngs::OsRng
        .try_fill_bytes(&mut seed[..])
        .map_err(|e| format!("Génération de la clé impossible : {}", e))?;
    PrivateKey::new(KeypairData::Ed25519(Ed25519Keypair::from_seed(&seed)), sanitize_comment(comment))
        .map_err(|e| format!("Génération de la clé impossible : {}", e))
}

// ── Préparation au stockage ───────────────────────────────────────────────

/// Clé déchiffrée prête à être enregistrée : métadonnées publiques et PEM OpenSSH en clair
pub struct PreparedKey {
    pub algorithm: String,
    pub public_key: String,
    pub fingerprint: String,
    pub pem: Zeroizing<String>,
}

/// Normalise le commentaire, sérialise la clé au format OpenSSH non chiffré et vérifie que russh
/// saura s'en servir pour l'authentification.
pub fn prepare(mut key: PrivateKey) -> Result<PreparedKey, String> {
    if key.is_encrypted() {
        return Err("La clé est encore chiffrée".into());
    }
    let comment = sanitize_comment(key.comment().as_str_lossy());
    key.set_comment(comment);
    let public = key.public_key();
    let public_key = public.to_openssh().map_err(|e| format!("Clé publique illisible : {}", e))?;
    validate_public_line(&public_key)?;
    let fingerprint = public.fingerprint(HashAlg::Sha256).to_string();
    let algorithm = key.algorithm().as_str().to_string();
    let pem = key
        .to_openssh(LineEnding::LF)
        .map_err(|e| format!("Conversion de la clé impossible : {}", e))?;
    russh::keys::decode_secret_key(&pem, None)
        .map_err(|e| format!("Clé inutilisable pour l'authentification : {}", e))?;
    Ok(PreparedKey { algorithm, public_key, fingerprint, pem })
}

/// Chiffre la clé privée par la clé maître et construit l'entrée de data.json
pub fn seal(id: String, name: String, prepared: &PreparedKey, master: &[u8; 32], created_at: i64) -> Result<SshKey, String> {
    Ok(SshKey {
        id,
        name,
        algorithm: prepared.algorithm.clone(),
        public_key: prepared.public_key.clone(),
        fingerprint: prepared.fingerprint.clone(),
        private_key: crate::crypto::encrypt(&prepared.pem, master)?,
        created_at,
    })
}

/// Clé privée OpenSSH en clair, uniquement au moment de l'usage
pub fn decrypt_private_key(key: &SshKey, master: &[u8; 32]) -> Result<Zeroizing<String>, String> {
    let pem = Zeroizing::new(crate::crypto::decrypt(&key.private_key, master)?);
    if pem.is_empty() {
        return Err(format!("La clé SSH « {} » n'a pas de partie privée", key.name));
    }
    Ok(pem)
}

// ── Validation ────────────────────────────────────────────────────────────

/// Nom affiché : 1 à 64 caractères, sans caractère de contrôle, unique (sans tenir compte de la casse)
pub fn validate_name(name: &str, existing: &[SshKey], except_id: Option<&str>) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Le nom de la clé est requis".into());
    }
    if name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(format!("Nom de clé invalide ({} caractères au plus, sans retour à la ligne)", MAX_NAME_CHARS));
    }
    let taken = existing
        .iter()
        .any(|k| Some(k.id.as_str()) != except_id && k.name.to_lowercase() == name.to_lowercase());
    if taken {
        return Err(format!("Une clé s'appelle déjà « {} »", name));
    }
    Ok(name.to_string())
}

/// Commentaire de clé sûr : caractères imprimables, 100 au plus
pub fn sanitize_comment(comment: &str) -> String {
    comment
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(MAX_COMMENT_CHARS)
        .collect()
}

/// Vérifie une ligne authorized_keys produite par l'app et renvoie (algorithme, blob base64)
pub fn validate_public_line(line: &str) -> Result<(&str, &str), String> {
    let invalid = || "Clé publique invalide".to_string();
    if line.len() > MAX_PUBLIC_LINE_BYTES || line.chars().any(char::is_control) {
        return Err(invalid());
    }
    let mut parts = line.splitn(3, ' ');
    let algorithm = parts.next().ok_or_else(invalid)?;
    let blob = parts.next().ok_or_else(invalid)?;
    if !SUPPORTED_ALGORITHMS.contains(&algorithm)
        || blob.is_empty()
        || !blob.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '='))
    {
        return Err(invalid());
    }
    // Le blob doit être une vraie clé du même algorithme
    let parsed = ssh_key::PublicKey::from_openssh(line).map_err(|_| invalid())?;
    if parsed.algorithm().as_str() != algorithm {
        return Err(invalid());
    }
    Ok((algorithm, blob))
}

// ── Déploiement dans authorized_keys ──────────────────────────────────────

/// Marqueurs renvoyés par la commande de déploiement
pub const DEPLOY_ADDED: &str = "spm-key-added";
pub const DEPLOY_PRESENT: &str = "spm-key-present";

/// Les OS dont le fichier de clés autorisées n'est pas ~/.ssh/authorized_keys sont refusés
pub fn deploy_supported(os: &OsType) -> Result<(), String> {
    match os {
        OsType::Windows => Err(
            "Déploiement automatique impossible sur Windows : OpenSSH y lit C:\\ProgramData\\ssh\\administrators_authorized_keys \
             pour les administrateurs. Ajoute la clé publique à la main (bouton « Copier la clé publique »)."
                .into(),
        ),
        OsType::ESXi => Err(
            "Déploiement automatique impossible sur ESXi : les clés se trouvent dans /etc/ssh/keys-<utilisateur>/authorized_keys. \
             Ajoute la clé publique depuis l'interface ESXi (ou à la main)."
                .into(),
        ),
        _ => Ok(()),
    }
}

/// Commande POSIX idempotente : crée ~/.ssh (700) et authorized_keys (600) s'ils n'existent pas,
/// puis ajoute la ligne si le blob de la clé n'est pas déjà un mot d'une ligne non commentée.
/// Enveloppée dans `sh -c` pour ne pas dépendre du shell de connexion. Même logique que
/// `simulate_authorized_keys`, qui sert de référence aux tests.
pub fn deploy_command(public_line: &str) -> Result<String, String> {
    let (_, blob) = validate_public_line(public_line)?;
    let script = format!(
        concat!(
            r#"d="$HOME/.ssh"; f="$d/authorized_keys"; "#,
            r#"[ -d "$d" ] || mkdir -m 700 "$d" || exit 1; "#,
            r#"[ -f "$f" ] || (umask 077 && : > "$f") || exit 1; "#,
            r#"if grep -v '^[[:space:]]*#' "$f" | tr -s ' \t\r' '\n\n\n' | grep -qxF -- {blob}; then echo {present}; "#,
            r#"else if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then printf '\n' >> "$f" || exit 1; fi; "#,
            r#"printf '%s\n' {line} >> "$f" && echo {added}; fi"#,
        ),
        blob = shell_quote(blob),
        line = shell_quote(public_line),
        present = DEPLOY_PRESENT,
        added = DEPLOY_ADDED,
    );
    Ok(format!("sh -c {}", shell_quote(&script)))
}

/// Simule l'effet de `deploy_command` sur le contenu d'authorized_keys : (nouveau contenu, ajoutée ?).
/// Référence des tests d'idempotence (comparée à l'exécution réelle de la commande sous Unix).
#[cfg(test)]
pub fn simulate_authorized_keys(existing: &str, public_line: &str) -> (String, bool) {
    let blob = public_line.split(' ').nth(1).unwrap_or_default();
    // [[:space:]] de grep, puis découpage en mots de `tr -s ' \t\r'`
    let is_space = |c: char| matches!(c, ' ' | '\t' | '\r' | '\x0b' | '\x0c');
    let present = existing
        .split('\n')
        .filter(|l| !l.trim_start_matches(is_space).starts_with('#'))
        .any(|l| l.split([' ', '\t', '\r']).any(|t| t == blob));
    if present {
        return (existing.to_string(), false);
    }
    let mut out = existing.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(public_line);
    out.push('\n');
    (out, true)
}

/// Noms des serveurs qui s'authentifient avec cette clé
pub fn key_users(data: &AppData, key_id: &str) -> Vec<String> {
    data.servers
        .iter()
        .filter(|s| s.auth_method == AuthMethod::Key && s.ssh_key_id.as_deref() == Some(key_id))
        .map(|s| s.name.clone())
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::crypto;
    use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};

    pub(crate) fn sealed_key(name: &str, master: &[u8; 32]) -> (SshKey, Zeroizing<String>) {
        let prepared = prepare(generate_ed25519(&format!("server-manager {}", name)).unwrap()).unwrap();
        let key = seal(format!("id-{}", name), name.into(), &prepared, master, 1_700_000_000_000).unwrap();
        (key, prepared.pem)
    }

    #[test]
    fn generated_ed25519_has_valid_public_line_and_coherent_fingerprint() {
        let prepared = prepare(generate_ed25519("server-manager minipc").unwrap()).unwrap();
        let parts: Vec<&str> = prepared.public_key.splitn(3, ' ').collect();
        assert_eq!(parts[0], "ssh-ed25519");
        assert!(parts[1].starts_with("AAAAC3NzaC1lZDI1NTE5"), "{}", parts[1]);
        assert_eq!(parts[2], "server-manager minipc");
        assert_eq!(prepared.algorithm, "ssh-ed25519");
        // Empreinte recalculée indépendamment : SHA-256 du blob, base64 sans remplissage
        let blob = base64::engine::general_purpose::STANDARD.decode(parts[1]).unwrap();
        let expected = format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&blob)));
        assert_eq!(prepared.fingerprint, expected);
        assert!(prepared.pem.starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
        assert!(validate_public_line(&prepared.public_key).is_ok());
    }

    #[test]
    fn private_key_is_encrypted_at_rest_and_never_in_views_or_serialization() {
        let master = crypto::generate_key();
        let (key, pem) = sealed_key("minipc", &master);
        assert!(!key.private_key.contains("OPENSSH"));
        assert_eq!(*decrypt_private_key(&key, &master).unwrap(), *pem);
        assert!(decrypt_private_key(&key, &crypto::generate_key()).is_err());

        let mut data = AppData::default();
        data.ssh_keys.push(key.clone());
        let json = serde_json::to_string(&data).unwrap();
        assert!(!json.contains("BEGIN OPENSSH"));
        // Le corps base64 de la clé en clair n'apparaît nulle part
        let body: String = pem.lines().filter(|l| !l.starts_with("-----")).collect();
        assert!(!json.contains(&body[..40]));

        let view = serde_json::to_value(SshKeyView::from(&key)).unwrap();
        assert!(view.get("private_key").is_none());
        assert_eq!(view["has_private_key"], true);
        assert!(!view.to_string().contains(&key.private_key));
        // Debug (journaux) : ni le clair ni le chiffré
        let dbg = format!("{:?}", data);
        assert!(!dbg.contains(&key.private_key) && !dbg.contains("BEGIN OPENSSH"));
    }

    #[test]
    fn reencrypt_all_moves_ssh_keys_to_the_new_key() {
        let legacy = crypto::generate_key();
        let master = crypto::generate_key();
        let mut data = AppData::default();
        let (key, pem) = sealed_key("DockerHost", &legacy);
        data.ssh_keys.push(key);
        crypto::reencrypt_all(&mut data, &legacy, &master).unwrap();
        assert_eq!(*decrypt_private_key(&data.ssh_keys[0], &master).unwrap(), *pem);
        assert!(decrypt_private_key(&data.ssh_keys[0], &legacy).is_err());
    }

    #[test]
    fn openssh_import_plain_and_encrypted() {
        let original = generate_ed25519("Workstation").unwrap();
        let fp = original.fingerprint(HashAlg::Sha256);

        let plain = original.to_openssh(LineEnding::LF).unwrap();
        assert_eq!(parse_private_key(&plain, None).unwrap().fingerprint(HashAlg::Sha256), fp);
        // Fins de ligne Windows et BOM tolérés
        let crlf = format!("\u{feff}{}", plain.replace('\n', "\r\n"));
        assert_eq!(parse_private_key(&crlf, None).unwrap().fingerprint(HashAlg::Sha256), fp);

        let encrypted = original.encrypt(&mut rand_ssh::rng(), "correct horse").unwrap().to_openssh(LineEnding::LF).unwrap();
        let info = inspect("id_ed25519", &encrypted).unwrap();
        assert!(info.encrypted);
        assert_eq!(info.format, "OpenSSH");
        assert_eq!(info.algorithm.as_deref(), Some("ssh-ed25519"));

        assert_eq!(parse_private_key(&encrypted, None).unwrap_err(), KeyError::NeedsPassphrase);
        assert_eq!(parse_private_key(&encrypted, Some("")).unwrap_err(), KeyError::NeedsPassphrase);
        let wrong = parse_private_key(&encrypted, Some("wrong-horse-secret")).unwrap_err();
        assert_eq!(wrong, KeyError::WrongPassphrase);
        assert!(!wrong.to_string().contains("wrong-horse-secret"));
        let key = parse_private_key(&encrypted, Some("correct horse")).unwrap();
        assert_eq!(key.fingerprint(HashAlg::Sha256), fp);
        // Rechiffrée par l'app : plus besoin de la phrase de passe
        let prepared = prepare(key).unwrap();
        assert!(parse_private_key(&prepared.pem, None).is_ok());
    }

    /// Clé RSA 2048 bits de test, générée une seule fois (la génération est lente en debug)
    pub(crate) fn rsa() -> PrivateKey {
        static KEY: std::sync::OnceLock<PrivateKey> = std::sync::OnceLock::new();
        KEY.get_or_init(|| {
            let kp = ssh_key::private::RsaKeypair::random(&mut rand_ssh::rng(), 2048).unwrap();
            PrivateKey::new(KeypairData::Rsa(kp), "rsa-key-20260925").unwrap()
        })
        .clone()
    }

    fn same_key(expected: &PrivateKey, imported: PrivateKey) {
        assert_eq!(expected.fingerprint(HashAlg::Sha256), imported.fingerprint(HashAlg::Sha256));
        assert_eq!(expected.comment().as_str_lossy(), imported.comment().as_str_lossy());
        // Clé privée cohérente et utilisable par russh une fois réécrite au format OpenSSH
        if let KeypairData::Ed25519(kp) = imported.key_data() {
            assert_eq!(Ed25519Keypair::from(kp.private.clone()).public, kp.public);
        }
        prepare(imported).unwrap();
    }

    #[test]
    fn ppk_v2_and_v3_plain_and_encrypted() {
        use crate::ppk::tests::encode_ppk;
        let ed = generate_ed25519("eddsa-key-20260925").unwrap();
        for version in [2, 3] {
            let plain = encode_ppk(version, &ed, None, (0, 0));
            let info = inspect("cle.ppk", &plain).unwrap();
            assert_eq!((info.format.as_str(), info.encrypted), (if version == 2 { "PuTTY (PPK v2)" } else { "PuTTY (PPK v3)" }, false));
            same_key(&ed, parse_private_key(&plain, None).unwrap());
            // Fins de ligne Windows tolérées ; phrase de passe superflue ignorée
            same_key(&ed, parse_private_key(&plain.replace('\n', "\r\n"), Some("inutile")).unwrap());

            let enc = encode_ppk(version, &ed, Some("phrase secrète"), (64, 1));
            assert!(inspect("cle.ppk", &enc).unwrap().encrypted);
            assert_eq!(parse_private_key(&enc, None).unwrap_err(), KeyError::NeedsPassphrase);
            let wrong = parse_private_key(&enc, Some("pas-la-bonne")).unwrap_err();
            assert_eq!(wrong, KeyError::WrongPassphrase);
            assert!(!wrong.to_string().contains("pas-la-bonne"));
            same_key(&ed, parse_private_key(&enc, Some("phrase secrète")).unwrap());
        }
    }

    #[test]
    fn ppk_rsa_and_tampering() {
        use crate::ppk::tests::encode_ppk;
        let key = rsa();
        for (version, pass) in [(2, Some("p")), (3, None), (3, Some("p"))] {
            let file = encode_ppk(version, &key, pass, (64, 1));
            same_key(&key, parse_private_key(&file, pass).unwrap());
        }
        let prepared = prepare(parse_private_key(&encode_ppk(3, &key, None, (0, 0)), None).unwrap()).unwrap();
        assert!(prepared.public_key.starts_with("ssh-rsa AAAAB3NzaC1yc2E"));
        assert_eq!(prepared.algorithm, "ssh-rsa");
        // Commentaire modifié : le MAC ne correspond plus
        let ed = generate_ed25519("eddsa-key-20260925").unwrap();
        let tampered = encode_ppk(3, &ed, None, (0, 0)).replace("Comment: eddsa-key-20260925", "Comment: autre");
        assert!(parse_private_key(&tampered, None).unwrap_err().to_string().contains("MAC"));
        // Paramètres Argon2 démesurés : refusés avant tout calcul
        let heavy = encode_ppk(3, &ed, Some("p"), (64, 1)).replace("Argon2-Memory: 64", "Argon2-Memory: 4194304");
        assert!(matches!(parse_private_key(&heavy, Some("p")), Err(KeyError::Unsupported(_))));
    }

    #[test]
    fn import_rejects_oversized_public_and_legacy_files() {
        assert_eq!(parse_private_key(&"A".repeat(MAX_KEY_FILE_BYTES + 1), None).unwrap_err(), KeyError::TooLarge);
        let public = prepare(generate_ed25519("x").unwrap()).unwrap().public_key;
        assert!(parse_private_key(&public, None).unwrap_err().to_string().contains("clé publique"));
        let legacy = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n";
        assert!(parse_private_key(legacy, None).unwrap_err().to_string().contains("ssh-keygen -p"));
        assert!(matches!(parse_private_key("bonjour", None), Err(KeyError::Invalid(_))));
    }

    #[test]
    fn names_are_validated_and_unique() {
        let master = crypto::generate_key();
        let (key, _) = sealed_key("minipc", &master);
        let keys = vec![key];
        assert_eq!(validate_name("  Portable  ", &keys, None).unwrap(), "Portable");
        assert!(validate_name("", &keys, None).is_err());
        assert!(validate_name("a\nb", &keys, None).is_err());
        assert!(validate_name(&"x".repeat(65), &keys, None).is_err());
        assert!(validate_name("MINIPC", &keys, None).is_err());
        // Renommer une clé en elle-même est permis
        assert!(validate_name("MiniPC", &keys, Some("id-minipc")).is_ok());
        assert_eq!(sanitize_comment("a\tb\n\u{7}c   d"), "a b c d");
    }

    #[test]
    fn public_line_validation() {
        let line = prepare(generate_ed25519("ok").unwrap()).unwrap().public_key;
        assert!(validate_public_line(&line).is_ok());
        assert!(validate_public_line(&format!("{}\nssh-ed25519 AAAA evil", line)).is_err());
        assert!(validate_public_line("ssh-dss AAAAB3NzaC1kc3M= x").is_err());
        assert!(validate_public_line("ssh-ed25519 'quoted' x").is_err());
        // Blob d'un autre algorithme annoncé comme ed25519
        let blob = line.split(' ').nth(1).unwrap();
        assert!(validate_public_line(&format!("ssh-rsa {}", blob)).is_err());
    }

    fn line_with_comment(comment: &str) -> String {
        prepare(generate_ed25519(comment).unwrap()).unwrap().public_key
    }

    #[test]
    fn deploy_command_quotes_the_key() {
        let line = line_with_comment("l'admin; rm -rf / $(id)");
        let cmd = deploy_command(&line).unwrap();
        assert!(cmd.starts_with("sh -c '"));
        assert!(cmd.contains(DEPLOY_ADDED) && cmd.contains(DEPLOY_PRESENT));
        // La ligne n'apparaît que protégée : son apostrophe est échappée deux fois (script puis sh -c)
        assert!(!cmd.contains("l'admin"));
        assert!(cmd.contains("mkdir -m 700") && cmd.contains("umask 077"));
        assert!(deploy_command("ssh-ed25519 AAAA\nrm -rf /").is_err());
    }

    #[test]
    fn simulated_deploy_is_idempotent_and_preserves_content() {
        let line = line_with_comment("server-manager minipc");
        let blob = line.split(' ').nth(1).unwrap();

        // Fichier absent (vide) : une ligne
        let (once, added) = simulate_authorized_keys("", &line);
        assert!(added);
        assert_eq!(once, format!("{}\n", line));
        let (twice, added_again) = simulate_authorized_keys(&once, &line);
        assert!(!added_again);
        assert_eq!(twice, once);

        // Lignes existantes, commentaires, fichier sans saut de ligne final
        let existing = "# clés de l'équipe\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther autre@poste";
        let (out, added) = simulate_authorized_keys(existing, &line);
        assert!(added);
        assert_eq!(out, format!("{}\n{}\n", existing, line));
        assert_eq!(simulate_authorized_keys(&out, &line), (out.clone(), false));
        assert_eq!(out.matches(blob).count(), 1);

        // Déjà présente avec des options et un autre commentaire : rien à faire
        let with_options = format!("from=\"192.168.1.0/24\",no-pty ssh-ed25519 {} ancien-commentaire\r\n", blob);
        assert_eq!(simulate_authorized_keys(&with_options, &line), (with_options.clone(), false));
        // Une ligne commentée ne compte pas
        let commented = format!("  # ssh-ed25519 {} désactivée\n", blob);
        let (out, added) = simulate_authorized_keys(&commented, &line);
        assert!(added);
        assert!(out.starts_with(&commented));
    }

    /// Exécute la vraie commande avec un HOME temporaire : même résultat que la simulation
    #[cfg(unix)]
    #[test]
    fn real_deploy_command_matches_simulation() {
        use std::os::unix::fs::PermissionsExt;
        let line = line_with_comment("l'admin \"test\" $HOME");
        let cmd = deploy_command(&line).unwrap();
        let run = |home: &std::path::Path| {
            let out = std::process::Command::new("sh").arg("-c").arg(&cmd).env("HOME", home).output().unwrap();
            assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        let read = |home: &std::path::Path| std::fs::read_to_string(home.join(".ssh/authorized_keys")).unwrap();

        // HOME vierge : dossier 700, fichier 600, une seule ligne après deux passages
        let home = std::env::temp_dir().join(format!("spm-deploy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        assert_eq!(run(&home), DEPLOY_ADDED);
        assert_eq!(run(&home), DEPLOY_PRESENT);
        assert_eq!(read(&home), simulate_authorized_keys("", &line).0);
        let mode = |p: std::path::PathBuf| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(home.join(".ssh")), 0o700);
        assert_eq!(mode(home.join(".ssh/authorized_keys")), 0o600);

        // Fichier existant sans saut de ligne final, avec commentaires et une clé commentée
        let blob = line.split(' ').nth(1).unwrap();
        let existing = format!("# équipe\n\n# ssh-ed25519 {} ancienne\nssh-rsa AAAAB3NzaC1yc2E autre", blob);
        std::fs::write(home.join(".ssh/authorized_keys"), &existing).unwrap();
        assert_eq!(run(&home), DEPLOY_ADDED);
        assert_eq!(run(&home), DEPLOY_PRESENT);
        assert_eq!(read(&home), simulate_authorized_keys(&existing, &line).0);
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn deploy_is_refused_where_authorized_keys_lives_elsewhere() {
        assert!(deploy_supported(&OsType::Windows).unwrap_err().contains("administrators_authorized_keys"));
        assert!(deploy_supported(&OsType::ESXi).unwrap_err().contains("keys-"));
        assert!(deploy_supported(&OsType::Linux).is_ok());
        assert!(deploy_supported(&OsType::Proxmox).is_ok());
    }

    #[test]
    fn old_data_json_without_key_fields_defaults_to_password() {
        let json = r#"{
            "servers": [{"id":"1","name":"minipc","ip":"192.168.1.10","mac_address":"","ssh_user":"root",
                "ssh_password":"","ssh_port":22,"shutdown_command":"poweroff","reboot_command":"reboot",
                "os_type":"Linux","icon":null,"notes":null}],
            "groups": [],
            "settings": {
                "general": {"start_minimized": false, "auto_start": false, "notifications": true},
                "appearance": {"brightness": 1.0, "font_size": 14, "density": "Normal", "active_theme": "one-half-dark", "custom_themes": []},
                "network": {"ping_interval_secs": 30, "ping_timeout_ms": 2000, "ssh_timeout_secs": 30}
            },
            "encryption_salt": "abc123"
        }"#;
        let data: AppData = serde_json::from_str(json).unwrap();
        assert!(data.ssh_keys.is_empty());
        let s = &data.servers[0];
        assert_eq!(s.auth_method, AuthMethod::Password);
        assert_eq!((s.ssh_key_id.as_deref(), s.jump_host_id.as_deref()), (None, None));
        // Ancien payload du frontend (ex. correction des MAC) : authentification inchangée
        let payload: crate::models::ServerPayload = serde_json::from_str(
            r#"{"name":"minipc","ip":"192.168.1.10","mac_address":"","ssh_user":"root","ssh_password":"",
                "ssh_port":22,"shutdown_command":null,"reboot_command":null,"os_type":"Linux","icon":null,"notes":null}"#,
        )
        .unwrap();
        assert_eq!(payload.auth_method, None);
        assert!(!payload.clear_password);
    }

    #[test]
    fn key_users_lists_servers_authenticating_with_the_key() {
        let mut data = AppData::default();
        for (name, method) in [("minipc", AuthMethod::Key), ("DockerHost", AuthMethod::Password)] {
            let mut s = crate::models::Server::new(
                name.into(), "192.168.1.2".into(), String::new(), "root".into(), String::new(), 22, OsType::Linux, None, None,
            );
            s.auth_method = method;
            s.ssh_key_id = Some("k1".into());
            data.servers.push(s);
        }
        assert_eq!(key_users(&data, "k1"), vec!["minipc".to_string()]);
        assert!(key_users(&data, "k2").is_empty());
    }
}
