/// Authentification par agent SSH (`russh::keys::agent::client::AgentClient`).
///
/// Transports pris en charge :
/// - Windows : agent OpenSSH (service « OpenSSH Authentication Agent »), canal nommé
///   `\\.\pipe\openssh-ssh-agent` (`AgentClient::connect_named_pipe`), puis Pageant
///   (`AgentClient::connect_pageant` : canal nommé de Pageant ≥ 0.75, sinon WM_COPYDATA) ;
/// - autres OS (tests, développement) : socket `SSH_AUTH_SOCK`.
///
/// Chaque agent joignable est essayé dans cet ordre ; seules ses premières clés sont proposées,
/// sshd coupant la connexion après `MaxAuthTries` échecs (6 par défaut). Les certificats
/// détenus par l'agent sont ignorés.
use russh::client;
use russh::keys::agent::{client::AgentClient, AgentIdentity};
use russh::keys::HashAlg;
use serde::Serialize;
use std::future::Future;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite};

/// Nombre de clés de l'agent proposées au serveur
const MAX_AGENT_KEYS: usize = 5;

/// Délai max pour une opération d'agent (lister les clés ou signer) : un agent qui ne répond pas
/// (Pageant lancé sous un autre niveau de privilèges que l'app, agent bloqué sur une confirmation
/// jamais affichée…) ne doit ni geler la connexion ni le bouton « Tester l'agent ».
#[cfg(not(test))]
const AGENT_OP_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(test)]
const AGENT_OP_TIMEOUT: Duration = Duration::from_millis(300);

/// Borne une opération d'agent ; au-delà du délai, message explicite plutôt qu'un blocage silencieux
async fn with_timeout<T>(source: &str, fut: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(AGENT_OP_TIMEOUT, fut)
        .await
        .unwrap_or_else(|_| Err(format!("{} ne répond pas (délai dépassé)", source)))
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AgentKey {
    pub source: String,
    pub algorithm: String,
    /// « SHA256:… »
    pub fingerprint: String,
    pub comment: String,
}

/// État des agents pour l'interface (aucun secret : clés publiques seulement)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AgentStatus {
    pub available: bool,
    pub sources: Vec<String>,
    pub keys: Vec<AgentKey>,
    /// Pourquoi certains agents sont absents ou illisibles
    pub errors: Vec<String>,
    /// Comment rendre un agent disponible sur cet OS
    pub hint: String,
}

/// Un agent joignable (le type du flux dépend de l'OS)
enum Agent {
    #[cfg(unix)]
    Unix(AgentClient<tokio::net::UnixStream>),
    #[cfg(windows)]
    OpenSshPipe(AgentClient<tokio::net::windows::named_pipe::NamedPipeClient>),
    #[cfg(windows)]
    Pageant(AgentClient<pageant::PageantStream>),
}

/// Clés publiques simples de l'agent (les certificats sont écartés)
async fn identities<S>(agent: &mut AgentClient<S>) -> Result<Vec<(russh::keys::PublicKey, String)>, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let list = agent.request_identities().await.map_err(|e| format!("lecture des clés impossible ({})", e))?;
    Ok(list
        .into_iter()
        .filter_map(|id| match id {
            AgentIdentity::PublicKey { key, comment } => Some((key, comment)),
            AgentIdentity::Certificate { .. } => None,
        })
        .collect())
}

