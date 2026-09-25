/// Commandes Tauri — SSH (shutdown / reboot / commande libre)
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use russh::client;
use russh::keys::{ssh_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::io::{AsyncRead, AsyncWrite};
use crate::{
    events::{EventKind, EventLog},
    known_hosts::{self, Trust},
    models::SshResult,
    ssh_auth::{resolve_ssh, SshAuth, SshTarget},
    storage::AppState,
};

/// Vérification d'une empreinte d'hôte (« ip:port », empreinte SHA256) : le magasin
/// known_hosts de l'app, remplaçable dans les tests.
pub(crate) type HostVerifier = Arc<dyn Fn(&str, &str) -> Trust + Send + Sync>;

// ── Handler SSH : vérification de la clé d'hôte (TOFU) ────────────────────
pub(crate) struct SshHandler {
    host: String,
    verify: HostVerifier,
    /// Renseigné quand la clé est refusée, pour un message d'erreur explicite
    rejected: Arc<Mutex<Option<String>>>,
}

/// Empreinte d'une clé d'hôte telle que stockée dans known_hosts.json : SHA-256 du blob public,
/// en base64 sans remplissage ni préfixe « SHA256: » (format de russh-keys 0.44, conservé pour
/// que les empreintes déjà mémorisées restent reconnues après la montée de version de russh).
pub(crate) fn host_fingerprint(key: &ssh_key::PublicKey) -> String {
    STANDARD_NO_PAD.encode(key.fingerprint(HashAlg::Sha256).as_bytes())
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// Appelé AVANT l'authentification : refuser ici garantit qu'aucun secret (mot de passe,
    /// signature) n'est envoyé à un serveur dont la clé a changé (usurpation possible).
    /// Un certificat d'hôte est jugé sur sa clé publique, comme une clé nue.
    async fn check_server_key(&mut self, server_public_key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fingerprint = host_fingerprint(&server_public_key.public_key());
        match (self.verify)(&self.host, &fingerprint) {
            Trust::New | Trust::Match => Ok(true),
            Trust::Mismatch { expected } => {
                log::warn!("Clé d'hôte SSH modifiée pour {} : attendue {}, reçue {}", self.host, expected, fingerprint);
                if let Ok(mut slot) = self.rejected.lock() {
                    *slot = Some(fingerprint);
                }
                Ok(false)
            }
        }
    }
}

/// Session SSH authentifiée. Avec un rebond, la session du rebond porte le canal `direct-tcpip`
/// de la cible : elle est gardée ici pour vivre exactement aussi longtemps.
pub(crate) struct SshSession {
    handle: client::Handle<SshHandler>,
    _jump: Option<client::Handle<SshHandler>>,
}

impl std::ops::Deref for SshSession {
    type Target = client::Handle<SshHandler>;
    fn deref(&self) -> &Self::Target {
        &self.handle
    }
}

// ── Connexion + authentification (partagée par l'exécution et la console) ─
pub(crate) async fn connect_ssh(target: &SshTarget, timeout_secs: u64) -> Result<SshSession, String> {
    connect_with(target, timeout_secs, Arc::new(known_hosts::verify)).await
}

/// Connexion directe, ou via l'hôte de rebond : connexion au rebond, canal `direct-tcpip` vers
/// `host:port` de la cible, puis session SSH sur ce canal. La clé d'hôte de chaque saut est
/// vérifiée sous sa propre identité avant tout envoi de secret.
pub(crate) async fn connect_with(target: &SshTarget, timeout_secs: u64, verify: HostVerifier) -> Result<SshSession, String> {
    // Point de passage de toute connexion SSH, quelle que soit l'authentification
    // (y compris l'agent, qui ne déchiffre rien) : refusée tant que l'app est verrouillée
    crate::crypto::ensure_unlocked()?;
    let Some(jump) = target.jump.as_deref() else {
        let tcp = tokio::net::TcpStream::connect((target.host.as_str(), target.port));
        let handle = establish(target, timeout_secs, verify, tcp).await?;
        return Ok(SshSession { handle, _jump: None });
    };
    if jump.jump.is_some() {
        return Err("Un seul niveau de rebond est pris en charge".into());
    }
    let tcp = tokio::net::TcpStream::connect((jump.host.as_str(), jump.port));
    let jump_handle = establish(jump, timeout_secs, verify.clone(), tcp)
        .await
        .map_err(|e| format!("Hôte de rebond {}:{} — {}", jump.host, jump.port, e))?;
    let channel = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        jump_handle.channel_open_direct_tcpip(target.host.clone(), u32::from(target.port), "127.0.0.1", 0),
    )
    .await
    .map_err(|_| format!("Timeout du tunnel vers {}:{} via {}:{}", target.host, target.port, jump.host, jump.port))?
    .map_err(|e| {
        format!(
            "Connexion SSH échouée à {}:{} — le rebond {}:{} n'a pas pu l'atteindre ({})",
            target.host, target.port, jump.host, jump.port, e
        )
    })?;
    let stream = channel.into_stream();
    let handle = establish(target, timeout_secs, verify, async move { Ok(stream) }).await?;
    Ok(SshSession { handle, _jump: Some(jump_handle) })
}

