/// Planificateur — tâches Wake-on-LAN / arrêt / redémarrage programmées
use chrono::{Datelike, Duration, Local, NaiveDateTime, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    commands::{servers::get_decrypted_password, ssh::execute_ssh, wol::send_magic_packet},
    events::{EventKind, EventLog},
    models::AppData,
    storage::AppState,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ScheduleAction {
    Wake,
    Shutdown,
    Reboot,
}

/// Où la tâche s'exécute : dans l'app (tant qu'elle tourne) ou en cron sur le serveur
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum ScheduleMode {
    #[default]
    App,
    Cron,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum TargetKind {
    Server,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScheduleTarget {
    pub kind: TargetKind,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub action: ScheduleAction,
    #[serde(default)]
    pub mode: ScheduleMode,
    pub target: ScheduleTarget,
    /// Jours d'exécution, 0 = lundi … 6 = dimanche
    pub days: Vec<u8>,
    /// Heure locale « HH:MM »
    pub time: String,
    /// Dernière exécution (ms depuis l'epoch), pour ne jamais exécuter deux fois le même créneau
    #[serde(default)]
    pub last_run: Option<i64>,
}

/// Fenêtre de rattrapage : un tick en retard (PC chargé) exécute encore la tâche,
/// mais un PC sorti de veille des heures plus tard ne déclenche pas d'arrêt surprise.
const DUE_WINDOW_MINUTES: i64 = 2;
const TICK_SECS: u64 = 20;

pub fn parse_time(time: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(time, "%H:%M").ok()
}

/// La tâche doit-elle s'exécuter maintenant ? (`now` et `last_run` en heure locale)
pub fn is_due(schedule: &Schedule, now: NaiveDateTime, last_run: Option<NaiveDateTime>) -> bool {
    // Une tâche cron est exécutée par le serveur lui-même
    if !schedule.enabled || schedule.mode == ScheduleMode::Cron {
        return false;
    }
    let Some(time) = parse_time(&schedule.time) else { return false };
    let weekday = now.weekday().num_days_from_monday() as u8;
    if !schedule.days.contains(&weekday) {
        return false;
    }
    let slot = now.date().and_time(time);
    let in_window = now >= slot && now < slot + Duration::minutes(DUE_WINDOW_MINUTES);
    let already_ran = last_run.is_some_and(|r| r >= slot);
    in_window && !already_ran
}

pub fn validate(schedule: &Schedule, data: &AppData) -> Result<(), String> {
    if schedule.name.trim().is_empty() {
        return Err("Le nom de la tâche est requis".into());
    }
    if parse_time(&schedule.time).is_none() {
        return Err(format!("Heure invalide : {} (format HH:MM)", schedule.time));
    }
    if schedule.days.is_empty() || schedule.days.iter().any(|d| *d > 6) {
        return Err("Choisis au moins un jour valide".into());
    }
    let exists = match schedule.target.kind {
        TargetKind::Server => data.servers.iter().any(|s| s.id == schedule.target.id),
        TargetKind::Group => data.groups.iter().any(|g| g.id == schedule.target.id),
    };
    if !exists {
        return Err("La cible de la tâche n'existe plus".into());
    }
    if schedule.mode == ScheduleMode::Cron {
        if schedule.action == ScheduleAction::Wake {
            return Err("Un Wake-on-LAN ne peut pas être un cron : le serveur est éteint à ce moment-là".into());
        }
        let incompatible = target_server_ids(schedule, data).into_iter().filter_map(|id| {
            data.servers.iter().find(|s| s.id == id).filter(|s| {
                matches!(s.os_type, crate::models::OsType::Windows | crate::models::OsType::ESXi)
            })
        }).map(|s| s.name.clone()).collect::<Vec<_>>();
        if !incompatible.is_empty() {
            return Err(format!("Cron indisponible pour : {}", incompatible.join(", ")));
        }
    }
    Ok(())
}

/// Identifiants des serveurs visés par une tâche (un serveur, ou les membres du groupe)
pub fn target_server_ids(schedule: &Schedule, data: &AppData) -> Vec<String> {
    match schedule.target.kind {
        TargetKind::Server => vec![schedule.target.id.clone()],
        TargetKind::Group => data
            .groups
            .iter()
            .find(|g| g.id == schedule.target.id)
            .map(|g| g.server_ids.clone())
            .unwrap_or_default(),
    }
}

fn to_local(ms: i64) -> Option<NaiveDateTime> {
    Local.timestamp_millis_opt(ms).single().map(|d| d.naive_local())
}

// ── Exécution ─────────────────────────────────────────────────────────────

/// Infos nécessaires pour agir sur un serveur, extraites sous le verrou
struct ServerJob {
    id: String,
    name: String,
    ip: String,
    port: u16,
    user: String,
    password: Option<String>,
    mac: String,
    shutdown_command: String,
    reboot_command: String,
    timeout: u64,
}

fn jobs_for(schedule: &Schedule, data: &AppData) -> Vec<ServerJob> {
    target_server_ids(schedule, data)
        .iter()
        .filter_map(|id| data.servers.iter().find(|s| &s.id == id))
        .map(|s| ServerJob {
            id: s.id.clone(),
            name: s.name.clone(),
            ip: s.ip.clone(),
            port: s.ssh_port,
            user: s.ssh_user.clone(),
            password: get_decrypted_password(data, &s.id).ok(),
            mac: s.mac_address.clone(),
            shutdown_command: s.shutdown_command.clone(),
            reboot_command: s.reboot_command.clone(),
            timeout: data.settings.network.ssh_timeout_secs,
        })
        .collect()
}

/// Verrouillée, un arrêt / redémarrage (mot de passe SSH requis) ne peut pas
/// s'exécuter : la tâche est journalisée en échec. Un Wake-on-LAN, sans secret, part.
pub fn blocked_by_lock(action: ScheduleAction, locked: bool) -> bool {
    locked && action != ScheduleAction::Wake
}

/// Exécute une tâche sur toutes ses cibles et journalise chaque résultat.
pub async fn run_schedule(app: &AppHandle, schedule: &Schedule) {
    let jobs = {
        let state = app.state::<AppState>();
        let Ok(data) = state.data.lock() else { return };
        jobs_for(schedule, &data)
    };
    let events = app.state::<EventLog>();
    let prefix = format!("Planifié ({})", schedule.name);
    log::info!("{} : {:?} sur {} serveur(s)", prefix, schedule.action, jobs.len());
    let locked = crate::crypto::is_locked();

    for job in jobs {
        let outcome: Result<(), String> = match schedule.action {
            action if blocked_by_lock(action, locked) => Err("application verrouillée".into()),
            ScheduleAction::Wake if job.mac.is_empty() => Err("adresse MAC non configurée".into()),
            ScheduleAction::Wake => send_magic_packet(&job.mac),
            ScheduleAction::Shutdown | ScheduleAction::Reboot => {
                let command = if schedule.action == ScheduleAction::Shutdown {
                    &job.shutdown_command
                } else {
                    &job.reboot_command
                };
                match &job.password {
                    None => Err("mot de passe SSH illisible".into()),
                    Some(pass) => execute_ssh(&job.ip, job.port, &job.user, pass, command, job.timeout)
                        .await
                        .and_then(|r| if r.success { Ok(()) } else { Err(r.error.unwrap_or(r.output)) }),
                }
            }
        };
        let (kind, verb) = match schedule.action {
            ScheduleAction::Wake => (EventKind::Wake, "Wake-on-LAN envoyé"),
            ScheduleAction::Shutdown => (EventKind::Shutdown, "arrêt demandé"),
            ScheduleAction::Reboot => (EventKind::Reboot, "redémarrage demandé"),
        };
        match outcome {
            Ok(()) => events.record(kind, Some(&job.id), &job.name, format!("{} : {}", prefix, verb)),
            Err(e) => events.record(EventKind::Failure, Some(&job.id), &job.name, format!("{} : échec — {}", prefix, e)),
        }
    }
}

/// Boucle de fond : vérifie les tâches à intervalle régulier tant que l'app tourne.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(TICK_SECS));
        loop {
            interval.tick().await;
            let now = Local::now();
            let due: Vec<Schedule> = {
                let state = app.state::<AppState>();
                let Ok(mut data) = state.data.lock() else { continue };
                let due: Vec<Schedule> = data
                    .schedules
                    .iter()
                    .filter(|s| is_due(s, now.naive_local(), s.last_run.and_then(to_local)))
                    .cloned()
                    .collect();
                // last_run marqué avant l'exécution : un arrêt lent ne doit pas être relancé au tick suivant
                for s in data.schedules.iter_mut().filter(|s| due.iter().any(|d| d.id == s.id)) {
                    s.last_run = Some(now.timestamp_millis());
                }
                due
            };
            if due.is_empty() {
                continue;
            }
            if let Err(e) = app.state::<AppState>().save() {
                log::warn!("Sauvegarde du planificateur impossible : {}", e);
            }
            for schedule in &due {
                run_schedule(&app, schedule).await;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn schedule(days: Vec<u8>, time: &str) -> Schedule {
        Schedule {
            id: "s".into(),
            name: "Nuit".into(),
            enabled: true,
            action: ScheduleAction::Shutdown,
            mode: ScheduleMode::App,
            target: ScheduleTarget { kind: TargetKind::Server, id: "srv".into() },
            days,
            time: time.into(),
            last_run: None,
        }
    }

    /// 2026-09-25 est un vendredi (jour 4)
    fn at(h: u32, m: u32, s: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 9, 25).unwrap().and_hms_opt(h, m, s).unwrap()
    }

    #[test]
    fn due_on_the_right_day_and_minute() {
        assert!(is_due(&schedule(vec![4], "23:00"), at(23, 0, 10), None));
        assert!(is_due(&schedule(vec![4], "23:00"), at(23, 1, 50), None));
    }

    #[test]
    fn not_due_before_slot_after_window_or_wrong_day() {
        let s = schedule(vec![4], "23:00");
        assert!(!is_due(&s, at(22, 59, 59), None));
        assert!(!is_due(&s, at(23, 2, 0), None));
        assert!(!is_due(&schedule(vec![0, 1, 2, 3], "23:00"), at(23, 0, 10), None));
    }

    #[test]
    fn not_due_twice_for_the_same_slot() {
        let s = schedule(vec![4], "23:00");
        assert!(!is_due(&s, at(23, 0, 30), Some(at(23, 0, 10))));
        // Une exécution de la veille n'empêche pas celle du jour
        assert!(is_due(&s, at(23, 0, 30), Some(at(23, 0, 10) - Duration::days(1))));
    }

    #[test]
    fn disabled_or_invalid_time_never_due() {
        let mut s = schedule(vec![4], "23:00");
        s.enabled = false;
        assert!(!is_due(&s, at(23, 0, 10), None));
        assert!(!is_due(&schedule(vec![4], "25:00"), at(23, 0, 10), None));
    }

    #[test]
    fn locked_app_blocks_shutdown_and_reboot_but_not_wake() {
        assert!(blocked_by_lock(ScheduleAction::Shutdown, true));
        assert!(blocked_by_lock(ScheduleAction::Reboot, true));
        assert!(!blocked_by_lock(ScheduleAction::Wake, true));
        assert!(!blocked_by_lock(ScheduleAction::Shutdown, false));
    }

    #[test]
    fn cron_schedules_are_left_to_the_server() {
        let mut s = schedule(vec![4], "23:00");
        s.mode = ScheduleMode::Cron;
        assert!(!is_due(&s, at(23, 0, 10), None));
    }

    #[test]
    fn validate_rejects_bad_input() {
        let mut data = AppData::default();
        let s = schedule(vec![4], "23:00");
        assert!(validate(&s, &data).unwrap_err().contains("cible"));

        data.servers.push(crate::models::Server::new(
            "srv-name".into(), "10.0.0.1".into(), "AA:BB:CC:DD:EE:FF".into(), "root".into(),
            String::new(), 22, crate::models::OsType::Linux, None, None,
        ));
        let mut ok = s.clone();
        ok.target.id = data.servers[0].id.clone();
        assert!(validate(&ok, &data).is_ok());

        let mut no_day = ok.clone();
        no_day.days.clear();
        assert!(validate(&no_day, &data).is_err());
        let mut bad_time = ok.clone();
        bad_time.time = "7h".into();
        assert!(validate(&bad_time, &data).is_err());

        let mut cron_ok = ok.clone();
        cron_ok.mode = ScheduleMode::Cron;
        assert!(validate(&cron_ok, &data).is_ok());
        let mut cron_wake = cron_ok.clone();
        cron_wake.action = ScheduleAction::Wake;
        assert!(validate(&cron_wake, &data).unwrap_err().contains("Wake"));
    }
}
