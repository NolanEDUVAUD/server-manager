/// Sauvegarde chiffrée complète (`.spmbackup`) : toute la configuration, secrets
/// compris, chiffrée par une phrase de passe (Argon2id + AES-256-GCM). Les secrets
/// voyagent rechiffrés par une clé de transfert aléatoire, elle-même protégée par la
/// phrase de passe : ils ne sont jamais en clair, même dans la charge utile déchiffrée.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use zeroize::{Zeroize, Zeroizing};

use crate::crypto::{self, KdfParams, KDF_SALT_LEN};
use crate::models::AppData;

const MAGIC: &[u8; 10] = b"SPMBACKUP\0";
const FORMAT_VERSION: u8 = 1;
const KDF_ARGON2ID: u8 = 1;
const NONCE_LEN: usize = 12;
/// En-tête authentifié (AAD) : signature + version + kdf + 3 × u32 + sel.
/// Le nonce suit l'en-tête : AES-GCM l'authentifie de lui-même.
const HEADER_LEN: usize = MAGIC.len() + 2 + 12 + KDF_SALT_LEN;
/// Plus petit fichier possible : en-tête + nonce + étiquette GCM
const MIN_LEN: usize = HEADER_LEN + NONCE_LEN + 16;

/// Taille maximale d'un fichier de sauvegarde lu (vérifiée avant toute lecture)
pub const MAX_BACKUP_BYTES: u64 = 50 * 1024 * 1024;
pub const MIN_PASSPHRASE_CHARS: usize = 12;

/// Message unique pour tout échec d'authentification : aucun indice sur la cause
pub const BAD_PASSPHRASE: &str = "Phrase de passe incorrecte ou fichier altéré";

/// Paramètres Argon2id utilisés à l'export (64 Mio, 3 passes, 1 voie). À l'import,
/// ceux de l'en-tête sont relus et bornés par `KdfParams::validate` : un fichier
/// piégé ne peut pas réclamer des gigaoctets de mémoire.
pub const EXPORT_KDF: KdfParams = KdfParams::DEFAULT;

pub fn validate_passphrase(passphrase: &str) -> Result<(), String> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(format!("Phrase de passe trop courte : {} caractères minimum", MIN_PASSPHRASE_CHARS));
    }
    Ok(())
}

fn header(params: &KdfParams, salt: &[u8; KDF_SALT_LEN]) -> Vec<u8> {
    let mut h = Vec::with_capacity(HEADER_LEN);
    h.extend_from_slice(MAGIC);
    h.push(FORMAT_VERSION);
    h.push(KDF_ARGON2ID);
    for v in [params.m_kib, params.t, params.p] {
        h.extend_from_slice(&v.to_le_bytes());
    }
    h.extend_from_slice(salt);
    h
}

/// Chiffre une charge utile avec une phrase de passe (format `.spmbackup` v1)
pub fn seal(plaintext: &[u8], passphrase: &str, params: KdfParams) -> Result<Vec<u8>, String> {
    let salt = crypto::random_kdf_salt();
    let key = crypto::derive_kek(passphrase.as_bytes(), &salt, &params)?;
    let mut out = header(&params, &salt);
    let (nonce, ct) = crypto::seal(plaintext, &key, &out).map_err(|_| "Chiffrement de la sauvegarde impossible".to_string())?;
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// Déchiffre un fichier `.spmbackup` ; l'en-tête entier est authentifié (AAD)
pub fn open(bytes: &[u8], passphrase: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    if bytes.len() < MIN_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return Err("Ce fichier n'est pas une sauvegarde Server Power Manager".into());
    }
    let (head, rest) = bytes.split_at(HEADER_LEN);
    let (nonce, ct) = rest.split_at(NONCE_LEN);
    let mut pos = MAGIC.len();
    if head[pos] != FORMAT_VERSION {
        return Err(format!("Version de sauvegarde non prise en charge ({}) : mets l'application à jour", head[pos]));
    }
    if head[pos + 1] != KDF_ARGON2ID {
        return Err(BAD_PASSPHRASE.into());
    }
    pos += 2;
    let u32_at = |p: &mut usize| {
        let v = u32::from_le_bytes([head[*p], head[*p + 1], head[*p + 2], head[*p + 3]]);
        *p += 4;
        v
    };
    let params = KdfParams { m_kib: u32_at(&mut pos), t: u32_at(&mut pos), p: u32_at(&mut pos) };
    params.validate().map_err(|_| "Paramètres de chiffrement du fichier hors limites".to_string())?;
    let salt = &head[pos..pos + KDF_SALT_LEN];
    let key = crypto::derive_kek(passphrase.as_bytes(), salt, &params)?;
    crypto::open(nonce, ct, &key, head).map_err(|_| BAD_PASSPHRASE.to_string())
}

