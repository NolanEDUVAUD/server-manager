/// Commandes Tauri — Arrêt / démarrage ordonnés du lab (simulation + exécution)
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    commands::{ping::ping_host, proxmox::build_client, ssh::execute_ssh, wol::send_magic_packet},
    events::{EventKind, EventLog},
    lab_power::{shutdown_plan, startup_plan, Action, Guest, Machine, Plan},
    ssh_auth::resolve_ssh,
    storage::AppState,
};

/// Phrases à recopier pour lancer une exécution réelle (vérifiées côté Rust aussi)
pub const CONFIRM_SHUTDOWN: &str = "ÉTEINDRE LE LAB";
pub const CONFIRM_STARTUP: &str = "DÉMARRER LE LAB";

#[derive(Default)]
pub struct LabPowerState {
    running: AtomicBool,
    cancel: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub step: usize,
    pub status: String,
    pub message: String,
}

/// Commande shell d'arrêt / démarrage d'invités sur leur nœud (qm pour les VM, pct pour les CT).
/// L'arrêt attend la fin (timeout) puis force l'arrêt en dernier recours.
pub fn guest_commands(guests: &[Guest], start: bool) -> String {
    guests
        .iter()
        .map(|g| {
            let tool = if g.kind == "lxc" { "pct" } else { "qm" };
            // N'agit que si l'invité n'est pas déjà dans l'état voulu (idempotent)
            if start {
                format!("{t} status {id} | grep -q running || {t} start {id}", t = tool, id = g.vmid)
            } else {
                format!(
                    "if {t} status {id} | grep -q running; then {t} shutdown {id} --timeout 180 || {t} stop {id}; fi",
                    t = tool,
                    id = g.vmid
                )
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Inventaire : serveurs de l'app (avec leur nœud Proxmox), invités et statuts
async fn inventory(app: &AppHandle) -> Result<(Vec<Machine>, Vec<Guest>), String> {
    let (servers, client, timeout) = {
        let state = app.state::<AppState>();
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let client = data.proxmox_connections.first().map(|c| build_client(&data, &c.id)).transpose()?;
        (data.servers.clone(), client, data.settings.network.ping_timeout_ms)
    };
    let (mut node_by_ip, mut guests) = (std::collections::HashMap::new(), Vec::new());
    if let Some(client) = client {
        let status = client.get_value("/cluster/status").await?;
        for n in status.as_array().cloned().unwrap_or_default().iter().filter(|x| x["type"] == "node") {
            if let (Some(ip), Some(name)) = (n["ip"].as_str(), n["name"].as_str()) {
                node_by_ip.insert(ip.to_string(), name.to_string());
            }
        }
        let res = client.get_value("/cluster/resources").await?;
        for r in res.as_array().cloned().unwrap_or_default() {
            if r["type"] == "qemu" || r["type"] == "lxc" {
                guests.push(Guest {
                    vmid: r["vmid"].as_u64().unwrap_or(0) as u32,
                    name: r["name"].as_str().unwrap_or("").to_string(),
                    node: r["node"].as_str().unwrap_or("").to_string(),
                    kind: r["type"].as_str().unwrap_or("").to_string(),
                    running: r["status"] == "running",
                });
            }
        }
    }
    let pings = futures::future::join_all(servers.iter().map(|s| ping_host(&s.ip, timeout))).await;
    let machines = servers
        .iter()
        .zip(pings)
        .map(|(s, (online, _))| Machine {
            id: s.id.clone(),
            name: s.name.clone(),
            os_type: s.os_type.clone(),
            has_mac: !s.mac_address.is_empty(),
            online,
            pve_node: node_by_ip.get(&s.ip).cloned(),
        })
        .collect();
    Ok((machines, guests))
}

/// Mode simulation : calcule le plan sans rien exécuter
#[tauri::command]
pub async fn lab_power_plan(app: AppHandle, state: State<'_, AppState>, startup: bool) -> Result<Plan, String> {
    crate::crypto::ensure_unlocked()?;
    let (machines, guests) = inventory(&app).await?;
    if startup {
        let previous = state.data.lock().map_err(|e| e.to_string())?.last_lab_running.clone();
        Ok(startup_plan(&machines, &guests, &previous))
    } else {
        Ok(shutdown_plan(&machines, &guests))
    }
}

#[tauri::command]
pub fn lab_power_cancel(lab: State<LabPowerState>) {
    lab.cancel.store(true, Ordering::SeqCst);
}

/// Exécution réelle, étape par étape. `confirm` doit être la phrase attendue.
#[tauri::command]
pub async fn lab_power_execute(app: AppHandle, startup: bool, confirm: String) -> Result<(), String> {
    crate::crypto::ensure_unlocked()?;
    let expected = if startup { CONFIRM_STARTUP } else { CONFIRM_SHUTDOWN };
    if confirm.trim() != expected {
        return Err(format!("Confirmation incorrecte : recopie « {} »", expected));
    }
    let lab = app.state::<LabPowerState>();
    if lab.running.swap(true, Ordering::SeqCst) {
        return Err("Une séquence est déjà en cours".into());
    }
    lab.cancel.store(false, Ordering::SeqCst);
    let result = run(&app, startup).await;
    lab.running.store(false, Ordering::SeqCst);
    result
}

async fn run(app: &AppHandle, startup: bool) -> Result<(), String> {
    let (machines, guests) = inventory(app).await?;
    let plan = if startup {
        let previous = app.state::<AppState>().data.lock().map_err(|e| e.to_string())?.last_lab_running.clone();
        startup_plan(&machines, &guests, &previous)
    } else {
        // Mémorise les invités allumés pour pouvoir les relancer au démarrage
        let running: Vec<Guest> = guests.iter().filter(|g| g.running).cloned().collect();
        let state = app.state::<AppState>();
        state.data.lock().map_err(|e| e.to_string())?.last_lab_running = running;
        state.save()?;
        shutdown_plan(&machines, &guests)
    };
    let events = app.state::<EventLog>();
    let label = if startup { "Démarrage du lab" } else { "Arrêt du lab" };
    events.record(EventKind::VmAction, None, label, format!("Séquence lancée ({} étapes)", plan.steps.len()));

    for (i, step) in plan.steps.iter().enumerate() {
        if app.state::<LabPowerState>().cancel.load(Ordering::SeqCst) {
            let _ = app.emit("lab-power-progress", Progress { step: i, status: "cancelled".into(), message: "Séquence annulée".into() });
            events.record(EventKind::Failure, None, label, format!("Annulée avant l'étape « {} »", step.title));
            return Err("Séquence annulée".into());
        }
        let _ = app.emit("lab-power-progress", Progress { step: i, status: "running".into(), message: step.title.clone() });
        let results = futures::future::join_all(step.actions.iter().map(|a| run_action(app, &machines, a))).await;
        let errors: Vec<String> = results.into_iter().filter_map(Result::err).collect();
        let (status, message) = if errors.is_empty() { ("done", "terminé".to_string()) } else { ("error", errors.join(" · ")) };
        let _ = app.emit("lab-power-progress", Progress { step: i, status: status.into(), message: message.clone() });
        if !errors.is_empty() {
            events.record(EventKind::Failure, None, label, format!("Étape « {} » : {}", step.title, message));
        }
    }
    events.record(EventKind::VmAction, None, label, "Séquence terminée");
    Ok(())
}

/// Serveur de l'app correspondant à un nœud Proxmox
fn node_server<'a>(machines: &'a [Machine], node: &str) -> Option<&'a Machine> {
    machines.iter().find(|m| m.pve_node.as_deref() == Some(node))
}

async fn ssh_on(app: &AppHandle, server_id: &str, command: Option<&str>, timeout: u64) -> Result<(), String> {
    let (target, cmd) = {
        let state = app.state::<AppState>();
        let data = state.data.lock().map_err(|e| e.to_string())?;
        let s = data.servers.iter().find(|s| s.id == server_id).ok_or("Serveur introuvable")?;
        (resolve_ssh(&data, server_id)?, command.map(str::to_string).unwrap_or(s.shutdown_command.clone()))
    };
    let r = execute_ssh(&target, &cmd, timeout).await?;
    if r.success { Ok(()) } else { Err(r.error.unwrap_or(r.output)) }
}

async fn run_action(app: &AppHandle, machines: &[Machine], action: &Action) -> Result<(), String> {
    match action {
        Action::ShutdownServer { server_id } => {
            // La connexion SSH est souvent coupée par l'arrêt lui-même : ce n'est pas une erreur
            match ssh_on(app, server_id, None, 30).await {
                Ok(()) => Ok(()),
                Err(e) if e.contains("Code de sortie") || e.to_lowercase().contains("connexion") => Ok(()),
                Err(e) => Err(e),
            }
        }
        Action::WakeServer { server_id } => {
            let (mac, ip, timeout) = {
                let state = app.state::<AppState>();
                let data = state.data.lock().map_err(|e| e.to_string())?;
                let s = data.servers.iter().find(|s| &s.id == server_id).ok_or("Serveur introuvable")?;
                (s.mac_address.clone(), s.ip.clone(), data.settings.network.ping_timeout_ms)
            };
            send_magic_packet(&mac)?;
            // Attente de la réponse au ping (5 min max)
            for _ in 0..60 {
                if ping_host(&ip, timeout).await.0 {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
            Err(format!("{} ne répond pas 5 min après le WoL", ip))
        }
        Action::ShutdownGuests { guests } | Action::StartGuests { guests } => {
            let start = matches!(action, Action::StartGuests { .. });
            // Un lot de commandes par nœud, les nœuds en parallèle
            let mut by_node: std::collections::BTreeMap<&str, Vec<Guest>> = Default::default();
            for g in guests {
                by_node.entry(g.node.as_str()).or_default().push(g.clone());
            }
            let jobs = by_node.into_iter().map(|(node, list)| async move {
                let server = node_server(machines, node).ok_or(format!("Nœud {} absent des serveurs de l'app", node))?;
                ssh_on(app, &server.id, Some(&guest_commands(&list, start)), 240).await.map_err(|e| format!("{} : {}", node, e))
            });
            let errors: Vec<String> = futures::future::join_all(jobs).await.into_iter().filter_map(Result::err).collect();
            if errors.is_empty() { Ok(()) } else { Err(errors.join(" · ")) }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guest_commands_use_qm_or_pct_with_graceful_timeout() {
        let gs = vec![
            Guest { vmid: 106, name: "OPNSense".into(), node: "n".into(), kind: "qemu".into(), running: true },
            Guest { vmid: 107, name: "npm".into(), node: "n".into(), kind: "lxc".into(), running: true },
        ];
        assert_eq!(
            guest_commands(&gs, false),
            "if qm status 106 | grep -q running; then qm shutdown 106 --timeout 180 || qm stop 106; fi;              if pct status 107 | grep -q running; then pct shutdown 107 --timeout 180 || pct stop 107; fi"
                .replace("             ", "")
        );
        assert_eq!(guest_commands(&gs, true), "qm status 106 | grep -q running || qm start 106; pct status 107 | grep -q running || pct start 107");
    }
}
