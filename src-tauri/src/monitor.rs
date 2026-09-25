/// Boucles de surveillance côté Rust (ping + métriques). Elles tournent en tâche de
/// fond indépendamment de la fenêtre : une webview masquée dans la zone de
/// notification voit ses minuteurs JavaScript ralentis, ce qui rendrait les
/// alertes peu fiables si la surveillance restait dans le frontend.
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    commands::ping::ping_host,
    commands::metrics::collect_metrics,
    events::EventLog,
    metrics::ServerMetrics,
    models::{OsType, PingResult},
    storage::AppState,
};

#[derive(Debug, Clone, Serialize)]
pub struct MetricsUpdate {
    pub server_id: String,
    pub metrics: Option<ServerMetrics>,
    pub error: Option<String>,
}

/// Dernier statut connu par serveur (partagé entre les deux boucles)
#[derive(Default, Clone)]
struct Shared {
    online: Arc<Mutex<HashMap<String, bool>>>,
    in_flight: Arc<Mutex<HashSet<String>>>,
}

/// Serveurs à collecter : en ligne, compatibles (/proc) et sans collecte en cours
pub fn metrics_candidates(
    servers: &[(String, OsType)],
    online: &HashMap<String, bool>,
    in_flight: &HashSet<String>,
) -> Vec<String> {
    servers
        .iter()
        .filter(|(id, os)| {
            !matches!(os, OsType::Windows | OsType::ESXi)
                && online.get(id).copied().unwrap_or(false)
                && !in_flight.contains(id)
        })
        .map(|(id, _)| id.clone())
        .collect()
}

pub fn start(app: AppHandle) {
    let shared = Shared::default();

    // ── Ping ──────────────────────────────────────────────────────────────
    let (app_p, shared_p) = (app.clone(), shared.clone());
    tauri::async_runtime::spawn(async move {
        loop {
            let (servers, interval, timeout) = {
                let state = app_p.state::<AppState>();
                let Ok(data) = state.data.lock() else { break };
                (
                    data.servers.iter().map(|s| (s.id.clone(), s.ip.clone(), s.name.clone())).collect::<Vec<_>>(),
                    data.settings.network.ping_interval_secs.max(5),
                    data.settings.network.ping_timeout_ms,
                )
            };
            let results: Vec<(PingResult, String)> = futures::future::join_all(servers.into_iter().map(|(id, ip, name)| async move {
                let (online, latency_ms) = ping_host(&ip, timeout).await;
                (PingResult { server_id: id, online, latency_ms }, name)
            }))
            .await;

            let events = app_p.state::<EventLog>();
            if let Ok(mut online) = shared_p.online.lock() {
                for (r, _) in &results {
                    online.insert(r.server_id.clone(), r.online);
                }
            }
            for (r, name) in &results {
                events.observe_ping(&r.server_id, name, r.online);
            }
            let _ = app_p.emit("ping-results", results.into_iter().map(|(r, _)| r).collect::<Vec<_>>());
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });

    // ── Métriques ─────────────────────────────────────────────────────────
    tauri::async_runtime::spawn(async move {
        // Laisse le premier ping établir les statuts
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            let (enabled, interval, servers) = {
                let state = app.state::<AppState>();
                let Ok(data) = state.data.lock() else { break };
                (
                    data.settings.network.metrics_enabled,
                    data.settings.network.metrics_interval_secs.max(5),
                    data.servers.iter().map(|s| (s.id.clone(), s.os_type.clone())).collect::<Vec<_>>(),
                )
            };
            if enabled {
                let targets = {
                    let online = shared.online.lock().map(|o| o.clone()).unwrap_or_default();
                    let mut in_flight = shared.in_flight.lock().unwrap_or_else(|e| e.into_inner());
                    let targets = metrics_candidates(&servers, &online, &in_flight);
                    in_flight.extend(targets.iter().cloned());
                    targets
                };
                for server_id in targets {
                    let (app_m, in_flight) = (app.clone(), shared.in_flight.clone());
                    tauri::async_runtime::spawn(async move {
                        let result = collect_metrics(&app_m, &server_id).await;
                        let update = match result {
                            Ok(m) => MetricsUpdate { server_id: server_id.clone(), metrics: Some(m), error: None },
                            Err(e) => MetricsUpdate { server_id: server_id.clone(), metrics: None, error: Some(e) },
                        };
                        let _ = app_m.emit("metrics-update", update);
                        if let Ok(mut f) = in_flight.lock() {
                            f.remove(&server_id);
                        }
                    });
                }
            }
            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_are_online_supported_and_idle() {
        let servers = vec![
            ("a".to_string(), OsType::Linux),
            ("b".to_string(), OsType::Windows),
            ("c".to_string(), OsType::Proxmox),
            ("d".to_string(), OsType::TrueNAS),
            ("e".to_string(), OsType::Linux),
        ];
        let online: HashMap<String, bool> =
            [("a", true), ("b", true), ("c", true), ("d", false)].iter().map(|(k, v)| (k.to_string(), *v)).collect();
        let in_flight: HashSet<String> = ["c".to_string()].into_iter().collect();
        // b : Windows ; c : collecte en cours ; d : hors ligne ; e : jamais pingé
        assert_eq!(metrics_candidates(&servers, &online, &in_flight), vec!["a".to_string()]);
    }
}