// ── Charge utile ──────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct BackupPayload {
    pub format: u8,
    pub app_version: String,
    pub created_at: String,
    /// Clé de transfert (base64) qui chiffre les secrets de `data`
    pub transfer_key: String,
    pub data: AppData,
    /// Empreintes SSH connues (hôte:port → empreinte)
    #[serde(default)]
    pub known_hosts: HashMap<String, String>,
}

impl Drop for BackupPayload {
    /// La clé de transfert déverrouille tous les secrets de la charge utile
    fn drop(&mut self) {
        self.transfer_key.zeroize();
    }
}

/// Aperçu montré avant la restauration
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupSummary {
    pub app_version: String,
    pub created_at: String,
    pub servers: usize,
    pub groups: usize,
    pub probes: usize,
    pub proxmox_connections: usize,
    pub integrations: usize,
    pub schedules: usize,
}

impl BackupPayload {
    pub fn summary(&self) -> BackupSummary {
        BackupSummary {
            app_version: self.app_version.clone(),
            created_at: self.created_at.clone(),
            servers: self.data.servers.len(),
            groups: self.data.groups.len(),
            probes: self.data.probes.len(),
            proxmox_connections: self.data.proxmox_connections.len(),
            integrations: self.data.integrations.len(),
            schedules: self.data.schedules.len(),
        }
    }
}

/// Prépare la charge utile : copie de la configuration dont les secrets passent de la
/// clé maître à une clé de transfert aléatoire.
pub fn build_payload(data: &AppData, master: &[u8; 32], known_hosts: HashMap<String, String>, now_rfc3339: String) -> Result<BackupPayload, String> {
    let transfer = Zeroizing::new(crate::crypto::generate_key());
    let mut copy = data.clone();
    // Verrouillage (hash du PIN) et sauvegarde automatique (dossier, phrase de passe) :
    // propres à cette machine, ils ne voyagent pas et ne sont jamais restaurés
    copy.lock = crate::lock::LockConfig::default();
    copy.backup = BackupConfig::default();
    crate::crypto::reencrypt_all(&mut copy, master, &transfer)?;
    Ok(BackupPayload {
        format: FORMAT_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: now_rfc3339,
        transfer_key: STANDARD.encode(transfer.as_ref()),
        data: copy,
        known_hosts,
    })
}

/// Chiffre la configuration complète avec la phrase de passe
pub fn export_bytes(payload: &BackupPayload, passphrase: &str, params: KdfParams) -> Result<Vec<u8>, String> {
    let json = Zeroizing::new(serde_json::to_vec(payload).map_err(|e| format!("Sérialisation : {}", e))?);
    seal(&json, passphrase, params)
}

/// Déchiffre et désérialise une sauvegarde (après authentification AES-GCM)
pub fn import_bytes(bytes: &[u8], passphrase: &str) -> Result<BackupPayload, String> {
    let json = open(bytes, passphrase)?;
    let payload: BackupPayload = serde_json::from_slice(&json).map_err(|_| "Contenu de la sauvegarde illisible".to_string())?;
    if payload.format != FORMAT_VERSION {
        return Err("Contenu de la sauvegarde d'une version non prise en charge".into());
    }
    Ok(payload)
}

/// Configuration prête à remplacer l'actuelle : secrets rechiffrés par la clé maître locale
pub fn into_local_data(payload: &BackupPayload, master: &[u8; 32]) -> Result<AppData, String> {
    let transfer: Zeroizing<Vec<u8>> = Zeroizing::new(STANDARD.decode(&payload.transfer_key).map_err(|_| BAD_PASSPHRASE.to_string())?);
    let transfer: Zeroizing<[u8; 32]> = Zeroizing::new(transfer.as_slice().try_into().map_err(|_| BAD_PASSPHRASE.to_string())?);
    let mut data = payload.data.clone();
    crate::crypto::reencrypt_all(&mut data, &transfer, master)?;
    data.key_version = crate::crypto::KEY_VERSION_MASTER;
    Ok(data)
}

