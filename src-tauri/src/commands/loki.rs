/// Commandes Tauri — Logs Loki (lecture seule)
use serde_json::Value;
use tauri::State;

use crate::{
    integrations::{describe_http_error, http_client, resolve, IntegrationKind, Resolved},
    loki::{build_query, parse_range, LogEntry},
    storage::AppState,
};

async fn get(r: &Resolved, path: &str, params: &[(&str, String)]) -> Result<Value, String> {
    let mut req = http_client(r.config.verify_tls, 15)?.get(format!("{}/loki/api/v1{}", r.config.url, path)).query(params);
    if !r.config.username.is_empty() {
        req = req.basic_auth(&r.config.username, Some(&r.secret));
    }
    let resp = req.send().await.map_err(|e| format!("Loki injoignable : {}", describe_http_error(&e)))?;
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Loki HTTP {} : {}", status.as_u16(), text.trim().chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| "Réponse Loki illisible".into())
}

fn loki(state: &AppState) -> Result<Resolved, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    resolve(&data, IntegrationKind::Loki)
}

/// Valeurs d'un label (ex. « host » ou « unit » d'un hôte) sur les dernières 24 h
pub async fn label_values(r: &Resolved, label: &str, host: Option<&str>) -> Result<Vec<String>, String> {
    let mut params = vec![];
    if let Some(h) = host {
        params.push(("query", format!("{{host=\"{}\"}}", h.replace('"', "\\\""))));
    }
    let v = get(r, &format!("/label/{}/values", label), &params).await?;
    Ok(v["data"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default())
}

#[allow(clippy::too_many_arguments)]
pub async fn query(r: &Resolved, host: &str, max_priority: Option<u8>, unit: Option<&str>, text: Option<&str>, start_ms: i64, end_ms: i64, limit: u32) -> Result<Vec<LogEntry>, String> {
    let q = build_query(host, max_priority, unit, text);
    let v = get(
        r,
        "/query_range",
        &[
            ("query", q),
            ("start", (start_ms * 1_000_000).to_string()),
            ("end", (end_ms * 1_000_000).to_string()),
            ("limit", limit.clamp(10, 5000).to_string()),
            ("direction", "backward".into()),
        ],
    )
    .await?;
    parse_range(&v)
}

#[tauri::command]
pub async fn loki_hosts(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let r = loki(&state)?;
    label_values(&r, "host", None).await
}

#[tauri::command]
pub async fn loki_units(state: State<'_, AppState>, host: String) -> Result<Vec<String>, String> {
    let r = loki(&state)?;
    label_values(&r, "unit", Some(&host)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn loki_query(
    state: State<'_, AppState>,
    host: String,
    max_priority: Option<u8>,
    unit: Option<String>,
    text: Option<String>,
    start_ms: i64,
    end_ms: i64,
    limit: u32,
) -> Result<Vec<LogEntry>, String> {
    let r = loki(&state)?;
    query(&r, &host, max_priority, unit.as_deref(), text.as_deref(), start_ms, end_ms, limit).await
}

#[cfg(test)]
mod live {
    use crate::integrations::{Integration, IntegrationKind, Resolved};

    /// Lecture seule sur le Loki du homelab : cargo test live_loki -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_loki() {
        let r = Resolved {
            config: Integration {
                kind: IntegrationKind::Loki, enabled: true, url: "http://192.168.1.59:3100".into(),
                username: String::new(), secret: String::new(), verify_tls: false, extra: Default::default(),
            },
            secret: String::new(),
        };
        println!("hôtes : {:?}", super::label_values(&r, "host", None).await);
        let units = super::label_values(&r, "unit", Some("minipc")).await.unwrap();
        println!("unités minipc : {} (ex. {:?})", units.len(), units.iter().take(4).collect::<Vec<_>>());
        let now = crate::events::now_ms();
        let errs = super::query(&r, "minipc", Some(3), None, None, now - 24 * 3600_000, now, 5).await.unwrap();
        println!("erreurs minipc (24 h) : {}", errs.len());
        for e in errs.iter().take(3) {
            println!("  [{}] {} : {}", e.priority.unwrap_or(9), e.unit, e.line.chars().take(100).collect::<String>());
        }
    }
}
