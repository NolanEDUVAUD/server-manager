/// Commandes Tauri — Ping ICMP via commande système
use std::time::Instant;
use tauri::State;
use tokio::process::Command;

use crate::{models::PingResult, storage::AppState};

// ── Pinger un serveur par son ID ──────────────────────────────────────────
#[tauri::command]
pub async fn ping_server(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<PingResult, String> {
    let (ip, timeout_ms) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        (server.ip.clone(), data.settings.ping_timeout_ms)
    };

    let result = ping_host(&ip, timeout_ms).await;
    Ok(PingResult {
        server_id,
        online: result.0,
        latency_ms: result.1,
    })
}

// ── Pinger tous les serveurs (pour le dashboard) ──────────────────────────
#[tauri::command]
pub async fn ping_all(state: State<'_, AppState>) -> Result<Vec<PingResult>, String> {
    let servers = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.servers
            .iter()
            .map(|s| (s.id.clone(), s.ip.clone()))
            .collect::<Vec<_>>()
    };

    let timeout_ms = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.settings.ping_timeout_ms
    };

    // Pinger tous les serveurs en parallèle
    let futures: Vec<_> = servers
        .into_iter()
        .map(|(id, ip)| async move {
            let (online, latency) = ping_host(&ip, timeout_ms).await;
            PingResult {
                server_id: id,
                online,
                latency_ms: latency,
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;
    Ok(results)
}

// ── Pinger tous les serveurs d'un groupe ──────────────────────────────────
#[tauri::command]
pub async fn ping_group(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<Vec<PingResult>, String> {
    let (server_ips, timeout_ms) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let group = data
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or_else(|| format!("Groupe introuvable: {}", group_id))?;

        let ips = group
            .server_ids
            .iter()
            .filter_map(|sid| data.servers.iter().find(|s| &s.id == sid))
            .map(|s| (s.id.clone(), s.ip.clone()))
            .collect::<Vec<_>>();

        (ips, data.settings.ping_timeout_ms)
    };

    let futures: Vec<_> = server_ips
        .into_iter()
        .map(|(id, ip)| async move {
            let (online, latency) = ping_host(&ip, timeout_ms).await;
            PingResult {
                server_id: id,
                online,
                latency_ms: latency,
            }
        })
        .collect();

    Ok(futures::future::join_all(futures).await)
}

// ── Ping ICMP via commande système (fonctionne sans privilèges admin) ─────
/// Retourne (en_ligne, latence_ms)
pub async fn ping_host(ip: &str, timeout_ms: u64) -> (bool, Option<u64>) {
    let start = Instant::now();

    // Sur Windows, CREATE_NO_WINDOW empêche l'apparition de fenêtres CMD
    #[cfg(target_os = "windows")]
    let output = {
        // 0x08000000 = CREATE_NO_WINDOW
        Command::new("ping")
            .args(["-n", "1", "-w", &timeout_ms.to_string(), ip])
            .creation_flags(0x08000000)
            .output()
            .await
    };

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .args(["-c", "1", "-W", &(timeout_ms / 1000).max(1).to_string(), ip])
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            let elapsed = start.elapsed().as_millis() as u64;
            // Extraire la latence depuis la sortie si possible
            let latency = parse_ping_latency(&String::from_utf8_lossy(&out.stdout))
                .unwrap_or(elapsed);
            (true, Some(latency))
        }
        _ => (false, None),
    }
}

/// Extraire la latence en ms depuis la sortie de la commande ping
fn parse_ping_latency(output: &str) -> Option<u64> {
    // Windows : "Durée = Xms" ou "time=Xms"
    // Linux : "time=X ms"
    for line in output.lines() {
        let line_lower = line.to_lowercase();
        if line_lower.contains("time=") || line_lower.contains("durée") || line_lower.contains("duree") {
            // Chercher un nombre suivi de "ms"
            let parts: Vec<&str> = line.split_whitespace().collect();
            for part in &parts {
                if let Some(stripped) = part.strip_suffix("ms") {
                    if let Ok(ms) = stripped.trim_matches('=').parse::<u64>() {
                        return Some(ms);
                    }
                }
                // Format "time=X"
                if part.starts_with("time=") {
                    if let Ok(ms) = part[5..].parse::<f64>() {
                        return Some(ms as u64);
                    }
                }
            }
        }
    }
    None
}