/// Essaie les clés d'un agent, une par une, dans l'ordre où l'agent les propose ; Ok(false) si
/// aucune n'est acceptée par le serveur.
///
/// Une clé dont la signature échoue côté agent (ex. Pageant a affiché une confirmation jamais
/// validée, ou une clé matérielle retirée entre-temps) ne doit pas empêcher d'essayer les clés
/// suivantes : seul un échec de TOUTES les clés sans le moindre refus propre du serveur est
/// remonté comme une erreur d'agent ; sinon la réponse est un simple « non accepté » (Ok(false)),
/// identique à celle d'une mauvaise clé.
pub(crate) async fn auth_with_agent<H, S>(
    handle: &mut client::Handle<H>,
    user: &str,
    mut agent: AgentClient<S>,
) -> Result<bool, String>
where
    H: client::Handler,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let keys = identities(&mut agent).await?;
    if keys.is_empty() {
        return Err("aucune clé chargée (ssh-add)".into());
    }
    let mut rejected_by_server = false;
    let mut agent_error = None;
    for (key, _) in keys.into_iter().take(MAX_AGENT_KEYS) {
        let hash: Option<HashAlg> =
            if key.algorithm().is_rsa() { crate::commands::ssh::rsa_hash(handle).await } else { None };
        match handle.authenticate_publickey_with(user, key, hash, &mut agent).await {
            Ok(result) if result.success() => return Ok(true),
            Ok(_) => rejected_by_server = true,
            Err(e) => agent_error = Some(format!("signature refusée par l'agent ({})", e)),
        }
    }
    // Aucune clé n'a même atteint le serveur : l'agent lui-même a un problème, à signaler tel quel
    if !rejected_by_server {
        if let Some(e) = agent_error {
            return Err(e);
        }
    }
    Ok(false)
}

async fn list_keys<S>(source: &str, mut agent: AgentClient<S>) -> Result<Vec<AgentKey>, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let keys = identities(&mut agent).await.map_err(|e| format!("{} : {}", source, e))?;
    Ok(keys
        .into_iter()
        .map(|(key, comment)| AgentKey {
            source: source.to_string(),
            algorithm: key.algorithm().as_str().to_string(),
            fingerprint: key.fingerprint(HashAlg::Sha256).to_string(),
            comment: crate::ssh_keys::sanitize_comment(&comment),
        })
        .collect())
}

/// S'authentifie avec le premier agent qui fait accepter une de ses clés
pub(crate) async fn authenticate<H: client::Handler>(handle: &mut client::Handle<H>, user: &str) -> Result<(), String> {
    let (agents, mut errors) = platform::connect_all().await;
    if agents.is_empty() {
        return Err(format!("Aucun agent SSH joignable ({}). {}", errors.join(" ; "), platform::HINT));
    }
    for (source, agent) in agents {
        let result = with_timeout(&source, async {
            match agent {
                #[cfg(unix)]
                Agent::Unix(c) => auth_with_agent(handle, user, c).await,
                #[cfg(windows)]
                Agent::OpenSshPipe(c) => auth_with_agent(handle, user, c).await,
                #[cfg(windows)]
                Agent::Pageant(c) => auth_with_agent(handle, user, c).await,
            }
        })
        .await;
        match result {
            Ok(true) => return Ok(()),
            Ok(false) => errors.push(format!("{} : aucune clé acceptée par le serveur", source)),
            Err(e) => errors.push(format!("{} : {}", source, e)),
        }
    }
    Err(format!("Authentification par agent SSH refusée — {}", errors.join(" ; ")))
}

/// Agents joignables et clés qu'ils proposent
pub async fn status() -> AgentStatus {
    let (agents, mut errors) = platform::connect_all().await;
    let mut sources = Vec::new();
    let mut keys = Vec::new();
    for (source, agent) in agents {
        let listed = with_timeout(&source, async {
            match agent {
                #[cfg(unix)]
                Agent::Unix(c) => list_keys(&source, c).await,
                #[cfg(windows)]
                Agent::OpenSshPipe(c) => list_keys(&source, c).await,
                #[cfg(windows)]
                Agent::Pageant(c) => list_keys(&source, c).await,
            }
        })
        .await;
        match listed {
            Ok(list) => {
                sources.push(source);
                keys.extend(list);
            }
            Err(e) => errors.push(e),
        }
    }
    AgentStatus { available: !sources.is_empty(), sources, keys, errors, hint: platform::HINT.to_string() }
}

#[cfg(unix)]
mod platform {
    use super::Agent;
    use russh::keys::agent::client::AgentClient;

