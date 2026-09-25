/// Commandes Tauri — Gestion des conteneurs Docker via SSH
use tauri::State;

use crate::{
    commands::ssh::execute_ssh,
    docker::{parse_list, validate_container_ref, DockerHost, LIST_COMMAND},
    events::{EventKind, EventLog},
    ssh_auth::{resolve_ssh, SshTarget},
    storage::AppState,
};

/// Paramètres SSH d'un serveur : (nom, cible SSH, timeout)
fn ssh_params(state: &AppState, server_id: &str) -> Result<(String, SshTarget, u64), String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    let server = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
    Ok((
        server.name.clone(),
        resolve_ssh(&data, server_id)?,
        data.settings.network.ssh_timeout_secs.min(15),
    ))
}

#[tauri::command]
pub async fn docker_list(state: State<'_, AppState>, server_id: String) -> Result<DockerHost, String> {
    let (_, target, timeout) = ssh_params(&state, &server_id)?;
    let result = execute_ssh(&target, LIST_COMMAND, timeout).await?;
    parse_list(&result.output)
}

#[tauri::command]
pub async fn docker_action(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    server_id: String,
    container: String,
    action: String,
) -> Result<(), String> {
    validate_container_ref(&container)?;
    if !matches!(action.as_str(), "start" | "stop" | "restart") {
        return Err(format!("Action Docker inconnue : {}", action));
    }
    let (name, ssh, timeout) = ssh_params(&state, &server_id)?;
    let command = format!("docker {} {}", action, container);
    let target = format!("{} ({})", container, name);
    let outcome = execute_ssh(&ssh, &command, timeout.max(30))
        .await
        .and_then(|r| if r.success { Ok(()) } else { Err(r.output) });
    match &outcome {
        Ok(()) => events.record(EventKind::Container, Some(&server_id), &target, format!("Conteneur : {}", action)),
        Err(e) => events.record(EventKind::Failure, Some(&server_id), &target, format!("Conteneur {} échoué : {}", action, e)),
    }
    outcome
}

#[tauri::command]
pub async fn docker_logs(
    state: State<'_, AppState>,
    server_id: String,
    container: String,
    tail: u32,
) -> Result<String, String> {
    validate_container_ref(&container)?;
    let (_, target, timeout) = ssh_params(&state, &server_id)?;
    let command = format!("docker logs --tail {} --timestamps {} 2>&1", tail.clamp(10, 2000), container);
    let result = execute_ssh(&target, &command, timeout).await?;
    Ok(result.output)
}
