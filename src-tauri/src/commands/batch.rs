/// Commandes Tauri — Tâches en lot et Ansible
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    batch::{self, list_playbooks_command, playbook_command, wrap_script, AnsibleConfig, BatchInputs, BatchMode, BatchTask, SshTarget},
    commands::{servers::get_decrypted_password, ssh::execute_ssh},
    events::{EventKind, EventLog},
    models::AppData,
    storage::AppState,
};

fn targets(data: &AppData, ids: &[String]) -> Result<Vec<SshTarget>, String> {
    ids.iter()
        .map(|id| {
            let s = data.servers.iter().find(|s| &s.id == id).ok_or_else(|| format!("Serveur introuvable : {}", id))?;
            Ok(SshTarget {
                server_id: s.id.clone(),
                name: s.name.clone(),
                ip: s.ip.clone(),
                port: s.ssh_port,
                user: s.ssh_user.clone(),
                password: get_decrypted_password(data, id)?,
            })
        })
        .collect()
}

fn spawn_run(app: &AppHandle, inputs: &BatchInputs, targets: Vec<SshTarget>, command: String, mode: BatchMode, stop_on_error: bool) -> String {
    let run_id = Uuid::new_v4().to_string();
    let emitter = app.clone();
    let emit: batch::Emit = Arc::new(move |u| {
        let _ = emitter.emit("batch-update", &u);
    });
    tauri::async_runtime::spawn(batch::run(run_id.clone(), targets, command, mode, stop_on_error, emit, inputs.clone()));
    run_id
}

#[tauri::command]
pub fn get_batch_tasks(state: State<AppState>) -> Result<Vec<BatchTask>, String> {
    Ok(state.data.lock().map_err(|e| e.to_string())?.batch_tasks.clone())
}

#[tauri::command]
pub fn save_batch_task(state: State<AppState>, mut task: BatchTask) -> Result<BatchTask, String> {
    if task.name.trim().is_empty() || task.script.trim().is_empty() {
        return Err("Nom et script requis".into());
    }
    {
        let mut data = state.data.lock().map_err(|e| e.to_string())?;
        match data.batch_tasks.iter_mut().find(|t| t.id == task.id && !task.id.is_empty()) {
            Some(existing) => *existing = task.clone(),
            None => {
                task.id = Uuid::new_v4().to_string();
                data.batch_tasks.push(task.clone());
            }
        }
    }
    state.save()?;
    Ok(task)
}

#[tauri::command]
pub fn delete_batch_task(state: State<AppState>, id: String) -> Result<(), String> {
    state.data.lock().map_err(|e| e.to_string())?.batch_tasks.retain(|t| t.id != id);
    state.save()
}

/// Lance un script sur des serveurs ; la progression arrive par l'événement « batch-update »
#[tauri::command]
pub fn run_batch(
    app: AppHandle,
    state: State<AppState>,
    events: State<EventLog>,
    inputs: State<BatchInputs>,
    script: String,
    server_ids: Vec<String>,
    mode: BatchMode,
    stop_on_error: bool,
) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    if script.trim().is_empty() || server_ids.is_empty() {
        return Err("Script et serveurs requis".into());
    }
    let t = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        targets(&data, &server_ids)?
    };
    let names: Vec<String> = t.iter().map(|x| x.name.clone()).collect();
    let first_line = script.lines().next().unwrap_or("").chars().take(80).collect::<String>();
    events.record(EventKind::VmAction, None, "Tâche en lot", format!("« {} » sur {}", first_line, names.join(", ")));
    Ok(spawn_run(&app, &inputs, t, wrap_script(&script), mode, stop_on_error))
}

/// Réponse saisie pendant une exécution (ex. « N » à une question de dpkg)
#[tauri::command]
pub fn batch_send_input(inputs: State<BatchInputs>, run_id: String, server_id: String, text: String) -> Result<(), String> {
    crate::crypto::ensure_unlocked()?;
    if text.len() > 4096 {
        return Err("Saisie trop longue".into());
    }
    inputs.send(&run_id, &server_id, text.into_bytes())
}

#[tauri::command]
pub fn get_ansible_config(state: State<AppState>) -> Result<Option<AnsibleConfig>, String> {
    Ok(state.data.lock().map_err(|e| e.to_string())?.ansible.clone())
}

#[tauri::command]
pub fn save_ansible_config(state: State<AppState>, config: AnsibleConfig) -> Result<(), String> {
    if config.dir.trim().is_empty() {
        return Err("Dossier des playbooks requis".into());
    }
    state.data.lock().map_err(|e| e.to_string())?.ansible = Some(config);
    state.save()
}

fn ansible_target(data: &AppData) -> Result<(SshTarget, String), String> {
    let cfg = data.ansible.clone().ok_or("Hôte Ansible non configuré")?;
    let t = targets(data, &[cfg.server_id])?.remove(0);
    Ok((t, cfg.dir))
}

/// Liste des playbooks (lecture seule : find)
#[tauri::command]
pub async fn ansible_list_playbooks(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let (t, dir) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        ansible_target(&data)?
    };
    let r = execute_ssh(&t.ip, t.port, &t.user, &t.password, &list_playbooks_command(&dir), 15).await?;
    Ok(r.output.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect())
}

/// Lance un playbook ; `check` = simulation (--check --diff), sortie en direct via « batch-update »
#[tauri::command]
pub fn ansible_run(
    app: AppHandle,
    state: State<AppState>,
    events: State<EventLog>,
    inputs: State<BatchInputs>,
    playbook: String,
    check: bool,
    limit: Option<String>,
) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    let (t, dir) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        ansible_target(&data)?
    };
    let command = playbook_command(&dir, &playbook, check, limit.as_deref())?;
    events.record(
        EventKind::VmAction,
        None,
        "Ansible",
        format!("{} {}{}", if check { "Simulation de" } else { "Exécution de" }, playbook, limit.map(|l| format!(" (limite : {})", l)).unwrap_or_default()),
    );
    Ok(spawn_run(&app, &inputs, vec![t], command, BatchMode::Sequential, false))
}

#[cfg(test)]
mod live {
    /// Lecture seule : `hostname; uptime` sur deux serveurs, avec le moteur réel.
    /// cargo test live_batch -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_batch() {
        let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.homelab.server-manager");
        let data = crate::storage::load_app_data(&dir.join("data.json"));
        crate::crypto::set_master_key(crate::keystore::load_or_create_master_key().unwrap());
        crate::known_hosts::init(dir.join("known_hosts.json"));
        let ids: Vec<String> = data.servers.iter().filter(|s| ["minipc", "FwNode"].contains(&s.name.as_str())).map(|s| s.id.clone()).collect();
        let targets = super::targets(&data, &ids).unwrap();
        let emit: crate::batch::Emit = std::sync::Arc::new(|u| println!("{:?}", u));
        crate::batch::run("live".into(), targets, crate::batch::wrap_script("hostname\nuptime"), crate::batch::BatchMode::Parallel, false, emit, crate::batch::BatchInputs::default()).await;
    }
}