/// Écriture atomique : fichier temporaire puis renommage
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("spmbackup.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| format!("Écriture de la sauvegarde impossible : {}", e))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Écriture de la sauvegarde impossible : {}", e)
    })
}

pub fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Fichier illisible : {}", e))?;
    if meta.len() > MAX_BACKUP_BYTES {
        return Err("Fichier trop volumineux pour être une sauvegarde".into());
    }
    std::fs::read(path).map_err(|e| format!("Fichier illisible : {}", e))
}

// ── Sauvegarde automatique ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum BackupFrequency {
    #[default]
    Daily,
    Weekly,
}

impl BackupFrequency {
    fn period_ms(self) -> i64 {
        match self {
            BackupFrequency::Daily => crate::db::DAY_MS,
            BackupFrequency::Weekly => 7 * crate::db::DAY_MS,
        }
    }
}

/// Réglages de la sauvegarde automatique, rangés dans `AppData` (pas dans les
/// paramètres renvoyés au frontend) car ils contiennent un secret.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BackupConfig {
    pub enabled: bool,
    pub folder: String,
    pub frequency: BackupFrequency,
    pub keep: u32,
    /// Phrase de passe chiffrée par la clé maître ; jamais envoyée au frontend
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub passphrase: String,
    /// Dernière sauvegarde automatique réussie (ms)
    #[serde(default)]
    pub last_run: Option<i64>,
    #[serde(default)]
    pub last_error: Option<String>,
}

impl Default for BackupConfig {
    fn default() -> Self {
        BackupConfig { enabled: false, folder: String::new(), frequency: BackupFrequency::Daily, keep: 7, passphrase: String::new(), last_run: None, last_error: None }
    }
}

/// Réglages tels que vus par le frontend : la phrase de passe est remplacée par un indicateur
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupConfigView {
    #[serde(flatten)]
    pub config: BackupConfig,
    pub has_passphrase: bool,
}

impl From<&BackupConfig> for BackupConfigView {
    fn from(c: &BackupConfig) -> Self {
        BackupConfigView { config: BackupConfig { passphrase: String::new(), ..c.clone() }, has_passphrase: !c.passphrase.is_empty() }
    }
}

impl BackupConfig {
    pub fn validate(&self) -> Result<(), String> {
        if !(1..=100).contains(&self.keep) {
            return Err("Nombre de sauvegardes conservées : entre 1 et 100".into());
        }
        if self.enabled {
            let folder = Path::new(self.folder.trim());
            if self.folder.trim().is_empty() || !folder.is_absolute() {
                return Err("Choisis un dossier de destination (chemin complet)".into());
            }
            if !folder.is_dir() {
                return Err("Le dossier de destination n'existe pas".into());
            }
        }
        Ok(())
    }

    /// Une sauvegarde est-elle due à `now` ?
    pub fn is_due(&self, now: i64) -> bool {
        self.enabled && self.last_run.is_none_or(|last| now - last >= self.frequency.period_ms())
    }
}

/// Fixe la phrase de passe chiffrée : None = garder l'ancienne, Some("") = effacer,
/// Some(x) = chiffrer x. Désactiver la sauvegarde automatique efface la phrase de passe.
pub fn apply_passphrase(config: &mut BackupConfig, previous: &BackupConfig, new: Option<Zeroizing<String>>, key: &[u8; 32]) -> Result<(), String> {
    config.passphrase = match new {
        _ if !config.enabled => String::new(),
        Some(p) if p.is_empty() => String::new(),
        Some(p) => {
            validate_passphrase(&p)?;
            crate::crypto::encrypt(&p, key)?
        }
        None => previous.passphrase.clone(),
    };
    if config.enabled && config.passphrase.is_empty() {
        return Err("Phrase de passe requise pour la sauvegarde automatique".into());
    }
    Ok(())
}