/// Poignée de main SSH sur le flux fourni (TCP ou canal du rebond), puis authentification
async fn establish<S, F>(target: &SshTarget, timeout_secs: u64, verify: HostVerifier, stream: F) -> Result<client::Handle<SshHandler>, String>
where
    F: Future<Output = std::io::Result<S>>,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (host, port) = (target.host.as_str(), target.port);
    // Le timeout est géré par tokio::time::timeout ci-dessous
    let config = Arc::new(client::Config::default());
    let rejected = Arc::new(Mutex::new(None));
    let handler = SshHandler { host: format!("{}:{}", host, port), verify, rejected: rejected.clone() };

    let connect = async move {
        let stream = stream.await.map_err(russh::Error::from)?;
        client::connect_stream(config, stream, handler).await
    };
    let mut session = tokio::time::timeout(Duration::from_secs(timeout_secs), connect)
        .await
        .map_err(|_| format!("Timeout de connexion à {}:{}", host, port))?
        .map_err(|e| match rejected.lock().ok().and_then(|s| s.clone()) {
            Some(fp) => format!(
                "Clé d'hôte SSH de {}:{} MODIFIÉE (SHA256:{}) : connexion refusée, {}. \
                 Si le serveur a été réinstallé, réinitialise son empreinte dans « Serveurs » ; \
                 sinon, quelqu'un se fait peut-être passer pour lui.",
                host,
                port,
                fp,
                if matches!(target.auth, SshAuth::Password(_)) { "mot de passe non envoyé" } else { "aucun identifiant envoyé" }
            ),
            None => format!("Connexion SSH échouée à {}:{} — {}", host, port, e),
        })?;
    authenticate(&mut session, target).await?;
    Ok(session)
}

/// Hachage des signatures RSA : le meilleur annoncé par le serveur (extension server-sig-algs),
/// sinon rsa-sha2-512 comme avant la montée de version de russh.
pub(crate) async fn rsa_hash<H: client::Handler>(session: &client::Handle<H>) -> Option<HashAlg> {
    match session.best_supported_rsa_hash().await {
        Ok(Some(hash)) => hash,
        _ => Some(HashAlg::Sha512),
    }
}

