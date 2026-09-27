/// Commandes Tauri — Explorateur de fichiers SFTP (onglet Console)
///
/// Chaque commande réutilise `commands::ssh::connect_ssh` (même authentification, même
/// rebond, même vérification de la clé d'hôte que la console interactive et l'exécution
/// de commandes) puis ouvre le sous-système SFTP sur un canal de cette connexion : aucune
/// commande shell n'est jamais construite ni échappée pour parcourir les fichiers.
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileType;
use std::sync::Arc;
use tauri::State;

use crate::{
    commands::ssh::{connect_ssh, SshSession},
    sftp::{
        ensure_deletable, join_remote_path, looks_binary, normalize_remote_path, parent_path, sort_entries,
        validate_entry_name, validate_local_download_path, validate_local_upload_path, EntryKind, SftpEntry, SftpPool,
        MAX_TEXT_FILE_SIZE,
    },
    ssh_auth::{resolve_ssh, SshTarget},
    storage::AppState,
};

/// Pool partagé (état Tauri), une session SFTP par serveur.
pub type SftpPoolState = SftpPool<SshSession>;

/// Progression d'un transfert (téléversement ou téléchargement), envoyée au fur et à
/// mesure au frontend.
#[derive(Clone, serde::Serialize)]
pub struct SftpProgress {
    pub transferred: u64,
    pub total: u64,
}

/// Cible SSH d'un serveur et le délai de connexion configuré, sous un seul verrou.
fn target_and_timeout(state: &State<AppState>, server_id: &str) -> Result<(SshTarget, u64), String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok((resolve_ssh(&data, server_id)?, data.settings.network.ssh_timeout_secs))
}

/// Connexion SSH puis ouverture du sous-système SFTP sur un nouveau canal.
async fn connect_sftp(target: &SshTarget, timeout_secs: u64) -> Result<(SshSession, SftpSession), String> {
    let session = connect_ssh(target, timeout_secs).await?;
    open_sftp_channel(session, timeout_secs).await
}

/// Comme `connect_sftp`, avec un vérificateur de clé d'hôte injecté (tests : un magasin
/// `KnownHosts` en mémoire plutôt que le magasin global `known_hosts.json`, que les tests
/// de ce module ne doivent jamais initialiser — un `OnceLock` partagé par tout le binaire
/// de test, dont `known_hosts::tests::uninitialized_store_refuses` dépend qu'il le reste).
#[cfg(test)]
async fn connect_sftp_with(target: &SshTarget, timeout_secs: u64, verify: crate::commands::ssh::HostVerifier) -> Result<(SshSession, SftpSession), String> {
    let session = crate::commands::ssh::connect_with(target, timeout_secs, verify).await?;
    open_sftp_channel(session, timeout_secs).await
}

async fn open_sftp_channel(session: SshSession, timeout_secs: u64) -> Result<(SshSession, SftpSession), String> {
    let channel = session.channel_open_session().await.map_err(|e| format!("Impossible d'ouvrir un canal SFTP : {}", e))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Sous-système SFTP refusé par le serveur : {}", e))?;
    let sftp = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), SftpSession::new(channel.into_stream()))
        .await
        .map_err(|_| "Timeout d'initialisation SFTP".to_string())?
        .map_err(|e| format!("Initialisation SFTP échouée (le serveur prend-il en charge SFTP ?) : {}", e))?;
    Ok((session, sftp))
}

/// Session SFTP pour `server_id` : celle du pool si elle est encore fraîche, sinon une
/// nouvelle connexion (authentifiée, vérifiée) qui vient remplacer l'entrée du pool.
/// Refusé tant que l'application est verrouillée, comme toute autre commande SSH.
async fn sftp_for(state: &State<'_, AppState>, pool: &State<'_, SftpPoolState>, server_id: &str) -> Result<Arc<SftpSession>, String> {
    crate::crypto::ensure_unlocked()?;
    if let Some(sftp) = pool.get(server_id) {
        return Ok(sftp);
    }
    let (target, timeout) = target_and_timeout(state, server_id)?;
    let (ssh, sftp) = connect_sftp(&target, timeout).await?;
    let sftp = Arc::new(sftp);
    pool.insert(server_id.to_string(), sftp.clone(), Arc::new(ssh));
    Ok(sftp)
}