    pub const HINT: &str = "Lance ssh-agent, charge une clé avec ssh-add et définis SSH_AUTH_SOCK.";

    pub async fn connect_all() -> (Vec<(String, Agent)>, Vec<String>) {
        let Some(path) = std::env::var_os("SSH_AUTH_SOCK").filter(|p| !p.is_empty()) else {
            return (Vec::new(), vec!["SSH_AUTH_SOCK non défini".into()]);
        };
        match AgentClient::connect_uds(&path).await {
            Ok(client) => (vec![("ssh-agent (SSH_AUTH_SOCK)".into(), Agent::Unix(client))], Vec::new()),
            Err(e) => (Vec::new(), vec![format!("ssh-agent injoignable ({})", e)]),
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::Agent;
    use russh::keys::agent::client::AgentClient;
    use std::time::Duration;

    /// Canal nommé du service « OpenSSH Authentication Agent » de Windows
    pub const OPENSSH_PIPE: &str = r"\\.\pipe\openssh-ssh-agent";
    pub const HINT: &str = "Démarre le service « OpenSSH Authentication Agent » (Services Windows) et charge une clé avec ssh-add, \
                            ou lance Pageant avec ta clé.";

    pub async fn connect_all() -> (Vec<(String, Agent)>, Vec<String>) {
        let mut agents = Vec::new();
        let mut errors = Vec::new();
        // connect_named_pipe réessaie tant que le canal est occupé : on borne l'attente
        match tokio::time::timeout(Duration::from_secs(2), AgentClient::connect_named_pipe(OPENSSH_PIPE)).await {
            Ok(Ok(client)) => agents.push(("Agent OpenSSH de Windows".to_string(), Agent::OpenSshPipe(client))),
            Ok(Err(e)) => errors.push(format!("agent OpenSSH de Windows absent ({})", e)),
            Err(_) => errors.push("agent OpenSSH de Windows occupé".into()),
        }
        // Pageant garde toujours sa fenêtre « Pageant » (WM_COPYDATA), même quand il sert aussi un
        // canal nommé : sans elle, inutile d'essayer (le transport WM_COPYDATA ne l'échoue qu'à
        // la première requête).
        if pageant::wmmessage::is_pageant_running() {
            match AgentClient::connect_pageant().await {
                Ok(client) => agents.push(("Pageant".to_string(), Agent::Pageant(client))),
                Err(e) => errors.push(format!("Pageant injoignable ({})", e)),
            }
        } else {
            errors.push("Pageant non lancé".into());
        }
        (agents, errors)
    }
}

// ── Tests ────────────────────────────────────────────────────────────────
// Ces tests appellent `auth_with_agent`/`list_keys` directement sur une socket Unix de test
// (`ssh_test_server::start_agent_with`), sans passer par `platform::connect_all` : ils ne touchent
// donc jamais `SSH_AUTH_SOCK` et peuvent tourner en parallèle du test qui, lui, le fait
// (`commands::ssh::tests::agent_auth_uses_ssh_auth_sock`, seul autorisé à y toucher).
#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ssh_test_server;
    use russh::keys::PublicKeyOrCertificate;

    /// Handler client minimal : accepte toute clé d'hôte (le TOFU est testé ailleurs)
    struct AcceptAnyHost;
    impl client::Handler for AcceptAnyHost {
        type Error = russh::Error;
        async fn check_server_key(&mut self, _key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
            Ok(true)
        }
    }

    async fn connect(port: u16) -> client::Handle<AcceptAnyHost> {
        let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.expect("connexion TCP");
        client::connect_stream(std::sync::Arc::new(client::Config::default()), tcp, AcceptAnyHost)
            .await
            .expect("poignée de main SSH")
    }

    #[tokio::test]
    async fn keys_are_tried_one_by_one_until_one_is_accepted() {
        let wrong = crate::ssh_keys::generate_ed25519("wrong").unwrap();
        let right = crate::ssh_keys::generate_ed25519("right").unwrap();
        let server = ssh_test_server::start(None, vec![right.public_key().clone()]).await;
        // L'agent propose d'abord la mauvaise clé, puis la bonne : les deux doivent être essayées
        let path = ssh_test_server::start_agent_with(&[wrong, right]).await;
        let agent = AgentClient::connect_uds(&path).await.unwrap();
        let mut handle = connect(server.port).await;

        assert!(auth_with_agent(&mut handle, "admin", agent).await.unwrap());
        assert!(server.log().contains(&"publickey:admin".to_string()));
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn no_key_of_the_agent_is_accepted_gives_a_plain_rejection() {
        let key = crate::ssh_keys::generate_ed25519("agent-only").unwrap();
        let server = ssh_test_server::start(None, vec![]).await; // n'autorise aucune clé
        let path = ssh_test_server::start_agent_with(&[key]).await;
        let agent = AgentClient::connect_uds(&path).await.unwrap();
        let mut handle = connect(server.port).await;

        assert_eq!(auth_with_agent(&mut handle, "admin", agent).await.unwrap(), false);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn empty_agent_gives_a_clear_error_instead_of_a_silent_rejection() {
        let server = ssh_test_server::start(None, vec![]).await;
        let path = ssh_test_server::start_agent_with(&[]).await;
        let agent = AgentClient::connect_uds(&path).await.unwrap();
        let mut handle = connect(server.port).await;

        let err = auth_with_agent(&mut handle, "admin", agent).await.unwrap_err();
        assert!(err.contains("aucune clé chargée"), "{}", err);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn list_keys_reports_fingerprint_and_algorithm() {
        // NB : le serveur d'agent générique de russh (`agent::server::serve`, utilisé ici comme
        // agent de test) ignore le commentaire à l'ajout d'une identité (il le décode et le jette,
        // cf. `russh::keys::agent::server`) : un vrai agent OpenSSH/Pageant le renvoie, donc le
        // passage par `sanitize_comment` est couvert directement dans `ssh_keys::tests` plutôt
        // qu'ici via un aller-retour impossible à reproduire avec ce double de test.
        let key = crate::ssh_keys::generate_ed25519("poste principal").unwrap();
        let fp = key.fingerprint(HashAlg::Sha256).to_string();
        let path = ssh_test_server::start_agent_with(&[key]).await;
        let agent = AgentClient::connect_uds(&path).await.unwrap();

        let keys = list_keys("agent de test", agent).await.unwrap();
        assert_eq!(keys.len(), 1);
        assert_eq!(keys[0].algorithm, "ssh-ed25519");
        assert_eq!(keys[0].fingerprint, fp);
        assert_eq!(keys[0].source, "agent de test");
        let _ = std::fs::remove_file(&path);
    }

    /// Un agent joignable mais qui ne répond jamais (ex. Pageant lancé sous un autre niveau de
    /// privilèges) ne doit pas geler indéfiniment le test de connexion.
    #[tokio::test]
    async fn an_unresponsive_agent_times_out_instead_of_hanging() {
        let path = std::env::temp_dir().join(format!("spm-agent-mute-{}.sock", uuid::Uuid::new_v4()));
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        // Accepte la connexion mais ne lit ni n'écrit jamais : identities() reste en attente
        tokio::spawn(async move {
            if let Ok((stream, _)) = listener.accept().await {
                std::mem::forget(stream);
                std::future::pending::<()>().await;
            }
        });
        let agent = AgentClient::connect_uds(&path).await.unwrap();

        let started = std::time::Instant::now();
        let err = with_timeout("agent muet", list_keys("agent muet", agent)).await.unwrap_err();
        assert!(err.contains("délai dépassé"), "{}", err);
        assert!(started.elapsed() < Duration::from_secs(5), "le délai de test n'a pas été respecté");
        let _ = std::fs::remove_file(&path);
    }
}