/// Nom d'un fichier de sauvegarde automatique (horodatage local)
pub fn auto_file_name(now: chrono::DateTime<chrono::Local>) -> String {
    format!("spm-backup-{}.spmbackup", now.format("%Y%m%d-%H%M%S"))
}

fn is_auto_file(name: &str) -> bool {
    name.strip_prefix("spm-backup-")
        .and_then(|rest| rest.strip_suffix(".spmbackup"))
        .is_some_and(|stamp| stamp.len() == 15 && stamp.chars().enumerate().all(|(i, c)| if i == 8 { c == '-' } else { c.is_ascii_digit() }))
}

/// Fichiers de sauvegarde automatique à supprimer pour n'en garder que `keep`
/// (les plus anciens d'abord ; le nom horodaté se trie chronologiquement).
pub fn files_to_rotate(names: &[String], keep: u32) -> Vec<String> {
    let mut autos: Vec<&String> = names.iter().filter(|n| is_auto_file(n)).collect();
    autos.sort();
    let excess = autos.len().saturating_sub(keep as usize);
    autos.into_iter().take(excess).cloned().collect()
}

/// Supprime les sauvegardes automatiques en trop dans `folder`
pub fn rotate(folder: &Path, keep: u32) -> Result<usize, String> {
    let names: Vec<String> = std::fs::read_dir(folder)
        .map_err(|e| format!("Dossier de sauvegarde illisible : {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    let old = files_to_rotate(&names, keep);
    for name in &old {
        std::fs::remove_file(folder.join(name)).map_err(|e| format!("Suppression de {} impossible : {}", name, e))?;
    }
    Ok(old.len())
}

pub fn auto_path(folder: &str, now: chrono::DateTime<chrono::Local>) -> PathBuf {
    Path::new(folder.trim()).join(auto_file_name(now))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{crypto, models::{OsType, Server}};

    /// Paramètres réduits pour les tests (le format et les bornes restent identiques)
    const FAST: KdfParams = KdfParams { m_kib: 16 * 1024, t: 1, p: 1 };
    const PASS: &str = "une phrase de passe solide";

    fn data_with_secrets(master: &[u8; 32]) -> AppData {
        let mut data = AppData { key_version: crypto::KEY_VERSION_MASTER, ..Default::default() };
        data.servers.push(Server::new(
            "minipc".into(), "192.168.1.10".into(), "02:00:00:00:00:01".into(), "root".into(),
            crypto::encrypt("mot-de-passe-ssh", master).unwrap(), 22, OsType::Linux, None, None,
        ));
        data
    }

    #[test]
    fn seal_and_open_round_trip() {
        let sealed = seal(b"contenu secret", PASS, FAST).unwrap();
        assert_eq!(&open(&sealed, PASS).unwrap()[..], b"contenu secret");
        // Deux exports du même contenu diffèrent (sel et nonce aléatoires)
        assert_ne!(sealed, seal(b"contenu secret", PASS, FAST).unwrap());
    }

    #[test]
    fn wrong_passphrase_and_tampering_are_rejected() {
        let sealed = seal(b"contenu", PASS, FAST).unwrap();
        assert_eq!(open(&sealed, "mauvaise phrase de passe").unwrap_err(), BAD_PASSPHRASE);
        // Chiffré modifié
        let mut bad = sealed.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(open(&bad, PASS).unwrap_err(), BAD_PASSPHRASE);
        // Sel modifié (en-tête authentifié)
        let mut bad = sealed.clone();
        bad[MAGIC.len() + 14] ^= 1;
        assert_eq!(open(&bad, PASS).unwrap_err(), BAD_PASSPHRASE);
        // Nonce modifié
        let mut bad = sealed.clone();
        bad[HEADER_LEN] ^= 1;
        assert_eq!(open(&bad, PASS).unwrap_err(), BAD_PASSPHRASE);
        // Mémoire Argon2id modifiée mais dans les bornes (16 Mio → 16 Mio + 1 Kio) : refus
        let mut bad = sealed.clone();
        bad[MAGIC.len() + 2] ^= 1;
        assert_eq!(open(&bad, PASS).unwrap_err(), BAD_PASSPHRASE);
        // Tronqué
        assert!(open(&sealed[..HEADER_LEN + 5], PASS).is_err());
        // Pas une sauvegarde
        assert!(open(b"{\"servers\":[]}", PASS).unwrap_err().contains("pas une sauvegarde"));
    }

    #[test]
    fn unknown_version_and_extreme_parameters_are_refused_before_derivation() {
        let mut sealed = seal(b"x", PASS, FAST).unwrap();
        sealed[MAGIC.len()] = 9;
        assert!(open(&sealed, PASS).unwrap_err().contains("Version"));
        // 4 Gio de mémoire demandés par un fichier piégé : refusé sans calcul
        let mut forged = header(&KdfParams { m_kib: u32::MAX, t: 1, p: 1 }, &[0; KDF_SALT_LEN]);
        forged.extend_from_slice(&[0u8; NONCE_LEN + 32]);
        assert!(open(&forged, PASS).unwrap_err().contains("hors limites"));
        let mut forged = header(&KdfParams { m_kib: 64 * 1024, t: 1000, p: 1 }, &[0; KDF_SALT_LEN]);
        forged.extend_from_slice(&[0u8; NONCE_LEN + 32]);
        assert!(open(&forged, PASS).unwrap_err().contains("hors limites"));
        assert!(EXPORT_KDF.validate().is_ok());
    }

    #[test]
    fn export_import_rekeys_secrets_to_the_new_master_key() {
        let old_master = crypto::generate_key();
        let new_master = crypto::generate_key();
        let data = data_with_secrets(&old_master);
        let hosts: HashMap<String, String> = [("192.168.1.10:22".to_string(), "SHA256:abc".to_string())].into_iter().collect();
        let payload = build_payload(&data, &old_master, hosts.clone(), "2026-09-25T10:00:00Z".into()).unwrap();
        let bytes = export_bytes(&payload, PASS, FAST).unwrap();

        let restored = import_bytes(&bytes, PASS).unwrap();
        assert_eq!(restored.summary().servers, 1);
        assert_eq!(restored.known_hosts, hosts);
        let local = into_local_data(&restored, &new_master).unwrap();
        assert_eq!(crypto::decrypt(&local.servers[0].ssh_password, &new_master).unwrap(), "mot-de-passe-ssh");
        assert!(crypto::decrypt(&local.servers[0].ssh_password, &old_master).is_err());
        assert_eq!(local.key_version, crypto::KEY_VERSION_MASTER);
    }

    #[test]
    fn every_secret_survives_a_transfer_to_another_pc_except_machine_settings() {
        let old_master = crypto::generate_key();
        let new_master = crypto::generate_key();
        let mut data = crypto::test_support::data_with_every_secret(&old_master);
        data.key_version = crypto::KEY_VERSION_MASTER;
        data.backup.enabled = true;
        data.backup.folder = "/sauvegardes".into();
        data.lock.idle_minutes = 5;
        let payload = build_payload(&data, &old_master, HashMap::new(), "t".into()).unwrap();
        // Ni la configuration de verrouillage ni la sauvegarde automatique ne voyagent
        assert_eq!(payload.data.lock, crate::lock::LockConfig::default());
        assert_eq!(payload.data.backup, BackupConfig::default());
        let bytes = export_bytes(&payload, PASS, FAST).unwrap();
        let mut local = into_local_data(&import_bytes(&bytes, PASS).unwrap(), &new_master).unwrap();
        let plain: Vec<String> = crypto::secret_fields_mut(&mut local)
            .iter()
            .filter(|f| !f.is_empty())
            .map(|f| crypto::decrypt(f, &new_master).unwrap())
            .collect();
        assert_eq!(plain, ["secret-ssh", "secret-proxmox", "secret-ntfy", "secret-sonde"]);
    }

    #[test]
    fn backup_file_reveals_nothing_in_clear() {
        let master = crypto::generate_key();
        let data = data_with_secrets(&master);
        let payload = build_payload(&data, &master, HashMap::new(), "t".into()).unwrap();
        // Même la charge utile déchiffrée ne contient pas le secret en clair
        assert!(!serde_json::to_string(&payload).unwrap().contains("mot-de-passe-ssh"));
        let bytes = export_bytes(&payload, PASS, FAST).unwrap();
        for needle in ["mot-de-passe-ssh", "minipc", "192.168.1.10", "ssh_password", "servers", PASS] {
            assert!(!bytes.windows(needle.len()).any(|w| w == needle.as_bytes()), "« {} » lisible dans le fichier", needle);
        }
    }

    #[test]
    fn passphrase_policy() {
        assert!(validate_passphrase("court").is_err());
        assert!(validate_passphrase("douze caract").is_ok());
        assert!(validate_passphrase("ééééééééééé").is_err(), "compte en caractères, pas en octets");
    }

    #[test]
    fn auto_backup_passphrase_is_a_protected_secret() {
        let key = crypto::generate_key();
        let enabled = BackupConfig { enabled: true, folder: "/tmp".into(), ..Default::default() };
        // Nouvelle phrase : chiffrée, absente de la vue
        let mut c = enabled.clone();
        apply_passphrase(&mut c, &BackupConfig::default(), Some(Zeroizing::new(PASS.into())), &key).unwrap();
        assert!(!c.passphrase.contains(PASS));
        assert_eq!(crypto::decrypt(&c.passphrase, &key).unwrap(), PASS);
        let view = serde_json::to_string(&BackupConfigView::from(&c)).unwrap();
        assert!(!view.contains(&c.passphrase) && view.contains("\"has_passphrase\":true"), "{}", view);
        // Champ laissé vide : conservée
        let mut kept = enabled.clone();
        apply_passphrase(&mut kept, &c, None, &key).unwrap();
        assert_eq!(kept.passphrase, c.passphrase);
        // Sauvegarde automatique désactivée : effacée
        let mut off = BackupConfig { enabled: false, ..enabled.clone() };
        apply_passphrase(&mut off, &c, None, &key).unwrap();
        assert!(off.passphrase.is_empty());
        // Activée sans phrase : refusée ; phrase trop courte : refusée
        assert!(apply_passphrase(&mut enabled.clone(), &BackupConfig::default(), None, &key).is_err());
        assert!(apply_passphrase(&mut enabled.clone(), &BackupConfig::default(), Some(Zeroizing::new("court".into())), &key).is_err());
    }

    #[test]
    fn schedule_and_rotation() {
        let day = crate::db::DAY_MS;
        let mut c = BackupConfig { enabled: true, ..Default::default() };
        assert!(c.is_due(0), "jamais faite : due");
        c.last_run = Some(10 * day);
        assert!(!c.is_due(10 * day + day - 1));
        assert!(c.is_due(11 * day));
        c.frequency = BackupFrequency::Weekly;
        assert!(!c.is_due(16 * day) && c.is_due(17 * day));
        c.enabled = false;
        assert!(!c.is_due(100 * day));

        let names: Vec<String> = [
            "spm-backup-20260901-020000.spmbackup",
            "spm-backup-20260903-020000.spmbackup",
            "spm-backup-20260902-020000.spmbackup",
            "notes.txt",
            "spm-backup-manuel.spmbackup",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(files_to_rotate(&names, 2), vec!["spm-backup-20260901-020000.spmbackup".to_string()]);
        assert!(files_to_rotate(&names, 5).is_empty());
        let stamp = chrono::Local::now();
        assert!(is_auto_file(&auto_file_name(stamp)));
    }

    #[test]
    fn rotation_on_disk_only_touches_auto_backups() {
        let dir = std::env::temp_dir().join(format!("spm-backup-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        for n in ["spm-backup-20260101-000000.spmbackup", "spm-backup-20260102-000000.spmbackup", "perso.spmbackup"] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        assert_eq!(rotate(&dir, 1).unwrap(), 1);
        assert!(!dir.join("spm-backup-20260101-000000.spmbackup").exists());
        assert!(dir.join("spm-backup-20260102-000000.spmbackup").exists() && dir.join("perso.spmbackup").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_validation() {
        assert!(BackupConfig::default().validate().is_ok(), "désactivée : rien à valider");
        let mut c = BackupConfig { enabled: true, folder: "relatif/dossier".into(), ..Default::default() };
        assert!(c.validate().is_err());
        c.folder = std::env::temp_dir().to_string_lossy().into_owned();
        assert!(c.validate().is_ok());
        c.keep = 0;
        assert!(c.validate().is_err());
        c.keep = 5;
        c.folder = std::env::temp_dir().join("n-existe-pas-spm").to_string_lossy().into_owned();
        assert!(c.validate().is_err());
    }
}