/// Type d'une entrée à partir de ses attributs SFTP, et éventuellement du type de sa cible
/// (résolu séparément) quand c'est un lien symbolique.
async fn entry_from(sftp: &SftpSession, name: String, path: String, meta: russh_sftp::protocol::FileAttributes) -> SftpEntry {
    let kind: EntryKind = meta.file_type().into();
    let link_target_kind =
        if kind == EntryKind::Symlink { sftp.metadata(path.clone()).await.ok().map(|m| EntryKind::from(m.file_type())) } else { None };
    SftpEntry {
        permissions: SftpEntry::permissions_string(meta.permissions, kind),
        name,
        path,
        kind,
        link_target_kind,
        size: meta.size.unwrap_or(0),
        modified: meta.mtime.map(i64::from),
        owner: meta.uid,
        group: meta.gid,
    }
}

// ── Dossier personnel (point de départ de l'explorateur) ────────────────────
#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String) -> Result<String, String> {
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    match sftp.canonicalize(".").await {
        Ok(p) => Ok(normalize_remote_path(&p).unwrap_or(p)),
        Err(e) => {
            pool.invalidate(&server_id);
            Err(format!("Impossible de déterminer le dossier personnel : {}", e))
        }
    }
}

// ── Liste d'un dossier ───────────────────────────────────────────────────────
#[tauri::command]
pub async fn sftp_list(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String, path: String) -> Result<Vec<SftpEntry>, String> {
    let norm = normalize_remote_path(&path)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let dir = match sftp.read_dir(norm.clone()).await {
        Ok(d) => d,
        Err(e) => {
            pool.invalidate(&server_id);
            return Err(format!("Liste du dossier {} impossible : {}", norm, e));
        }
    };
    let mut entries = Vec::new();
    for item in dir {
        entries.push(entry_from(&sftp, item.file_name(), item.path(), item.metadata()).await);
    }
    sort_entries(&mut entries);
    Ok(entries)
}

// ── Attributs d'une entrée ────────────────────────────────────────────────────
#[tauri::command]
pub async fn sftp_stat(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String, path: String) -> Result<SftpEntry, String> {
    let norm = normalize_remote_path(&path)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let meta = match sftp.symlink_metadata(norm.clone()).await {
        Ok(m) => m,
        Err(e) => {
            pool.invalidate(&server_id);
            return Err(format!("Impossible de lire {} : {}", norm, e));
        }
    };
    let name = norm.rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or("/").to_string();
    Ok(entry_from(&sftp, name, norm, meta).await)
}

// ── Aperçu texte ──────────────────────────────────────────────────────────────
#[tauri::command]
pub async fn sftp_read_text(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String, path: String) -> Result<String, String> {
    let norm = normalize_remote_path(&path)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let meta = match sftp.metadata(norm.clone()).await {
        Ok(m) => m,
        Err(e) => {
            pool.invalidate(&server_id);
            return Err(format!("Impossible de lire {} : {}", norm, e));
        }
    };
    if meta.size.unwrap_or(0) > MAX_TEXT_FILE_SIZE {
        return Err(format!("Fichier trop volumineux pour un aperçu (> {} Mio)", MAX_TEXT_FILE_SIZE / 1024 / 1024));
    }
    let data = match sftp.read(norm.clone()).await {
        Ok(d) => d,
        Err(e) => {
            pool.invalidate(&server_id);
            return Err(format!("Lecture de {} impossible : {}", norm, e));
        }
    };
    if looks_binary(&data) {
        return Err("fichier binaire".into());
    }
    Ok(String::from_utf8_lossy(&data).into_owned())
}

// ── Enregistrement texte (éditeur intégré) ───────────────────────────────────
#[tauri::command]
pub async fn sftp_write_text(
    state: State<'_, AppState>,
    pool: State<'_, SftpPoolState>,
    server_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let norm = normalize_remote_path(&path)?;
    if content.len() as u64 > MAX_TEXT_FILE_SIZE {
        return Err(format!("Contenu trop volumineux (> {} Mio)", MAX_TEXT_FILE_SIZE / 1024 / 1024));
    }
    if looks_binary(content.as_bytes()) {
        return Err("fichier binaire".into());
    }
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let result = write_text_safely(&sftp, &norm, content.as_bytes()).await;
    if result.is_err() {
        pool.invalidate(&server_id);
    }
    result
}