async fn authenticate(session: &mut client::Handle<SshHandler>, target: &SshTarget) -> Result<(), String> {
    let (user, host) = (target.user.as_str(), target.host.as_str());
    match &target.auth {
        SshAuth::Password(password) => {
            let result = session
                .authenticate_password(user, password.as_str())
                .await
                .map_err(|e| format!("Authentification SSH échouée pour {}@{} — {}", user, host, e))?;
            if !result.success() {
                return Err(format!("Mot de passe incorrect pour {}@{}", user, host));
            }
        }
        SshAuth::Key(pem) => {
            let key = russh::keys::decode_secret_key(pem, None)
                .map_err(|_| format!("Clé SSH de l'app illisible pour {}@{}", user, host))?;
            let hash = if key.algorithm().is_rsa() { rsa_hash(session).await } else { None };
            let result = session
                .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(|e| format!("Authentification SSH échouée pour {}@{} — {}", user, host, e))?;
            if !result.success() {
                return Err(format!(
                    "Clé SSH refusée par {}@{} : déploie-la sur le serveur (« Déployer la clé »)",
                    user, host
                ));
            }
        }
        SshAuth::Agent => crate::ssh_agent::authenticate(session, user)
            .await
            .map_err(|e| format!("{} ({}@{})", e, user, host))?,
    }
    Ok(())
}

/// Exécution interactive (tâches en lot) : la commande tourne dans un pseudo-terminal,
/// ce qui fait apparaître les questions (dpkg, apt…), et `input` relaie les réponses
/// saisies dans l'app. Terminal « dumb » et large : pas de couleurs ni de barres de
/// progression, peu de retours à la ligne forcés.
pub(crate) async fn execute_ssh_interactive(
    target: &SshTarget,
    command: &str,
    timeout_secs: u64,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
    input: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<SshResult, String> {
    let session = connect_ssh(target, timeout_secs).await?;
    run_interactive(&session, command, on_chunk, input).await
}

/// Corps de `execute_ssh_interactive` sur une session ouverte
async fn run_interactive(
    session: &SshSession,
    command: &str,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
    mut input: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) -> Result<SshResult, String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Impossible d'ouvrir un canal SSH: {}", e))?;
    channel
        .request_pty(false, "dumb", 200, 50, 0, 0, &[])
        .await
        .map_err(|e| format!("Impossible d'obtenir un terminal (PTY): {}", e))?;
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Erreur d'exécution de la commande '{}': {}", command, e))?;

    let mut output = String::new();
    let mut exit_code: Option<u32> = None;
    // Quand l'app ne peut plus envoyer d'entrée, on continue d'attendre la fin de la commande
    let mut input_open = true;
    loop {
        tokio::select! {
            data = input.recv(), if input_open => match data {
                Some(bytes) => {
                    channel.data(&bytes[..]).await.map_err(|e| format!("Erreur d'envoi : {}", e))?;
                }
                None => input_open = false,
            },
            msg = channel.wait() => match msg {
                Some(russh::ChannelMsg::Data { ref data }) | Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                    // Le PTY termine les lignes par \r\n : on garde des \n simples
                    let chunk = String::from_utf8_lossy(data).replace("\r\n", "\n");
                    on_chunk(&chunk);
                    output.push_str(&chunk);
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                None => break,
                _ => {}
            },
        }
    }

    let success = exit_code.is_none_or(|c| c == 0);
    Ok(SshResult {
        success,
        output: output.trim().to_string(),
        error: if success { None } else { Some(format!("Code de sortie: {}", exit_code.unwrap_or(1))) },
    })
}

// ── Fonction interne d'exécution SSH ──────────────────────────────────────
pub(crate) async fn execute_ssh(target: &SshTarget, command: &str, timeout_secs: u64) -> Result<SshResult, String> {
    execute_ssh_stream(target, command, timeout_secs, &|_| {}).await
}

