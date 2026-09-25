/// Commandes Tauri — Planificateur (+ synchronisation des tâches cron sur les serveurs)
use serde::Serialize;
use std::collections::HashSet;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    commands::{servers::get_decrypted_password, ssh::execute_ssh},
    cron::{build_line, parse_list, sync_command, CronEntry, LIST_COMMAND},
    models::AppData,
    scheduler::{run_schedule, target_server_ids, validate, Schedule, ScheduleAction, ScheduleMode},
    storage::AppState,
};

/// Résultat d'un enregistrement : la tâche + les serveurs dont le crontab n'a pas pu être mis à jour
#[derive(Serialize)]
pub struct SaveReport {
    pub schedule: Schedule,
    pub cron_errors: Vec<String>,
}

/// Paramètres SSH d'un serveur, extraits sous le verrou : (nom, ip, port, utilisateur, mot de passe, timeout)
type SshParams = (String, String, u16, String, String, u64);

fn ssh_params(data: &AppData, server_id: &str) -> Result<SshParams, String> {
    let server = data
        .servers
        .iter()
        .find(|s| s.id == server_id)
        .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
    Ok((
        server.name.clone(),
        server.ip.clone(),
        server.ssh_port,
        server.ssh_user.clone(),
        get_decrypted_password(data, server_id)?,
        data.settings.network.ssh_timeout_secs.min(15),
    ))
}

/// Opération crontab à appliquer sur un serveur : Some(ligne) = installer, None = retirer
struct CronOp {
    params: SshParams,
    line: Option<String>,
}

/// Calcule les opérations crontab entre l'ancienne et la nouvelle version d'une tâche.
fn plan_cron_ops(data: &AppData, old: Option<&Schedule>, new: Option<&Schedule>) -> (String, Vec<CronOp>, Vec<String>) {
    let cron_targets = |s: Option<&Schedule>| -> HashSet<String> {
        s.filter(|s| s.mode == ScheduleMode::Cron)
            .map(|s| target_server_ids(s, data).into_iter().collect())
            .unwrap_or_default()
    };
    let old_targets = cron_targets(old);
    let wanted = new.filter(|s| s.enabled);
    let new_targets = cron_targets(wanted);
    let id = new.or(old).map(|s| s.id.clone()).unwrap_or_default();

    let mut ops = Vec::new();
    let mut errors = Vec::new();
    for server_id in old_targets.union(&new_targets) {
        let params = match ssh_params(data, server_id) {
            Ok(p) => p,
            Err(e) => {
                errors.push(e);
                continue;
            }
        };
        let line = match wanted.filter(|_| new_targets.contains(server_id)) {
            Some(s) => {
                let server = data.servers.iter().find(|x| &x.id == server_id);
                let command = match (s.action, server) {
                    (ScheduleAction::Shutdown, Some(sv)) => sv.shutdown_command.clone(),
                    (ScheduleAction::Reboot, Some(sv)) => sv.reboot_command.clone(),
                    _ => continue,
                };
                match build_line(&s.id, &s.time, &s.days, &command) {
                    Ok(l) => Some(l),
                    Err(e) => {
                        errors.push(format!("{} : {}", params.0, e));
                        continue;
                    }
                }
            }
            None => None,
        };
        ops.push(CronOp { params, line });
    }
    (id, ops, errors)
}

async fn apply_cron_ops(id: &str, ops: Vec<CronOp>, mut errors: Vec<String>) -> Vec<String> {
    for op in ops {
        let (name, ip, port, user, pass, timeout) = op.params;
        let command = sync_command(id, op.line.as_deref());
        let result = execute_ssh(&ip, port, &user, &pass, &command, timeout).await;
        match result {
            Ok(r) if r.success => log::info!("Crontab de {} synchronisé (tâche {})", name, id),
            Ok(r) => errors.push(format!("{} : {}", name, r.output)),
            Err(e) => errors.push(format!("{} : {}", name, e)),
        }
    }
    errors
}

#[tauri::command]
pub fn get_schedules(state: State<AppState>) -> Result<Vec<Schedule>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.schedules.clone())
}

/// Ajoute (id vide) ou met à jour une tâche, après validation, puis synchronise les crontabs.
#[tauri::command]
pub async fn save_schedule(state: State<'_, AppState>, mut schedule: Schedule) -> Result<SaveReport, String> {
    let (id, ops, errors) = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        validate(&schedule, &data)?;
        schedule.name = schedule.name.trim().to_string();
        schedule.days.sort_unstable();
        schedule.days.dedup();
        let previous = data.schedules.iter().find(|s| s.id == schedule.id && !schedule.id.is_empty()).cloned();
        match &previous {
            Some(existing) => {
                // Modifier l'heure ne doit pas faire perdre la trace du dernier créneau exécuté
                schedule.last_run = existing.last_run;
                if let Some(slot) = data.schedules.iter_mut().find(|s| s.id == schedule.id) {
                    *slot = schedule.clone();
                }
            }
            None => {
                schedule.id = Uuid::new_v4().to_string();
                schedule.last_run = None;
                data.schedules.push(schedule.clone());
            }
        }
        plan_cron_ops(&data, previous.as_ref(), Some(&schedule))
    };
    state.save()?;
    let cron_errors = apply_cron_ops(&id, ops, errors).await;
    Ok(SaveReport { schedule, cron_errors })
}

/// Supprime une tâche et retire sa ligne des crontabs ; renvoie les erreurs de synchronisation.
#[tauri::command]
pub async fn delete_schedule(state: State<'_, AppState>, id: String) -> Result<Vec<String>, String> {
    let (ops, errors) = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let removed = data.schedules.iter().find(|s| s.id == id).cloned();
        data.schedules.retain(|s| s.id != id);
        let (_, ops, errors) = plan_cron_ops(&data, removed.as_ref(), None);
        (ops, errors)
    };
    state.save()?;
    Ok(apply_cron_ops(&id, ops, errors).await)
}

#[tauri::command]
pub async fn run_schedule_now(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    crate::crypto::ensure_unlocked()?;
    let schedule = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.schedules
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| format!("Tâche introuvable : {}", id))?
    };
    run_schedule(&app, &schedule).await;
    Ok(())
}

/// Crons présents sur un serveur (utilisateur SSH + /etc/crontab + /etc/cron.d)
#[tauri::command]
pub async fn cron_list(state: State<'_, AppState>, server_id: String) -> Result<Vec<CronEntry>, String> {
    let (_, ip, port, user, pass, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        ssh_params(&data, &server_id)?
    };
    let result = execute_ssh(&ip, port, &user, &pass, LIST_COMMAND, timeout).await?;
    Ok(parse_list(&result.output))
}

/// Retire une ligne étiquetée orpheline (tâche supprimée de l'app sans nettoyage du serveur)
#[tauri::command]
pub async fn cron_remove_managed(state: State<'_, AppState>, server_id: String, schedule_id: String) -> Result<(), String> {
    if !schedule_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Identifiant de tâche invalide : {}", schedule_id));
    }
    let (_, ip, port, user, pass, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        ssh_params(&data, &server_id)?
    };
    let result = execute_ssh(&ip, port, &user, &pass, &sync_command(&schedule_id, None), timeout).await?;
    if result.success { Ok(()) } else { Err(result.output) }
}