/// Enregistre `content` dans `path` sans perdre le fichier ni ses attributs :
/// 1. copie de secours complète dans un fichier temporaire privé (0600, créé en exclusif) ;
/// 2. réécriture du fichier d'origine en place (ouverture avec troncature) : son inode, son
///    propriétaire et ses permissions sont conservés — un renommage par-dessus ne le
///    permettrait pas, et le RENAME de SFTP v3 échoue de toute façon sur OpenSSH quand la
///    cible existe ;
/// 3. suppression de la copie de secours. Si l'étape 2 échoue (connexion coupée…), la copie
///    est gardée et son chemin est donné dans l'erreur.
async fn write_text_safely(sftp: &SftpSession, norm: &str, content: &[u8]) -> Result<(), String> {
    use russh_sftp::protocol::{FileAttributes, OpenFlags};
    use tokio::io::AsyncWriteExt;

    let parent = parent_path(norm).unwrap_or_else(|| "/".to_string());
    let file_name = norm.rsplit('/').next().unwrap_or("fichier");
    let tmp_path = join_remote_path(&parent, &format!(".{}.tmp-{}", file_name, uuid::Uuid::new_v4()));

    let private = FileAttributes { permissions: Some(0o600), ..FileAttributes::empty() };
    let backup: Result<(), String> = async {
        let mut file = sftp
            .open_with_flags_and_attributes(tmp_path.clone(), OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE, private)
            .await
            .map_err(|e| format!("Écriture impossible : {}", e))?;
        file.write_all(content).await.map_err(|e| format!("Écriture impossible : {}", e))?;
        file.close().await.map_err(|e| format!("Écriture impossible : {}", e))
    }
    .await;
    if let Err(e) = backup {
        let _ = sftp.remove_file(tmp_path).await;
        return Err(e);
    }

    let replace: Result<(), String> = async {
        let mut file = sftp.create(norm.to_string()).await.map_err(|e| format!("Écriture de {} impossible : {}", norm, e))?;
        file.write_all(content).await.map_err(|e| format!("Écriture de {} impossible : {}", norm, e))?;
        file.close().await.map_err(|e| format!("Écriture de {} impossible : {}", norm, e))
    }
    .await;
    match replace {
        Ok(()) => {
            let _ = sftp.remove_file(tmp_path).await;
            Ok(())
        }
        Err(e) => Err(format!("{} — une copie complète du contenu est conservée dans {}", e, tmp_path)),
    }
}

// ── Téléchargement (chemin local choisi par une boîte de dialogue « Enregistrer sous ») ──
#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    pool: State<'_, SftpPoolState>,
    server_id: String,
    remote_path: String,
    local_path: String,
    on_progress: tauri::ipc::Channel<SftpProgress>,
) -> Result<(), String> {
    let norm = normalize_remote_path(&remote_path)?;
    let local = std::path::PathBuf::from(&local_path);
    validate_local_download_path(&local)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let total = sftp
        .metadata(norm.clone())
        .await
        .map_err(|e| {
            pool.invalidate(&server_id);
            format!("Impossible de lire {} : {}", norm, e)
        })?
        .size
        .unwrap_or(0);

    let result: Result<(), String> = async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut remote_file = sftp.open(norm.clone()).await.map_err(|e| format!("Ouverture distante impossible : {}", e))?;
        let mut local_file = tokio::fs::File::create(&local).await.map_err(|e| format!("Création locale impossible : {}", e))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut transferred: u64 = 0;
        loop {
            let n = remote_file.read(&mut buf).await.map_err(|e| format!("Lecture distante interrompue : {}", e))?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buf[..n]).await.map_err(|e| format!("Écriture locale interrompue : {}", e))?;
            transferred += n as u64;
            let _ = on_progress.send(SftpProgress { transferred, total });
        }
        local_file.flush().await.map_err(|e| format!("Écriture locale interrompue : {}", e))?;
        remote_file.close().await.map_err(|e| format!("Fermeture distante échouée : {}", e))
    }
    .await;
    if result.is_err() {
        pool.invalidate(&server_id);
        let _ = tokio::fs::remove_file(&local).await;
    }
    result
}

// ── Téléversement (fichier local choisi par une boîte de dialogue « Ouvrir ») ────────
#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    pool: State<'_, SftpPoolState>,
    server_id: String,
    local_path: String,
    remote_dir: String,
    on_progress: tauri::ipc::Channel<SftpProgress>,
) -> Result<String, String> {
    let dir = normalize_remote_path(&remote_dir)?;
    let local = std::path::PathBuf::from(&local_path);
    let file_name = validate_local_upload_path(&local)?;
    let remote_path = join_remote_path(&dir, &file_name);
    let total = tokio::fs::metadata(&local).await.map(|m| m.len()).unwrap_or(0);
    let sftp = sftp_for(&state, &pool, &server_id).await?;

    let result: Result<(), String> = async {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut local_file = tokio::fs::File::open(&local).await.map_err(|e| format!("Ouverture locale impossible : {}", e))?;
        let mut remote_file = sftp.create(remote_path.clone()).await.map_err(|e| format!("Création distante impossible : {}", e))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut transferred: u64 = 0;
        loop {
            let n = local_file.read(&mut buf).await.map_err(|e| format!("Lecture locale interrompue : {}", e))?;
            if n == 0 {
                break;
            }
            remote_file.write_all(&buf[..n]).await.map_err(|e| format!("Écriture distante interrompue : {}", e))?;
            transferred += n as u64;
            let _ = on_progress.send(SftpProgress { transferred, total });
        }
        remote_file.close().await.map_err(|e| format!("Fermeture distante échouée : {}", e))
    }
    .await;
    if result.is_err() {
        pool.invalidate(&server_id);
        return Err(result.unwrap_err());
    }
    Ok(remote_path)
}