/// Comme execute_ssh, en transmettant chaque morceau de sortie dès sa réception
/// (tâches en lot, playbooks Ansible : on voit la progression en direct).
pub(crate) async fn execute_ssh_stream(
    target: &SshTarget,
    command: &str,
    timeout_secs: u64,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<SshResult, String> {
    let session = connect_ssh(target, timeout_secs).await?;
    run_command(&session, command, on_chunk).await
}

/// Exécute une commande sur une session ouverte et attend la fin du canal
pub(crate) async fn run_command(
    session: &SshSession,
    command: &str,
    on_chunk: &(dyn Fn(&str) + Send + Sync),
) -> Result<SshResult, String> {
    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Impossible d'ouvrir un canal SSH: {}", e))?;

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Erreur d'exécution de la commande '{}': {}", command, e))?;

    let mut output = String::new();
    let mut exit_code: Option<u32> = None;

    loop {
        match channel.wait().await {
            Some(russh::ChannelMsg::Data { ref data }) | Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                let chunk = String::from_utf8_lossy(data);
                on_chunk(&chunk);
                output.push_str(&chunk);
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            None => break,
            _ => {}
        }
    }

    let success = exit_code.is_none_or(|c| c == 0);
    Ok(SshResult {
        success,
        output: output.trim().to_string(),
        error: if success {
            None
        } else {
            Some(format!("Code de sortie: {}", exit_code.unwrap_or(1)))
        },
    })
}

/// Journalise le résultat d'une demande d'arrêt / de redémarrage.
fn record_power(events: &EventLog, kind: EventKind, server_id: &str, name: &str, result: &Result<SshResult, String>) {
    let action = if kind == EventKind::Reboot { "Redémarrage" } else { "Arrêt" };
    match result {
        Ok(r) if r.success => events.record(kind, Some(server_id), name, format!("{} demandé", action)),
        Ok(r) => events.record(
            EventKind::Failure,
            Some(server_id),
            name,
            format!("{} échoué : {}", action, r.error.clone().unwrap_or_else(|| r.output.clone())),
        ),
        Err(e) => events.record(EventKind::Failure, Some(server_id), name, format!("{} échoué : {}", action, e)),
    }
}

/// Cible SSH d'un serveur et une valeur lue sous le même verrou (commande, timeout…)
fn target_and<T>(
    state: &AppState,
    server_id: &str,
    pick: impl FnOnce(&crate::models::AppData, &crate::models::Server) -> T,
) -> Result<(SshTarget, T), String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let server = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
    let extra = pick(&data, server);
    Ok((resolve_ssh(&data, server_id)?, extra))
}

// ── Shutdown d'un serveur ─────────────────────────────────────────────────
#[tauri::command]
pub async fn ssh_shutdown(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    server_id: String,
) -> Result<SshResult, String> {
    crate::crypto::ensure_unlocked()?;
    let (target, (name, command, timeout)) = target_and(&state, &server_id, |data, s| {
        (s.name.clone(), s.shutdown_command.clone(), data.settings.network.ssh_timeout_secs)
    })?;

    log::info!("Shutdown SSH de {}:{} — commande: {}", target.host, target.port, command);
    let result = execute_ssh(&target, &command, timeout).await;
    record_power(&events, EventKind::Shutdown, &server_id, &name, &result);
    result
}

// ── Reboot d'un serveur ───────────────────────────────────────────────────
#[tauri::command]
pub async fn ssh_reboot(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    server_id: String,
) -> Result<SshResult, String> {
    crate::crypto::ensure_unlocked()?;
    let (target, (name, command, timeout)) = target_and(&state, &server_id, |data, s| {
        (s.name.clone(), s.reboot_command.clone(), data.settings.network.ssh_timeout_secs)
    })?;

    log::info!("Reboot SSH de {}:{} — commande: {}", target.host, target.port, command);
    let result = execute_ssh(&target, &command, timeout).await;
    record_power(&events, EventKind::Reboot, &server_id, &name, &result);
    result
}

// ── Exécuter une commande libre sur un serveur ────────────────────────────
#[tauri::command]
pub async fn ssh_execute(
    state: State<'_, AppState>,
    server_id: String,
    command: String,
) -> Result<SshResult, String> {
    crate::crypto::ensure_unlocked()?;
    let (target, timeout) = target_and(&state, &server_id, |data, _| data.settings.network.ssh_timeout_secs)?;

    log::info!("Commande SSH sur {}:{} — {}", target.host, target.port, command);
    execute_ssh(&target, &command, timeout).await
}

