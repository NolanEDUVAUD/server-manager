/// Explorateur de fichiers SFTP (onglet Console) : logique pure (chemins, sécurité,
/// tri, formatage) et pool de sessions SFTP par serveur. La connexion elle-même
/// (authentification, vérification de la clé d'hôte) est établie ailleurs
/// (`commands::sftp`) en réutilisant `commands::ssh::connect_ssh` : ce module ne
/// contient rien qui parle SSH.
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;

/// Au-delà de cette inactivité, une session SFTP mise en cache est refermée à la
/// prochaine utilisation du pool plutôt que réutilisée.
pub const IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// Taille maximum d'un fichier prévisualisé ou édité par l'explorateur (1 MiB : un
/// aperçu de texte, pas un visualiseur de journaux).
pub const MAX_TEXT_FILE_SIZE: u64 = 1024 * 1024;

// ── Chemins distants ────────────────────────────────────────────────────────

/// Normalise un chemin distant reçu du frontend : refuse tout octet NUL, exige un
/// chemin absolu et résout "." / ".." composant par composant SANS jamais pouvoir
/// remonter au-dessus de la racine "/" (contrairement à un `..` shell, qui échouerait
/// simplement côté serveur — ici on ne l'envoie même pas).
pub fn normalize_remote_path(path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("Chemin distant vide".into());
    }
    if path.contains('\0') {
        return Err("Chemin distant invalide (caractère nul)".into());
    }
    if !path.starts_with('/') {
        return Err(format!("Chemin distant non absolu : {}", path));
    }
    let mut parts: Vec<&str> = Vec::new();
    for comp in path.split('/') {
        match comp {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    Ok(format!("/{}", parts.join("/")))
}

/// Chemin du dossier parent (normalisé), ou `None` si `path` est déjà la racine.
pub fn parent_path(path: &str) -> Option<String> {
    let norm = normalize_remote_path(path).ok()?;
    if norm == "/" {
        return None;
    }
    let idx = norm.rfind('/').unwrap_or(0);
    Some(if idx == 0 { "/".to_string() } else { norm[..idx].to_string() })
}

/// Concatène un dossier et un nom d'entrée (le dossier est supposé déjà normalisé).
pub fn join_remote_path(dir: &str, name: &str) -> String {
    if dir == "/" {
        format!("/{}", name)
    } else {
        format!("{}/{}", dir, name)
    }
}

/// Dossiers système qu'une suppression récursive ne doit jamais cibler elle-même
/// (leur contenu, oui : c'est le rôle de l'utilisateur ; mais pas le dossier racine).
const PROTECTED_TOP_LEVEL_DIRS: &[&str] =
    &["/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/proc", "/root", "/sbin", "/sys", "/usr", "/var"];

/// Valide qu'une suppression est autorisée : chemin normalisé, jamais la racine, et
/// jamais un dossier système de premier niveau en mode récursif.
pub fn ensure_deletable(path: &str, recursive: bool) -> Result<String, String> {
    let norm = normalize_remote_path(path)?;
    if norm == "/" {
        return Err("Suppression de la racine « / » refusée".into());
    }
    if recursive && PROTECTED_TOP_LEVEL_DIRS.contains(&norm.as_str()) {
        return Err(format!("Suppression récursive de {} refusée (dossier système)", norm));
    }
    Ok(norm)
}

/// Nom d'une entrée (fichier envoyé, ou nouveau dossier) : jamais de séparateur, de
/// "..", de nom vide ni d'octet NUL — un nom, pas un chemin.
pub fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("Nom invalide : « {} »", name));
    }
    if name.contains('\0') {
        return Err("Nom invalide (caractère nul)".into());
    }
    if name.contains('/') {
        return Err("Nom invalide (ne doit pas contenir de « / »)".into());
    }
    Ok(())
}

// ── Chemins locaux (téléversement / téléchargement) ─────────────────────────

/// Valide le chemin local choisi par l'utilisateur (boîte de dialogue « Enregistrer
/// sous ») pour un téléchargement : absolu, pas un dossier existant, dossier parent
/// existant.
pub fn validate_local_download_path(path: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Chemin local non absolu".into());
    }
    if path.is_dir() {
        return Err("Le chemin local choisi est un dossier".into());
    }
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() && !parent.exists() => {
            Err("Le dossier de destination n'existe pas".into())
        }
        None => Err("Chemin local invalide".into()),
        _ => Ok(()),
    }
}

