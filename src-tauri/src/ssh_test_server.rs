//! Serveur SSH minimal (russh) lancé dans les tests, sur 127.0.0.1 : mot de passe, clés
//! autorisées, exécution factice (« ran: <commande> »), commande interactive « question »
//! (attend une réponse), shell en écho (console) et canaux direct-tcpip (rebond).
//! Plus un agent SSH (socket Unix) pour tester l'authentification par agent.
use russh::keys::{ssh_key, PrivateKey};
use russh::server::{self, Auth, Msg, Session};
use russh::{Channel, ChannelId, Pty};
use std::collections::HashMap;
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
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
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
    let host_key: PrivateKey = crate::ssh_keys::generate_ed25519("hôte de test").expect("clé d'hôte");
    let fingerprint = crate::commands::ssh::host_fingerprint(host_key.public_key());
    let config = Arc::new(server::Config {
        keys: vec![host_key],
        auth_rejection_time: Duration::from_millis(1),
        auth_rejection_time_initial: Some(Duration::ZERO),
        ..Default::default()
    });
    let log = Arc::new(Mutex::new(Vec::new()));
    let policy = Policy { password: password.map(str::to_string), authorized, log: log.clone() };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("port local");
    let port = listener.local_addr().expect("adresse locale").port();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let (config, handler) = (config.clone(), Handler { policy: policy.clone(), modes: HashMap::new() });
            tokio::spawn(async move {
                if let Ok(session) = server::run_stream(config, socket, handler).await {
                    let _ = session.await;
                }
            });
        }
    });
    TestServer { port, fingerprint, log }
}

#[derive(Clone)]
struct TestAgent;
impl russh::keys::agent::server::Agent for TestAgent {}

/// Agent SSH sur une socket Unix temporaire, chargé avec `key` ; renvoie le chemin de la socket
#[cfg(unix)]
pub async fn start_agent(key: &PrivateKey) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("spm-agent-{}.sock", uuid::Uuid::new_v4()));
    let listener = tokio::net::UnixListener::bind(&path).expect("socket de l'agent");
    let connections = Box::pin(futures::stream::unfold(listener, |l| async move {
        let next = l.accept().await.map(|(stream, _)| stream);
        Some((next, l))
    }));
    tokio::spawn(russh::keys::agent::server::serve(connections, TestAgent));
    let mut client = russh::keys::agent::client::AgentClient::connect_uds(&path).await.expect("connexion à l'agent");
    client.add_identity(key, &[]).await.expect("clé ajoutée à l'agent");
    path
}