// ── Shutdown de tout un groupe ────────────────────────────────────────────
#[tauri::command]
pub async fn ssh_shutdown_group(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    group_id: String,
) -> Result<Vec<(String, SshResult)>, String> {
    crate::crypto::ensure_unlocked()?;
    let servers_info = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let group = data
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or_else(|| format!("Groupe introuvable: {}", group_id))?;

        let mut list = Vec::new();
        for sid in &group.server_ids {
            if let Some(server) = data.servers.iter().find(|s| &s.id == sid) {
                list.push((
                    sid.clone(),
                    server.name.clone(),
                    resolve_ssh(&data, sid),
                    server.shutdown_command.clone(),
                    data.settings.network.ssh_timeout_secs,
                ));
            }
        }
        list
    };

    let mut results = Vec::new();
    for (sid, name, target, command, timeout) in servers_info {
        let result = match target {
            Ok(target) => execute_ssh(&target, &command, timeout).await,
            Err(e) => Err(e),
        };
        record_power(&events, EventKind::Shutdown, &sid, &name, &result);
        match result {
            Ok(r) => results.push((name, r)),
            Err(e) => results.push((
                name.clone(),
                SshResult {
                    success: false,
                    output: String::new(),
                    error: Some(e),
                },
            )),
        }
    }

    Ok(results)
}

// ── Oublier l'empreinte SSH d'un serveur (réinstallation volontaire) ──────
#[tauri::command]
pub fn forget_host_key(state: State<AppState>, server_id: String) -> Result<bool, String> {
    let host = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        format!("{}:{}", server.ip, server.ssh_port)
    };
    log::info!("Empreinte SSH oubliée pour {}", host);
    known_hosts::forget(&host)
}

/// Bout en bout contre un serveur SSH russh lancé dans le test (aucune connexion réelle)
#[cfg(test)]
mod tests {
    use super::*;
    use crate::known_hosts::KnownHosts;
    use crate::ssh_test_server::{self, TestServer};
    use zeroize::Zeroizing;

    /// Les empreintes déjà mémorisées dans known_hosts.json (calculées par russh-keys 0.44,
    /// `PublicKey::fingerprint`) doivent rester identiques après la montée de version de russh :
    /// sinon toutes les clés d'hôte apparaîtraient « modifiées ». Vecteurs calculés avec
    /// russh-keys 0.44 (et identiques à `ssh-keygen -lf`) sur des clés jetables.
    #[test]
    fn host_fingerprints_keep_the_known_hosts_format() {
        let vectors = [
            (
                "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINyZ/zNwOTfLWmcIMcF+KduFtD15EK79/Oe+W4J4celh test-ed25519",
                "5VcXuMgO5lfGahfbeN3jEY/1u6db1kY1QuQu0hmTbxI",
            ),
            (
                "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0g8/TZwTxbzXWNxuzuWNDfD14Sg9umVru3GfTCYptA+9DYUMpLhQx0qMjQ0dh4dmCz54TOgtnZMO+0quCQfUf43bD7a8oRoiAvdoWfQzWPYDFiQ5tTnE591wzhTfh7Tf4zZLX6eWi9nIexcak1PXrTu1WNCkXxeoWVKHuV94h4zUdRpSNIf1nAmXj3HnJHrYust4cdNsCHV0TKQ4hTB3PlAuTxUx5LSRaX+9+EGa9T/FPO19QzXZVWKtvq/G18zaN4J9lgpcsf9SRcb2HXIeqOUk4N2+IfthRl7RLLXucBhiqUxviIRnlzMoidNtnHy0Bepx0bc8j434qwYGDpmVB test-rsa",
                "EIP0EBiKiSedo5jJAZgoszMJ//m5BaPBqjd3aL5NHYQ",
            ),
            (
                "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBN6+vrYiBly+Fz24YbWi9taZIGDwUjZBUjoiuC2/hbIynmOHNFmIM6C18N8qSKadPAC+2TOLkb1Dh1yRR6fccmo= test-ecdsa",
                "HTtUEN3Elodud44Vmcev0+sHUaFvRwK8IDexmSMVdtY",
            ),
        ];
        for (line, expected) in vectors {
            let key = ssh_key::PublicKey::from_openssh(line).unwrap();
            assert_eq!(host_fingerprint(&key), expected, "{}", line);
            // Même clé présentée dans un certificat d'hôte : même empreinte
            assert_eq!(host_fingerprint(&PublicKeyOrCertificate::from(key).public_key()), expected);
        }
    }

