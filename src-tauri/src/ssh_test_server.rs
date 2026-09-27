//! Serveur SSH minimal (russh) lancé dans les tests, sur 127.0.0.1 : mot de passe, clés
//! autorisées, exécution factice (« ran: <commande> »), commande interactive « question »
//! (attend une réponse), shell en écho (console), canaux direct-tcpip (rebond) et,
//! optionnellement, un sous-système SFTP adossé à un vrai dossier local (`start_with_sftp`)
//! pour tester `commands::sftp` de bout en bout sans dépendre d'un serveur externe.
use russh::keys::{ssh_key, PrivateKey};
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId, Pty};
use russh_sftp::protocol::{Attrs, Data, File as SftpFile, FileAttributes, Handle, Name, OpenFlags, Status, StatusCode, Version};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct TestServer {
    pub port: u16,
    /// Empreinte de la clé d'hôte, au format du magasin known_hosts
    pub fingerprint: String,
    log: Arc<Mutex<Vec<String>>>,
}

impl TestServer {
    /// Événements vus par le serveur : « password:user », « publickey:user », « direct-tcpip:hôte:port »
    pub fn log(&self) -> Vec<String> {
        self.log.lock().map(|l| l.clone()).unwrap_or_default()
    }
}

#[derive(Clone)]
struct Policy {
    password: Option<String>,
    authorized: Vec<ssh_key::PublicKey>,
    log: Arc<Mutex<Vec<String>>>,
    /// Racine locale du sous-système SFTP, quand le test en a besoin (`start_with_sftp`)
    sftp_root: Option<PathBuf>,
}

/// Ce que fait un canal quand il reçoit des données
enum Mode {
    /// Commande « question » : répond puis termine
    Question,
    /// Shell de console : renvoie chaque saisie
    Echo,
}

struct Handler {
    policy: Policy,
    modes: HashMap<ChannelId, Mode>,
    /// Canaux ouverts, gardés jusqu'à une éventuelle demande de sous-système (il faut le
    /// `Channel<Msg>` lui-même, pas seulement son id, pour en faire un flux SFTP)
    channels: HashMap<ChannelId, Channel<Msg>>,
}

impl Handler {
    fn authorized(&self, key: &ssh_key::PublicKey) -> bool {
        self.policy.authorized.iter().any(|k| k.key_data() == key.key_data())
    }
    fn record(&self, event: String) {
        if let Ok(mut l) = self.policy.log.lock() {
            l.push(event);
        }
    }
}

impl server::Handler for Handler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if self.policy.password.as_deref() == Some(password) {
            self.record(format!("password:{}", user));
            return Ok(Auth::Accept);
        }
        Ok(Auth::reject())
    }

    async fn auth_publickey_offered(&mut self, _user: &str, key: &ssh_key::PublicKey) -> Result<Auth, Self::Error> {
        Ok(if self.authorized(key) { Auth::Accept } else { Auth::reject() })
    }

    async fn auth_publickey(&mut self, user: &str, key: &ssh_key::PublicKey) -> Result<Auth, Self::Error> {
        if self.authorized(key) {
            self.record(format!("publickey:{}", user));
            return Ok(Auth::Accept);
        }
        Ok(Auth::reject())
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    /// Sous-système SFTP (RFC4254 §6.5) : seul « sftp » est pris en charge, adossé au
    /// dossier local passé à `start_with_sftp`.
    async fn subsystem_request(&mut self, channel_id: ChannelId, name: &str, session: &mut Session) -> Result<(), Self::Error> {
        match (name, self.channels.remove(&channel_id), self.policy.sftp_root.clone()) {
            ("sftp", Some(channel), Some(root)) => {
                self.record("subsystem:sftp".to_string());
                session.channel_success(channel_id)?;
                tokio::spawn(russh_sftp::server::run(channel.into_stream(), FsSftpHandler::new(root)));
            }
            _ => session.channel_failure(channel_id)?,
        }
        Ok(())
    }

    async fn exec_request(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        if data == b"question" {
            self.modes.insert(channel, Mode::Question);
            session.data(channel, b"Continuer ? [O/n] ".to_vec())?;
            return Ok(());
        }
        let out = format!("ran: {}", String::from_utf8_lossy(data));
        session.data(channel, out.into_bytes())?;
        session.exit_status_request(channel, 0)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn pty_request(
        &mut self,
        _channel: ChannelId,
        term: &str,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(format!("pty:{}:{}x{}", term, col_width, row_height));
        Ok(())
    }

    async fn shell_request(&mut self, channel: ChannelId, _session: &mut Session) -> Result<(), Self::Error> {
        self.modes.insert(channel, Mode::Echo);
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        col_width: u32,
        row_height: u32,
        _pix_width: u32,
        _pix_height: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(format!("resize:{}x{}", col_width, row_height));
        Ok(())
    }

    async fn data(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> Result<(), Self::Error> {
        match self.modes.get(&channel) {
            Some(Mode::Question) => {
                let answer = format!("\r\nréponse: {}\r\n", String::from_utf8_lossy(data).trim());
                session.data(channel, answer.into_bytes())?;
                session.exit_status_request(channel, 0)?;
                session.eof(channel)?;
                session.close(channel)?;
            }
            Some(Mode::Echo) => session.data(channel, [b"echo:", data].concat())?,
            None => {}
        }
        Ok(())
    }

    /// Rebond : relaie le canal vers host:port en TCP
    async fn channel_open_direct_tcpip(
        &mut self,
        channel: Channel<Msg>,
        host_to_connect: &str,
        port_to_connect: u32,
        _originator_address: &str,
        _originator_port: u32,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(format!("direct-tcpip:{}:{}", host_to_connect, port_to_connect));
        let addr = format!("{}:{}", host_to_connect, port_to_connect);
        reply.accept().await;
        tokio::spawn(async move {
            if let Ok(mut tcp) = tokio::net::TcpStream::connect(addr).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut tcp).await;
            }
        });
        Ok(())
    }
}