// ── Nouveau dossier ───────────────────────────────────────────────────────────
#[tauri::command]
pub async fn sftp_mkdir(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String, path: String) -> Result<(), String> {
    let norm = normalize_remote_path(&path)?;
    // Le nom du dernier segment est validé comme un nom d'entrée ordinaire (pas de "/", "..", NUL)
    if let Some(name) = norm.rsplit('/').next() {
        validate_entry_name(name)?;
    }
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    sftp.create_dir(norm.clone()).await.map_err(|e| {
        pool.invalidate(&server_id);
        format!("Création du dossier {} impossible : {}", norm, e)
    })
}

// ── Renommer / déplacer ───────────────────────────────────────────────────────
#[tauri::command]
pub async fn sftp_rename(state: State<'_, AppState>, pool: State<'_, SftpPoolState>, server_id: String, from: String, to: String) -> Result<(), String> {
    let from_norm = normalize_remote_path(&from)?;
    let to_norm = normalize_remote_path(&to)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    sftp.rename(from_norm.clone(), to_norm.clone()).await.map_err(|e| {
        pool.invalidate(&server_id);
        format!("Renommage de {} impossible : {}", from_norm, e)
    })
}

// ── Suppression (fichier, dossier vide, ou récursive avec garde-fou explicite) ───────
#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    pool: State<'_, SftpPoolState>,
    server_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let norm = ensure_deletable(&path, recursive)?;
    let sftp = sftp_for(&state, &pool, &server_id).await?;
    let meta = sftp.symlink_metadata(norm.clone()).await.map_err(|e| {
        pool.invalidate(&server_id);
        format!("Impossible de lire {} : {}", norm, e)
    })?;
    let is_dir = meta.file_type() == FileType::Dir;
    let result = if is_dir && recursive {
        delete_recursive(&sftp, &norm).await
    } else if is_dir {
        sftp.remove_dir(norm.clone()).await.map_err(|e| format!("Suppression du dossier {} impossible (non vide ?) : {}", norm, e))
    } else {
        sftp.remove_file(norm.clone()).await.map_err(|e| format!("Suppression de {} impossible : {}", norm, e))
    };
    if result.is_err() {
        pool.invalidate(&server_id);
    }
    result
}

/// Suppression récursive itérative (pas de récursion async) : tout le contenu d'abord
/// (fichiers, puis dossiers du plus profond au moins profond), le dossier racine en dernier.
async fn delete_recursive(sftp: &SftpSession, root: &str) -> Result<(), String> {
    let mut dirs_to_remove = vec![root.to_string()];
    let mut stack = vec![root.to_string()];
    while let Some(dir) = stack.pop() {
        let entries: Vec<_> = sftp.read_dir(dir.clone()).await.map_err(|e| format!("Lecture de {} impossible : {}", dir, e))?.collect();
        for item in entries {
            let child = item.path();
            if item.file_type() == FileType::Dir {
                dirs_to_remove.push(child.clone());
                stack.push(child);
            } else {
                sftp.remove_file(child.clone()).await.map_err(|e| format!("Suppression de {} impossible : {}", child, e))?;
            }
        }
    }
    for dir in dirs_to_remove.into_iter().rev() {
        sftp.remove_dir(dir.clone()).await.map_err(|e| format!("Suppression du dossier {} impossible : {}", dir, e))?;
    }
    Ok(())
}

