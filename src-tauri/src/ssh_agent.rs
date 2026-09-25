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
use tokio::io::{AsyncRead, AsyncWrite};

/// Nombre de clés de l'agent proposées au serveur
const MAX_AGENT_KEYS: usize = 5;

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

/// Essaie les clés d'un agent ; Ok(false) si aucune n'est acceptée
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
    for (key, _) in keys.into_iter().take(MAX_AGENT_KEYS) {
        let hash: Option<HashAlg> =
            if key.algorithm().is_rsa() { crate::commands::ssh::rsa_hash(handle).await } else { None };
        match handle.authenticate_publickey_with(user, key, hash, &mut agent).await {
            Ok(result) if result.success() => return Ok(true),
            Ok(_) => continue,
            Err(e) => return Err(format!("signature refusée par l'agent ({})", e)),
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
        let result = match agent {
            #[cfg(unix)]
            Agent::Unix(c) => auth_with_agent(handle, user, c).await,
            #[cfg(windows)]
            Agent::OpenSshPipe(c) => auth_with_agent(handle, user, c).await,
            #[cfg(windows)]
            Agent::Pageant(c) => auth_with_agent(handle, user, c).await,
        };
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
        let listed = match agent {
            #[cfg(unix)]
            Agent::Unix(c) => list_keys(&source, c).await,
            #[cfg(windows)]
            Agent::OpenSshPipe(c) => list_keys(&source, c).await,
            #[cfg(windows)]
            Agent::Pageant(c) => list_keys(&source, c).await,
        };
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