/// Démarre un serveur qui accepte `password` et/ou les clés publiques `authorized`
pub async fn start(password: Option<&str>, authorized: Vec<ssh_key::PublicKey>) -> TestServer {
    start_inner(password, authorized, None).await
}

/// Comme `start`, avec en plus un sous-système SFTP adossé au dossier local `root` (déjà
/// existant sur le disque : c'est à l'appelant de le créer et de le nettoyer).
pub async fn start_with_sftp(password: Option<&str>, authorized: Vec<ssh_key::PublicKey>, root: PathBuf) -> TestServer {
    start_inner(password, authorized, Some(root)).await
}

async fn start_inner(password: Option<&str>, authorized: Vec<ssh_key::PublicKey>, sftp_root: Option<PathBuf>) -> TestServer {
    let host_key: PrivateKey = crate::ssh_keys::generate_ed25519("hôte de test").expect("clé d'hôte");
    let fingerprint = crate::commands::ssh::host_fingerprint(host_key.public_key());
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::from_millis(1),
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..Default::default()
    });
    let log = Arc::new(Mutex::new(Vec::new()));
    let policy = Policy { password: password.map(str::to_string), authorized, log: log.clone(), sftp_root };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("port local");
    let port = listener.local_addr().expect("adresse locale").port();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let (config, handler) =
                (config.clone(), Handler { policy: policy.clone(), modes: HashMap::new(), channels: HashMap::new() });
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    TestServer { port, fingerprint, log }
}

// ── Sous-système SFTP de test : opérations réelles sur un dossier local ────────
fn ok_status(id: u32) -> Status {
    Status { id, status_code: StatusCode::Ok, error_message: "Ok".into(), language_tag: "en-US".into() }
}

/// Poignées ouvertes (fichiers ou dossiers), par identifiant opaque
enum Open {
    File(std::fs::File),
    Dir(Vec<std::fs::DirEntry>),
}

/// Implémentation minimale, mais réelle, du serveur SFTP (`russh_sftp::server::Handler`) :
/// chaque opération agit vraiment sur le dossier `root`, sans jamais en sortir (les chemins
/// reçus sont déjà normalisés côté client — `sftp::normalize_remote_path` — mais on les
/// résout ici de façon défensive, en retirant tout `..`).
struct FsSftpHandler {
    root: PathBuf,
    open: HashMap<String, Open>,
    next_handle: u64,
}

impl FsSftpHandler {
    fn new(root: PathBuf) -> Self {
        Self { root, open: HashMap::new(), next_handle: 0 }
    }

    fn resolve(&self, path: &str) -> PathBuf {
        let mut real = self.root.clone();
        for comp in path.split('/') {
            match comp {
                "" | "." => {}
                ".." => {
                    real.pop();
                }
                other => real.push(other),
            }
        }
        real
    }

    fn new_handle(&mut self) -> String {
        self.next_handle += 1;
        format!("h{}", self.next_handle)
    }
}

impl russh_sftp::server::Handler for FsSftpHandler {
    type Error = StatusCode;