/// Bout en bout contre le sous-système SFTP du serveur de test (`ssh_test_server`), adossé
/// à un vrai dossier temporaire sur le disque.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::ssh_auth::SshAuth;
    use crate::ssh_test_server;
    use std::path::PathBuf;
    use zeroize::Zeroizing;

    /// Dossier temporaire jetable pour un test, nettoyé à sa destruction.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = std::env::temp_dir().join(format!("sftp-cmd-test-{}-{}", tag, uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    async fn server_and_sftp(root: PathBuf) -> (ssh_test_server::TestServer, SftpSession) {
        let server = ssh_test_server::start_with_sftp(Some("pw"), vec![], root).await;
        let target = SshTarget { host: "127.0.0.1".into(), port: server.port, user: "admin".into(), auth: SshAuth::Password(Zeroizing::new("pw".into())), jump: None };
        // Magasin known_hosts en mémoire (confiance à la première connexion) : jamais le
        // magasin global, qu'un test de ce module ne doit pas initialiser (voir `connect_sftp_with`).
        let store = Arc::new(std::sync::Mutex::new(crate::known_hosts::KnownHosts::default()));
        let verify: crate::commands::ssh::HostVerifier = Arc::new(move |host, fp| store.lock().unwrap().check(host, fp));
        let (_ssh, sftp) = connect_sftp_with(&target, 5, verify).await.unwrap();
        (server, sftp)
    }

    #[tokio::test]
    async fn list_reflects_the_real_directory_dirs_first() {
        let dir = TempDir::new("list");
        std::fs::write(dir.0.join("z.txt"), b"contenu").unwrap();
        std::fs::create_dir(dir.0.join("a-dossier")).unwrap();
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;

        let mut entries = Vec::new();
        for item in sftp.read_dir("/").await.unwrap() {
            entries.push(entry_from(&sftp, item.file_name(), item.path(), item.metadata()).await);
        }
        sort_entries(&mut entries);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["a-dossier", "z.txt"]);
        assert_eq!(entries[0].kind, EntryKind::Dir);
        assert_eq!(entries[1].kind, EntryKind::File);
        assert_eq!(entries[1].size, 7);
    }

    #[tokio::test]
    async fn saving_an_existing_file_keeps_its_permissions_and_leaves_no_temp_file() {
        let dir = TempDir::new("write");
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;
        let target = dir.0.join("secret.conf");
        std::fs::write(&target, b"ancien contenu").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
        }

        write_text_safely(&sftp, "/secret.conf", b"nouveau").await.unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"nouveau");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o640);
        }
        let leftovers: Vec<_> = std::fs::read_dir(&dir.0).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name()).collect();
        assert_eq!(leftovers.len(), 1, "fichier temporaire restant : {leftovers:?}");
    }

    #[tokio::test]
    async fn saving_a_new_file_creates_it() {
        let dir = TempDir::new("write-new");
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;
        write_text_safely(&sftp, "/nouveau.txt", b"bonjour").await.unwrap();
        assert_eq!(std::fs::read(dir.0.join("nouveau.txt")).unwrap(), b"bonjour");
    }

    #[tokio::test]
    async fn mkdir_rename_and_delete_act_on_the_real_directory() {
        let dir = TempDir::new("ops");
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;

        sftp.create_dir("/sous-dossier").await.unwrap();
        assert!(dir.0.join("sous-dossier").is_dir());

        sftp.create("/sous-dossier/a.txt").await.unwrap().close().await.unwrap();
        sftp.rename("/sous-dossier/a.txt", "/sous-dossier/b.txt").await.unwrap();
        assert!(dir.0.join("sous-dossier/b.txt").exists());

        // Dossier non vide : suppression simple refusée, récursive (locale) réussit
        assert!(sftp.remove_dir("/sous-dossier").await.is_err());
        sftp.remove_file("/sous-dossier/b.txt").await.unwrap();
        sftp.remove_dir("/sous-dossier").await.unwrap();
        assert!(!dir.0.join("sous-dossier").exists());
    }

    #[tokio::test]
    async fn recursive_delete_removes_everything_below_the_target() {
        let dir = TempDir::new("recursive");
        std::fs::create_dir_all(dir.0.join("a/b")).unwrap();
        std::fs::write(dir.0.join("a/f1.txt"), b"1").unwrap();
        std::fs::write(dir.0.join("a/b/f2.txt"), b"2").unwrap();
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;

        delete_recursive(&sftp, "/a").await.unwrap();
        assert!(!dir.0.join("a").exists());
    }

    #[tokio::test]
    async fn binary_content_is_refused_by_the_read_text_guard() {
        let dir = TempDir::new("binary");
        std::fs::write(dir.0.join("blob.bin"), [0u8, 1, 2, 0]).unwrap();
        let (_server, sftp) = server_and_sftp(dir.0.clone()).await;
        let data = sftp.read("/blob.bin").await.unwrap();
        assert!(looks_binary(&data));
    }
}
