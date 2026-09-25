/// Commandes Tauri — SSH (shutdown / reboot / commande libre)
use async_trait::async_trait;
use russh::client;
use russh_keys::key::PublicKey;
use std::sync::Arc;
use tauri::State;
use crate::{
    commands::servers::get_decrypted_password,
    events::{EventKind, EventLog},
    known_hosts::{self, Trust},
    models::SshResult,
    storage::AppState,
};

// ── Handler SSH : vérification de la clé d'hôte (TOFU) ────────────────────
pub(crate) struct SshHandler {
    host: String,
    /// Renseigné quand la clé est refusée, pour un message d'erreur explicite
    rejected: Arc<std::sync::Mutex<Option<String>>>,
}

#[async_trait]
impl client::Handler for SshHandler {
    type Error = russh::Error;

    /// Appelé AVANT l'authentification : refuser ici garantit que le mot de passe
    /// n'est jamais envoyé à un serveur dont la clé a changé (usurpation possible).
    async fn check_server_key(&mut self, server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        match known_hosts::verify(&self.host, &fingerprint) {
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

// ── Connexion + authentification (partagée par l'exécution et la console) ─
pub(crate) async fn connect_ssh(
    ip: &str,
    port: u16,
    user: &str,
    password: &str,
    timeout_secs: u64,
) -> Result<client::Handle<SshHandler>, String> {
    // Le timeout est géré par tokio::time::timeout ci-dessous
    let config = Arc::new(client::Config::default());

    let rejected = Arc::new(std::sync::Mutex::new(None));
    let handler = SshHandler { host: format!("{}:{}", ip, port), rejected: rejected.clone() };

    let mut session = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        client::connect(config, (ip, port), handler),
    )
    .await
    .map_err(|_| format!("Timeout de connexion à {}:{}", ip, port))?
    .map_err(|e| {
        match rejected.lock().ok().and_then(|s| s.clone()) {
            Some(fp) => format!(
                "Clé d'hôte SSH de {}:{} MODIFIÉE (SHA256:{}) : connexion refusée, mot de passe non envoyé. \
                 Si le serveur a été réinstallé, réinitialise son empreinte dans « Serveurs » ; \
                 sinon, quelqu'un se fait peut-être passer pour lui.",
                ip, port, fp
            ),
            None => format!("Connexion SSH échouée à {}:{} — {}", ip, port, e),
        }
    })?;

    let authenticated = session
        .authenticate_password(user, password)
        .await
        .map_err(|e| format!("Authentification SSH échouée pour {}@{} — {}", user, ip, e))?;

    if !authenticated {
        return Err(format!("Mot de passe incorrect pour {}@{}", user, ip));
    }
    Ok(session)
}

// ── Fonction interne d'exécution SSH ──────────────────────────────────────
pub(crate) async fn execute_ssh(
    ip: &str,
    port: u16,
    user: &str,
    password: &str,
    command: &str,
    timeout_secs: u64,
) -> Result<SshResult, String> {
    let session = connect_ssh(ip, port, user, password, timeout_secs).await?;

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
            Some(russh::ChannelMsg::Data { ref data }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                output.push_str(&String::from_utf8_lossy(data));
            }
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                exit_code = Some(exit_status);
            }
            None => break,
            _ => {}
        }
    }

    let success = exit_code.map_or(true, |c| c == 0);
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

// ── Shutdown d'un serveur ─────────────────────────────────────────────────
#[tauri::command]
pub async fn ssh_shutdown(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    server_id: String,
) -> Result<SshResult, String> {
    let (name, ip, port, user, password, command, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        let pass = get_decrypted_password(&data, &server_id)?;
        (
            server.name.clone(),
            server.ip.clone(),
            server.ssh_port,
            server.ssh_user.clone(),
            pass,
            server.shutdown_command.clone(),
            data.settings.network.ssh_timeout_secs,
        )
    };

    log::info!("Shutdown SSH de {}:{} — commande: {}", ip, port, command);
    let result = execute_ssh(&ip, port, &user, &password, &command, timeout).await;
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
    let (name, ip, port, user, password, command, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        let pass = get_decrypted_password(&data, &server_id)?;
        (
            server.name.clone(),
            server.ip.clone(),
            server.ssh_port,
            server.ssh_user.clone(),
            pass,
            server.reboot_command.clone(),
            data.settings.network.ssh_timeout_secs,
        )
    };

    log::info!("Reboot SSH de {}:{} — commande: {}", ip, port, command);
    let result = execute_ssh(&ip, port, &user, &password, &command, timeout).await;
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
    let (ip, port, user, password, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        let pass = get_decrypted_password(&data, &server_id)?;
        (
            server.ip.clone(),
            server.ssh_port,
            server.ssh_user.clone(),
            pass,
            data.settings.network.ssh_timeout_secs,
        )
    };

    log::info!("Commande SSH sur {}:{} — {}", ip, port, command);
    execute_ssh(&ip, port, &user, &password, &command, timeout).await
}

// ── Shutdown de tout un groupe ────────────────────────────────────────────
#[tauri::command]
pub async fn ssh_shutdown_group(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    group_id: String,
) -> Result<Vec<(String, SshResult)>, String> {
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
                if let Ok(pass) = get_decrypted_password(&data, sid) {
                    list.push((
                        sid.clone(),
                        server.name.clone(),
                        server.ip.clone(),
                        server.ssh_port,
                        server.ssh_user.clone(),
                        pass,
                        server.shutdown_command.clone(),
                        data.settings.network.ssh_timeout_secs,
                    ));
                }
            }
        }
        list
    };

    let mut results = Vec::new();
    for (sid, name, ip, port, user, password, command, timeout) in servers_info {
        let result = execute_ssh(&ip, port, &user, &password, &command, timeout).await;
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
