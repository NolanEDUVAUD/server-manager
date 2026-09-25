/// Commandes Tauri — Console SSH interactive (PTY)
use russh::ChannelMsg;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};
use uuid::Uuid;

use crate::{
    commands::{servers::get_decrypted_password, ssh::connect_ssh},
    storage::AppState,
    terminal::{validate_size, TerminalInput, TerminalState},
};

type OutputChannel = Channel<InvokeResponseBody>;

/// Envoie la fin de session au frontend (JSON), à distinguer des octets du terminal (Raw).
fn send_closed(on_event: &OutputChannel, reason: &str) {
    let payload = serde_json::json!({ "closed": reason }).to_string();
    let _ = on_event.send(InvokeResponseBody::Json(payload));
}

#[tauri::command]
pub async fn terminal_open(
    state: State<'_, AppState>,
    terminals: State<'_, TerminalState>,
    server_id: String,
    cols: u32,
    rows: u32,
    on_event: OutputChannel,
) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    let (cols, rows) = validate_size(cols, rows)?;
    let (ip, port, user, password, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        let pass = get_decrypted_password(&data, &server_id)?;
        (server.ip.clone(), server.ssh_port, server.ssh_user.clone(), pass, data.settings.network.ssh_timeout_secs)
    };

    let session = connect_ssh(&ip, port, &user, &password, timeout).await?;
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Impossible d'ouvrir un canal SSH: {}", e))?;
    channel
        .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|e| format!("Impossible d'obtenir un terminal (PTY): {}", e))?;
    channel
        .request_shell(false)
        .await
        .map_err(|e| format!("Impossible de lancer le shell: {}", e))?;

    let session_id = Uuid::new_v4().to_string();
    let (tx, rx) = unbounded_channel();
    terminals.insert(session_id.clone(), tx)?;
    log::info!("Console SSH ouverte : {}@{} ({})", user, ip, session_id);

    let table = terminals.inner().clone();
    let id = session_id.clone();
    tokio::spawn(async move {
        // `session` est déplacé ici : la connexion vit exactement aussi longtemps que la tâche
        let _session = session;
        let reason = run_session(channel, rx, &on_event).await;
        let _ = table.remove(&id);
        log::info!("Console SSH fermée : {} ({})", id, reason);
        send_closed(&on_event, &reason);
    });

    Ok(session_id)
}

/// Boucle d'une session : relaie les entrées du frontend vers le serveur et la
/// sortie du serveur vers le frontend, jusqu'à la fin de l'un des deux côtés.
async fn run_session(
    mut channel: russh::Channel<russh::client::Msg>,
    mut rx: UnboundedReceiver<TerminalInput>,
    on_event: &OutputChannel,
) -> String {
    let mut exit_code: Option<u32> = None;
    loop {
        tokio::select! {
            input = rx.recv() => match input {
                Some(TerminalInput::Data(bytes)) => {
                    if let Err(e) = channel.data(&bytes[..]).await {
                        return format!("Erreur d'envoi : {}", e);
                    }
                }
                Some(TerminalInput::Resize { cols, rows }) => {
                    let _ = channel.window_change(cols, rows, 0, 0).await;
                }
                Some(TerminalInput::Close) | None => {
                    let _ = channel.close().await;
                    return "Session fermée".into();
                }
            },
            msg = channel.wait() => match msg {
                Some(ChannelMsg::Data { ref data }) | Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                    if on_event.send(InvokeResponseBody::Raw(data.to_vec())).is_err() {
                        // Plus personne n'écoute (fenêtre rechargée) : inutile de garder la connexion
                        let _ = channel.close().await;
                        return "Frontend déconnecté".into();
                    }
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => exit_code = Some(exit_status),
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                    return match exit_code {
                        Some(code) => format!("Déconnecté (code de sortie {})", code),
                        None => "Déconnecté".into(),
                    };
                }
                _ => {}
            },
        }
    }
}

#[tauri::command]
pub async fn terminal_write(
    terminals: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    crate::crypto::ensure_unlocked()?;
    terminals.send(&session_id, TerminalInput::Data(data.into_bytes()))
}

#[tauri::command]
pub async fn terminal_resize(
    terminals: State<'_, TerminalState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    crate::crypto::ensure_unlocked()?;
    let (cols, rows) = validate_size(cols, rows)?;
    terminals.send(&session_id, TerminalInput::Resize { cols, rows })
}

#[tauri::command]
pub async fn terminal_close(terminals: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    // Idempotent : une session déjà terminée côté serveur n'est pas une erreur
    let _ = terminals.send(&session_id, TerminalInput::Close);
    Ok(())
}