/// Valide le fichier local choisi (boîte de dialogue « Ouvrir ») pour un
/// téléversement et renvoie son nom (qui devient le nom du fichier distant).
pub fn validate_local_upload_path(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Chemin local non absolu".into());
    }
    if !path.is_file() {
        return Err("Le fichier local est introuvable".into());
    }
    let name = path.file_name().and_then(|n| n.to_str()).ok_or_else(|| "Nom de fichier local invalide".to_string())?;
    validate_entry_name(name)?;
    Ok(name.to_string())
}

// ── Détection de contenu binaire ────────────────────────────────────────────

/// Un fichier contenant un octet NUL est traité comme binaire : jamais prévisualisé
/// ni ouvert dans l'éditeur de texte intégré.
pub fn looks_binary(data: &[u8]) -> bool {
    data.contains(&0)
}

// ── Entrées de répertoire ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Dir,
    File,
    Symlink,
    Other,
}

impl From<FileType> for EntryKind {
    fn from(t: FileType) -> Self {
        match t {
            FileType::Dir => EntryKind::Dir,
            FileType::File => EntryKind::File,
            FileType::Symlink => EntryKind::Symlink,
            FileType::Other => EntryKind::Other,
        }
    }
}

impl EntryKind {
    fn type_char(self) -> char {
        match self {
            EntryKind::Dir => 'd',
            EntryKind::File => '-',
            EntryKind::Symlink => 'l',
            EntryKind::Other => '?',
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    /// Pour un lien symbolique dont la cible a pu être résolue : son type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_target_kind: Option<EntryKind>,
    pub size: u64,
    /// Horodatage de modification, secondes Unix (UTC)
    pub modified: Option<i64>,
    /// Chaîne « rwx » façon `ls -l`, type inclus (ex. "drwxr-xr-x")
    pub permissions: String,
    pub owner: Option<u32>,
    pub group: Option<u32>,
}

/// Formate un mode Unix en chaîne façon `ls -l` (type + rwx × 3), sans dépendre de la
/// plateforme locale (Windows n'a pas ces bits : uniquement utile pour l'affichage).
pub fn format_permissions(mode: Option<u32>, type_char: char) -> String {
    let mode = mode.unwrap_or(0);
    let bit = |flag: u32, c: char| if mode & flag != 0 { c } else { '-' };
    format!(
        "{}{}{}{}{}{}{}{}{}{}",
        type_char,
        bit(0o400, 'r'),
        bit(0o200, 'w'),
        bit(0o100, 'x'),
        bit(0o040, 'r'),
        bit(0o020, 'w'),
        bit(0o010, 'x'),
        bit(0o004, 'r'),
        bit(0o002, 'w'),
        bit(0o001, 'x'),
    )
}

impl SftpEntry {
    pub fn permissions_string(mode: Option<u32>, kind: EntryKind) -> String {
        format_permissions(mode, kind.type_char())
    }
}

/// Trie les entrées : dossiers (et liens vers un dossier) d'abord, puis ordre
/// alphabétique insensible à la casse — l'ordre le plus lisible dans un explorateur.
pub fn sort_entries(entries: &mut [SftpEntry]) {
    entries.sort_by(|a, b| {
        let a_dir = a.kind == EntryKind::Dir || a.link_target_kind == Some(EntryKind::Dir);
        let b_dir = b.kind == EntryKind::Dir || b.link_target_kind == Some(EntryKind::Dir);
        b_dir.cmp(&a_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

// ── Pool de sessions SFTP (une par serveur, réutilisée) ─────────────────────

/// Ce que le pool garde en vie pour une session SFTP active : la session elle-même
/// et une référence à la connexion SSH sous-jacente, gardée en vie exactement aussi
/// longtemps (elle porte le canal du sous-système SFTP).
pub struct PooledSftp<S> {
    pub sftp: Arc<SftpSession>,
    /// Connexion SSH authentifiée qui porte le canal SFTP : jamais lue, seulement
    /// gardée en vie (`_` évite l'avertissement de champ jamais lu).
    _ssh: Arc<S>,
    last_used: Instant,
}

/// Pool de sessions SFTP, une par serveur. Générique sur le type de session SSH
/// (`commands::ssh::SshSession` en pratique) pour rester testable sans dépendre du
/// module `commands`.
pub struct SftpPool<S> {
    sessions: Mutex<HashMap<String, PooledSftp<S>>>,
}

impl<S> Default for SftpPool<S> {
    fn default() -> Self {
        Self { sessions: Mutex::new(HashMap::new()) }
    }
}

impl<S: Send + Sync + 'static> SftpPool<S> {
    /// Renvoie la session mise en cache pour `server_id` si elle est encore fraîche
    /// (moins de `IDLE_TIMEOUT` d'inactivité), sinon l'oublie et renvoie `None`.
    pub fn get(&self, server_id: &str) -> Option<Arc<SftpSession>> {
        let mut sessions = self.sessions.lock().ok()?;
        match sessions.get_mut(server_id) {
            Some(entry) if entry.last_used.elapsed() < IDLE_TIMEOUT => {
                entry.last_used = Instant::now();
                Some(entry.sftp.clone())
            }
            Some(_) => {
                sessions.remove(server_id);
                None
            }
            None => None,
        }
    }

    /// Mémorise une session fraîchement établie pour `server_id` (remplace toute
    /// entrée précédente).
    pub fn insert(&self, server_id: String, sftp: Arc<SftpSession>, ssh: Arc<S>) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(server_id, PooledSftp { sftp, _ssh: ssh, last_used: Instant::now() });
        }
    }

    /// Oublie la session d'un serveur (après une erreur, ou explicitement).
    pub fn invalidate(&self, server_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(server_id);
        }
    }

    /// Ferme toutes les sessions (verrouillage de l'application) : les connexions
    /// SSH sous-jacentes sont abandonnées (`Drop`), ce qui referme leurs canaux.
    pub fn close_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Chemins distants ─────────────────────────────────────────────────
    #[test]
    fn normalizes_absolute_paths() {
        assert_eq!(normalize_remote_path("/a/b").unwrap(), "/a/b");
        assert_eq!(normalize_remote_path("/a/./b//c").unwrap(), "/a/b/c");
        assert_eq!(normalize_remote_path("/").unwrap(), "/");
    }

    #[test]
    fn collapses_dotdot_without_escaping_root() {
        assert_eq!(normalize_remote_path("/a/../b").unwrap(), "/b");
        assert_eq!(normalize_remote_path("/a/../../b").unwrap(), "/b");
        assert_eq!(normalize_remote_path("/../../etc/passwd").unwrap(), "/etc/passwd");
        assert_eq!(normalize_remote_path("/..").unwrap(), "/");
    }

    #[test]
    fn rejects_relative_or_nul_paths() {
        assert!(normalize_remote_path("relative").unwrap_err().contains("absolu"));
        assert!(normalize_remote_path("").is_err());
        assert!(normalize_remote_path("/a\0b").unwrap_err().contains("nul"));
    }

    #[test]
    fn parent_and_join() {
        assert_eq!(parent_path("/a/b/c").unwrap(), "/a/b");
        assert_eq!(parent_path("/a").unwrap(), "/");
        assert_eq!(parent_path("/"), None);
        assert_eq!(join_remote_path("/a/b", "c"), "/a/b/c");
        assert_eq!(join_remote_path("/", "etc"), "/etc");
    }

    #[test]
    fn entry_names_are_validated() {
        assert!(validate_entry_name("rapport.txt").is_ok());
        assert!(validate_entry_name("").is_err());
        assert!(validate_entry_name(".").is_err());
        assert!(validate_entry_name("..").is_err());
        assert!(validate_entry_name("a/b").is_err());
        assert!(validate_entry_name("a\0b").is_err());
    }

    // ── Suppressions ─────────────────────────────────────────────────────
    #[test]
    fn root_deletion_is_always_refused() {
        assert!(ensure_deletable("/", false).unwrap_err().contains("racine"));
        assert!(ensure_deletable("/..", true).unwrap_err().contains("racine"));
    }

    #[test]
    fn recursive_delete_refuses_top_level_system_dirs_only() {
        for d in ["/etc", "/usr", "/bin", "/root", "/var"] {
            assert!(ensure_deletable(d, true).unwrap_err().contains("système"), "{}", d);
            // Le contenu d'un dossier système reste supprimable (récursif ou non)
            assert!(ensure_deletable(&format!("{}/sub", d), true).is_ok());
            // Non récursif : jamais bloqué par cette règle (dossier vide, ou fichier)
            assert!(ensure_deletable(d, false).is_ok());
        }
        assert!(ensure_deletable("/home/user/dossier", true).is_ok());
    }

    // ── Détection binaire ────────────────────────────────────────────────
    #[test]
    fn binary_detection_looks_for_nul_bytes() {
        assert!(!looks_binary(b"bonjour le monde\n"));
        assert!(looks_binary(b"bonjour\0monde"));
        assert!(!looks_binary(b""));
    }

    // ── Chemins locaux ───────────────────────────────────────────────────
    #[test]
    fn local_download_path_must_be_absolute_and_not_a_directory() {
        let tmp = std::env::temp_dir();
        assert!(validate_local_download_path(&tmp).unwrap_err().contains("dossier"));
        assert!(validate_local_download_path(Path::new("relatif.txt")).unwrap_err().contains("absolu"));
        assert!(validate_local_download_path(&tmp.join("fichier.txt")).is_ok());
        assert!(validate_local_download_path(&tmp.join("dossier-absent/fichier.txt")).unwrap_err().contains("n'existe pas"));
    }

    #[test]
    fn local_upload_path_must_exist_and_yields_the_file_name() {
        let dir = std::env::temp_dir().join(format!("sftp-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("photo.png");
        std::fs::write(&file, b"x").unwrap();
        assert_eq!(validate_local_upload_path(&file).unwrap(), "photo.png");
        assert!(validate_local_upload_path(&dir.join("absent.png")).is_err());
        assert!(validate_local_upload_path(Path::new("relatif.png")).unwrap_err().contains("absolu"));
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Permissions ──────────────────────────────────────────────────────
    #[test]
    fn permission_formatting_matches_ls() {
        assert_eq!(format_permissions(Some(0o755), 'd'), "drwxr-xr-x");
        assert_eq!(format_permissions(Some(0o644), '-'), "-rw-r--r--");
        assert_eq!(format_permissions(Some(0o600), 'l'), "lrw-------");
        assert_eq!(format_permissions(None, '-'), "----------");
    }

    // ── Tri ──────────────────────────────────────────────────────────────
    fn entry(name: &str, kind: EntryKind) -> SftpEntry {
        SftpEntry {
            name: name.into(),
            path: format!("/{}", name),
            kind,
            link_target_kind: None,
            size: 0,
            modified: None,
            permissions: String::new(),
            owner: None,
            group: None,
        }
    }

    #[test]
    fn directories_sort_before_files_then_alphabetically_case_insensitive() {
        let mut entries = vec![
            entry("zeta.txt", EntryKind::File),
            entry("Alpha", EntryKind::Dir),
            entry("beta.txt", EntryKind::File),
            entry("Charlie", EntryKind::Dir),
        ];
        sort_entries(&mut entries);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "Charlie", "beta.txt", "zeta.txt"]);
    }

    #[test]
    fn a_symlink_to_a_directory_sorts_with_directories() {
        let mut link = entry("lien", EntryKind::Symlink);
        link.link_target_kind = Some(EntryKind::Dir);
        let mut entries = vec![entry("aaa.txt", EntryKind::File), link];
        sort_entries(&mut entries);
        assert_eq!(entries[0].name, "lien");
    }

    // ── Pool de sessions ─────────────────────────────────────────────────
    // Le pool est générique sur le type de session SSH gardée en vie (un entier
    // suffit ici) : une vraie `SftpSession` exige une connexion réelle, exercée de
    // bout en bout dans `commands::sftp::tests`.
    #[test]
    fn pool_forgets_invalidated_or_absent_servers() {
        let pool: SftpPool<u32> = SftpPool::default();
        assert!(pool.get("a").is_none());
        pool.invalidate("a"); // no-op, ne doit pas paniquer
    }

    #[test]
    fn close_all_forgets_every_server() {
        let pool: SftpPool<u32> = SftpPool::default();
        // On ne peut pas construire de vraie `SftpSession` sans connexion : ce test se
        // borne donc à vérifier que `close_all` ne paniques jamais sur un pool vide,
        // le comportement « oublie tout » étant couvert avec de vraies sessions dans
        // `commands::sftp::tests`.
        pool.close_all();
        assert!(pool.get("x").is_none());
    }
}
