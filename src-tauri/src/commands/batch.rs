/// Commandes Tauri — Tâches en lot et Ansible
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::{
    batch::{self, list_playbooks_command, playbook_command, wrap_script, AnsibleConfig, BatchInputs, BatchMode, BatchTask, BatchTarget, SmartTarget},
    commands::ssh::execute_ssh,
    events::{EventKind, EventLog},
    models::{AppData, OsType},
    smart_batch::{self, expand_template, posix_probe_command, resolve_action, windows_probe_command, DetectedOs, OsCache, PkgFamily, SmartAction},
    ssh_auth::resolve_ssh,
    storage::AppState,
};

fn targets(data: &AppData, ids: &[String]) -> Result<Vec<BatchTarget>, String> {
    ids.iter()
        .map(|id| {
            let s = data.servers.iter().find(|s| &s.id == id).ok_or_else(|| format!("Serveur introuvable : {}", id))?;
            Ok(BatchTarget { server_id: s.id.clone(), name: s.name.clone(), ssh: resolve_ssh(data, id)? })
        })
        .collect()
}

fn spawn_run(app: &AppHandle, inputs: &BatchInputs, targets: Vec<BatchTarget>, command: String, mode: BatchMode, stop_on_error: bool) -> String {
    let run_id = Uuid::new_v4().to_string();
    let emitter = app.clone();
    let emit: batch::Emit = Arc::new(move |u| {
        let _ = emitter.emit("batch-update", &u);
    });
    tauri::async_runtime::spawn(batch::run(run_id.clone(), targets, command, mode, stop_on_error, emit, inputs.clone()));
    run_id
}

// ── Lot intelligent (F2) : détection de l'OS et résolution des actions ────

/// Détecte l'OS d'une cible par SSH (avec cache), à partir de la commande adaptée à son
/// `os_type` enregistré (Windows : PowerShell/`cmd /c ver` ; sinon : `/etc/os-release`/`uname`).
async fn detect_os(target: &BatchTarget, os_type: OsType, cache: &OsCache, force: bool) -> Result<DetectedOs, String> {
    if !force {
        if let Some(os) = cache.get(&target.server_id) {
            return Ok(os);
        }
    }
    let (probe, parse): (&str, fn(&str) -> Option<DetectedOs>) = if os_type == OsType::Windows {
        (windows_probe_command(), smart_batch::parse_windows_probe)
    } else {
        (posix_probe_command(), smart_batch::parse_posix_probe)
    };
    let result = execute_ssh(&target.ssh, probe, 15).await?;
    let os = parse(&result.output)
        .ok_or_else(|| format!("Détection de l'OS impossible pour {} : réponse inattendue à « {} »", target.name, probe))?;
    cache.set(&target.server_id, os.clone());
    Ok(os)
}

/// `os_type` de chaque serveur d'une liste, dans l'ordre (celui par défaut si le serveur a disparu
/// entre-temps : `targets()` aurait de toute façon déjà signalé l'absence)
fn os_types_of(data: &AppData, ids: &[String]) -> Vec<OsType> {
    ids.iter().map(|id| data.servers.iter().find(|s| &s.id == id).map(|s| s.os_type.clone()).unwrap_or_default()).collect()
}

/// OS détecté d'une cible, pour l'affichage dans l'interface (ex. « Debian 12 »)
#[derive(Debug, Clone, Serialize)]
pub struct TargetOsView {
    pub server_id: String,
    pub name: String,
    pub label: Option<String>,
    pub error: Option<String>,
}

/// Détecte l'OS de chaque serveur donné (en parallèle), avec mise en cache (10 min)
#[tauri::command]
pub async fn smart_batch_detect_os(
    state: State<'_, AppState>,
    cache: State<'_, OsCache>,
    server_ids: Vec<String>,
    force: bool,
) -> Result<Vec<TargetOsView>, String> {
    crate::crypto::ensure_unlocked()?;
    let (t, os_types) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        (targets(&data, &server_ids)?, os_types_of(&data, &server_ids))
    };
    let futures = t.iter().zip(os_types).map(|(target, os_type)| {
        let cache = cache.inner().clone();
        async move {
            match detect_os(target, os_type, &cache, force).await {
                Ok(os) => TargetOsView { server_id: target.server_id.clone(), name: target.name.clone(), label: Some(os.pretty_name), error: None },
                Err(e) => TargetOsView { server_id: target.server_id.clone(), name: target.name.clone(), label: None, error: Some(e) },
            }
        }
    });
    Ok(futures::future::join_all(futures).await)
}

/// Ce qui doit être exécuté : une action portable (résolue par OS) ou un script avec variables
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum SmartSource {
    Action(SmartAction),
    Script(String),
}

/// Commande résolue pour une cible, prête à être montrée avant confirmation (ou l'erreur qui
/// fait ignorer la cible : OS inconnu, variable de gabarit invalide…)
#[derive(Debug, Clone, Serialize)]
pub struct SmartPreview {
    pub server_id: String,
    pub name: String,
    pub os_label: Option<String>,
    pub command: Option<String>,
    pub skip_reason: Option<String>,
}