    fn unimplemented(&self) -> Self::Error {
        StatusCode::OpUnsupported
    }

    async fn init(&mut self, _version: u32, _extensions: HashMap<String, String>) -> Result<Version, Self::Error> {
        Ok(Version::new())
    }

    /// Utilisé par `sftp_home` (canonicalize(".")) : la racine locale du test fait
    /// toujours office de "/" côté client.
    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, Self::Error> {
        let target = if path.is_empty() || path == "." { "/".to_string() } else { path };
        Ok(Name { id, files: vec![SftpFile::dummy(target)] })
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, Self::Error> {
        let entries: Vec<_> = std::fs::read_dir(self.resolve(&path))
            .map_err(|_| StatusCode::NoSuchFile)?
            .filter_map(Result::ok)
            .collect();
        let handle = self.new_handle();
        self.open.insert(handle.clone(), Open::Dir(entries));
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, Self::Error> {
        match self.open.get_mut(&handle) {
            Some(Open::Dir(entries)) if !entries.is_empty() => {
                let files = entries
                    .drain(..)
                    .filter_map(|e| {
                        let meta = e.metadata().ok()?;
                        Some(SftpFile::new(e.file_name().to_string_lossy().into_owned(), FileAttributes::from(&meta)))
                    })
                    .collect();
                Ok(Name { id, files })
            }
            Some(Open::Dir(_)) => Err(StatusCode::Eof),
            _ => Err(StatusCode::Failure),
        }
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, Self::Error> {
        self.open.remove(&handle);
        Ok(ok_status(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let meta = std::fs::symlink_metadata(self.resolve(&path)).map_err(|_| StatusCode::NoSuchFile)?;
        Ok(Attrs { id, attrs: FileAttributes::from(&meta) })
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, Self::Error> {
        let meta = std::fs::metadata(self.resolve(&path)).map_err(|_| StatusCode::NoSuchFile)?;
        Ok(Attrs { id, attrs: FileAttributes::from(&meta) })
    }

    async fn open(&mut self, id: u32, filename: String, pflags: OpenFlags, _attrs: FileAttributes) -> Result<Handle, Self::Error> {
        let mut opts = std::fs::OpenOptions::new();
        opts.read(pflags.contains(OpenFlags::READ))
            .write(pflags.contains(OpenFlags::WRITE))
            .create(pflags.contains(OpenFlags::CREATE))
            .truncate(pflags.contains(OpenFlags::TRUNCATE))
            .append(pflags.contains(OpenFlags::APPEND));
        let file = opts.open(self.resolve(&filename)).map_err(|_| StatusCode::Failure)?;
        let handle = self.new_handle();
        self.open.insert(handle.clone(), Open::File(file));
        Ok(Handle { id, handle })
    }

    async fn read(&mut self, id: u32, handle: String, offset: u64, len: u32) -> Result<Data, Self::Error> {
        use std::io::{Read, Seek, SeekFrom};
        let Some(Open::File(file)) = self.open.get_mut(&handle) else { return Err(StatusCode::Failure) };
        file.seek(SeekFrom::Start(offset)).map_err(|_| StatusCode::Failure)?;
        let mut buf = vec![0u8; len as usize];
        let n = file.read(&mut buf).map_err(|_| StatusCode::Failure)?;
        if n == 0 {
            return Err(StatusCode::Eof);
        }
        buf.truncate(n);
        Ok(Data { id, data: buf })
    }

    async fn write(&mut self, id: u32, handle: String, offset: u64, data: Vec<u8>) -> Result<Status, Self::Error> {
        use std::io::{Seek, SeekFrom, Write};
        let Some(Open::File(file)) = self.open.get_mut(&handle) else { return Err(StatusCode::Failure) };
        file.seek(SeekFrom::Start(offset)).map_err(|_| StatusCode::Failure)?;
        file.write_all(&data).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, Self::Error> {
        std::fs::remove_file(self.resolve(&filename)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn mkdir(&mut self, id: u32, path: String, _attrs: FileAttributes) -> Result<Status, Self::Error> {
        std::fs::create_dir(self.resolve(&path)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, Self::Error> {
        std::fs::remove_dir(self.resolve(&path)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }

    async fn rename(&mut self, id: u32, oldpath: String, newpath: String) -> Result<Status, Self::Error> {
        std::fs::rename(self.resolve(&oldpath), self.resolve(&newpath)).map_err(|_| StatusCode::Failure)?;
        Ok(ok_status(id))
    }
}