    /// Magasin known_hosts en mémoire qui retient les hôtes vérifiés
    fn recording_verifier() -> (HostVerifier, Arc<Mutex<Vec<String>>>) {
        let store = Arc::new(Mutex::new(KnownHosts::default()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let verify: HostVerifier = Arc::new(move |host, fp| {
            s.lock().unwrap().push(format!("{}={}", host, fp));
            store.lock().unwrap().check(host, fp)
        });
        (verify, seen)
    }

    fn target(server: &TestServer, auth: SshAuth) -> SshTarget {
        SshTarget { host: "127.0.0.1".into(), port: server.port, user: "admin".into(), auth, jump: None }
    }

    fn key_pem() -> (Zeroizing<String>, ssh_key::PublicKey) {
        let prepared = crate::ssh_keys::prepare(crate::ssh_keys::generate_ed25519("test").unwrap()).unwrap();
        let public = russh::keys::decode_secret_key(&prepared.pem, None).unwrap().public_key().clone();
        (prepared.pem, public)
    }

    /// Tâches en lot interactives : PTY, question du serveur, réponse saisie dans l'app
    #[tokio::test]
    async fn interactive_batch_answers_questions_through_the_pty() {
        let server = ssh_test_server::start(Some("pw"), vec![]).await;
        let (verify, _) = recording_verifier();
        let session = connect_with(&target(&server, SshAuth::Password(Zeroizing::new("pw".into()))), 5, verify).await.unwrap();
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let answer = tx.clone();
        let on_chunk = move |c: &str| {
            if c.contains("Continuer ?") {
                let _ = answer.send(b"N\n".to_vec());
            }
        };
        let r = run_interactive(&session, "question", &on_chunk, rx).await.unwrap();
        drop(tx);
        assert!(r.success);
        assert!(r.output.contains("réponse: N") && !r.output.contains('\r'), "{:?}", r.output);
        assert!(server.log().contains(&"pty:dumb:200x50".to_string()));
    }

    #[tokio::test]
    async fn rsa_key_auth_signs_with_sha2() {
        let key = crate::ssh_keys::tests::rsa();
        let public = key.public_key().clone();
        let pem = crate::ssh_keys::prepare(key).unwrap().pem;
        let server = ssh_test_server::start(None, vec![public]).await;
        let (verify, _) = recording_verifier();
        assert!(run(&target(&server, SshAuth::Key(pem)), verify).await.unwrap().success);
    }

    async fn run(target: &SshTarget, verify: HostVerifier) -> Result<SshResult, String> {
        let session = connect_with(target, 5, verify).await?;
        run_command(&session, "uptime", &|_| {}).await
    }

    #[tokio::test]
    async fn password_auth_behaves_as_before() {
        let server = ssh_test_server::start(Some("s3cret"), vec![]).await;
        let (verify, _) = recording_verifier();
        let ok = run(&target(&server, SshAuth::Password(Zeroizing::new("s3cret".into()))), verify.clone()).await.unwrap();
        assert!(ok.success);
        assert_eq!(ok.output, "ran: uptime");
        let err = run(&target(&server, SshAuth::Password(Zeroizing::new("faux".into()))), verify).await.unwrap_err();
        assert_eq!(err, "Mot de passe incorrect pour admin@127.0.0.1");
    }

    #[tokio::test]
    async fn key_auth_accepts_the_deployed_key_only() {
        let (pem, public) = key_pem();
        let (other_pem, _) = key_pem();
        let server = ssh_test_server::start(None, vec![public]).await;
        let (verify, _) = recording_verifier();
        assert!(run(&target(&server, SshAuth::Key(pem)), verify.clone()).await.unwrap().success);
        let err = run(&target(&server, SshAuth::Key(other_pem)), verify).await.unwrap_err();
        assert!(err.contains("Clé SSH refusée par admin@127.0.0.1"), "{}", err);
        assert!(server.log().contains(&"publickey:admin".to_string()));
    }

    #[tokio::test]
    async fn jump_host_tunnels_and_verifies_each_hop() {
        let (pem, public) = key_pem();
        let jump = ssh_test_server::start(Some("rebond"), vec![]).await;
        let dest = ssh_test_server::start(None, vec![public]).await;
        let mut t = target(&dest, SshAuth::Key(pem));
        t.jump = Some(Box::new(target(&jump, SshAuth::Password(Zeroizing::new("rebond".into())))));

        let (verify, seen) = recording_verifier();
        let r = run(&t, verify.clone()).await.unwrap();
        assert_eq!(r.output, "ran: uptime");
        // TOFU sur les deux sauts, chacun sous sa propre identité ip:port
        let seen = seen.lock().unwrap().clone();
        assert_eq!(seen, vec![
            format!("127.0.0.1:{}={}", jump.port, jump.fingerprint),
            format!("127.0.0.1:{}={}", dest.port, dest.fingerprint),
        ]);
        assert!(jump.log().contains(&format!("direct-tcpip:127.0.0.1:{}", dest.port)));

        // Clé d'hôte de la cible changée : refus, même à travers le tunnel
        let store = Arc::new(Mutex::new(KnownHosts::default()));
        store.lock().unwrap().check(&format!("127.0.0.1:{}", dest.port), "AUTRE-EMPREINTE");
        let pinned: HostVerifier = Arc::new(move |h, fp| store.lock().unwrap().check(h, fp));
        let err = run(&t, pinned).await.unwrap_err();
        assert!(err.contains("MODIFIÉE") && err.contains("aucun identifiant envoyé"), "{}", err);
        assert!(err.contains(&format!("127.0.0.1:{}", dest.port)), "{}", err);

        // Rebond injoignable : l'erreur le nomme
        let mut dead = t.clone();
        dead.jump = Some(Box::new(SshTarget { port: 1, ..target(&jump, SshAuth::Agent) }));
        let err = run(&dead, verify).await.unwrap_err();
        assert!(err.starts_with("Hôte de rebond 127.0.0.1:1"), "{}", err);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn agent_auth_uses_ssh_auth_sock() {
        let key = crate::ssh_keys::generate_ed25519("agent-test").unwrap();
        let public = key.public_key().clone();
        let socket = ssh_test_server::start_agent(&key).await;
        // Seul test à toucher SSH_AUTH_SOCK
        std::env::set_var("SSH_AUTH_SOCK", &socket);
        let status = crate::ssh_agent::status().await;
        assert!(status.available, "{:?}", status);
        assert_eq!(status.keys.len(), 1);
        assert_eq!(status.keys[0].fingerprint, public.fingerprint(HashAlg::Sha256).to_string());
        assert_eq!(status.keys[0].algorithm, "ssh-ed25519");

        let server = ssh_test_server::start(None, vec![public]).await;
        let (verify, _) = recording_verifier();
        assert!(run(&target(&server, SshAuth::Agent), verify.clone()).await.unwrap().success);
        // Agent sans la bonne clé : refus explicite
        let other = ssh_test_server::start(None, vec![]).await;
        let err = run(&target(&other, SshAuth::Agent), verify).await.unwrap_err();
        assert!(err.contains("aucune clé acceptée"), "{}", err);
        let _ = std::fs::remove_file(&socket);
    }
}