fn resolve_source(source: &SmartSource, os: &DetectedOs) -> Result<String, String> {
    match source {
        SmartSource::Action(action) => resolve_action(action, os),
        SmartSource::Script(script) => expand_template(script, os),
    }
}

/// Bash sous Unix (et macOS), mais pas sous Windows (pas de `bash` par défaut : la commande
/// résolue est déjà du PowerShell/`cmd`, à exécuter telle quelle)
fn finalize_command(resolved: &str, os: &DetectedOs) -> String {
    match os.family {
        PkgFamily::Winget | PkgFamily::Choco => resolved.to_string(),
        _ => wrap_script(resolved),
    }
}

/// Résout la commande de chaque cible pour l'aperçu affiché avant confirmation
#[tauri::command]
pub async fn smart_batch_preview(
    state: State<'_, AppState>,
    cache: State<'_, OsCache>,
    server_ids: Vec<String>,
    source: SmartSource,
) -> Result<Vec<SmartPreview>, String> {
    crate::crypto::ensure_unlocked()?;
    let (t, os_types) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        (targets(&data, &server_ids)?, os_types_of(&data, &server_ids))
    };
    let futures = t.into_iter().zip(os_types).map(|(target, os_type)| {
        let source = source.clone();
        let cache = cache.inner().clone();
        async move {
            match detect_os(&target, os_type, &cache, false).await {
                Ok(os) => match resolve_source(&source, &os) {
                    Ok(command) => SmartPreview {
                        server_id: target.server_id,
                        name: target.name,
                        command: Some(finalize_command(&command, &os)),
                        os_label: Some(os.pretty_name),
                        skip_reason: None,
                    },
                    Err(e) => SmartPreview { server_id: target.server_id, name: target.name, os_label: Some(os.pretty_name), command: None, skip_reason: Some(e) },
                },
                Err(e) => SmartPreview { server_id: target.server_id, name: target.name, os_label: None, command: None, skip_reason: Some(e) },
            }
        }
    });
    Ok(futures::future::join_all(futures).await)
}

/// Lance une action intelligente ou un script à variables : détecte (ou relit du cache) l'OS de
/// chaque cible, résout sa commande, ignore celles dont l'OS n'a pas pu être déterminé ou
/// reconnu, puis exécute le reste via le moteur de lot habituel (réponses interactives comprises).
#[tauri::command]
pub fn smart_batch_run(
    app: AppHandle,
    state: State<AppState>,
    cache: State<OsCache>,
    events: State<EventLog>,
    inputs: State<BatchInputs>,
    server_ids: Vec<String>,
    source: SmartSource,
    mode: BatchMode,
    stop_on_error: bool,
) -> Result<String, String> {
    crate::crypto::ensure_unlocked()?;
    if server_ids.is_empty() {
        return Err("Serveurs requis".into());
    }
    let (t, os_types) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        (targets(&data, &server_ids)?, os_types_of(&data, &server_ids))
    };

    let run_id = Uuid::new_v4().to_string();
    let emitter = app.clone();
    let emit: batch::Emit = Arc::new(move |u| {
        let _ = emitter.emit("batch-update", &u);
    });
    let cache = cache.inner().clone();
    let names: Vec<String> = t.iter().map(|x| x.name.clone()).collect();
    let label = match &source {
        SmartSource::Action(a) => format!("action intelligente {:?}", a),
        SmartSource::Script(s) => format!("script « {} »", s.lines().next().unwrap_or("").chars().take(80).collect::<String>()),
    };
    events.record(EventKind::VmAction, None, "Tâche en lot intelligente", format!("{} sur {}", label, names.join(", ")));
    let inputs = inputs.inner().clone();
    let task_run_id = run_id.clone();

    tauri::async_runtime::spawn(async move {
        let run_id = task_run_id;
        let mut smart_targets = Vec::new();
        for (target, os_type) in t.into_iter().zip(os_types) {
            match detect_os(&target, os_type, &cache, false).await {
                Ok(os) => match resolve_source(&source, &os) {
                    Ok(command) => smart_targets.push(SmartTarget { command: finalize_command(&command, &os), target }),
                    Err(e) => emit(batch::Update::Skipped { run_id: run_id.clone(), server_id: target.server_id, reason: e }),
                },
                Err(e) => emit(batch::Update::Skipped { run_id: run_id.clone(), server_id: target.server_id, reason: e }),
            }
        }
        batch::run_smart(run_id, smart_targets, mode, stop_on_error, emit, inputs).await;
    });
    Ok(run_id)
}

#[tauri::command]
pub fn get_batch_tasks(state: State<AppState>) -> Result<Vec<BatchTask>, String> {
    Ok(state.data.lock().map_err(|e| e.to_string())?.batch_tasks.clone())
}

#[tauri::command]
pub fn save_batch_task(state: State<AppState>, mut task: BatchTask) -> Result<BatchTask, String> {
    if task.name.trim().is_empty() || (task.script.trim().is_empty() && task.smart_action.is_none()) {
        return Err("Nom et script (ou action) requis".into());
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

fn ansible_target(data: &AppData) -> Result<(BatchTarget, String), String> {
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
    let r = execute_ssh(&t.ssh, &list_playbooks_command(&dir), 15).await?;
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
