/// Envoi de notifications push : ntfy, Discord (webhook), Telegram (Bot API)
use serde_json::json;

use crate::integrations::{http_client, IntegrationKind, Resolved};

pub const PUSH_KINDS: [IntegrationKind; 3] = [IntegrationKind::Ntfy, IntegrationKind::Discord, IntegrationKind::Telegram];

pub async fn send(resolved: &Resolved, title: &str, message: &str, critical: bool) -> Result<(), String> {
    let cfg = &resolved.config;
    let client = http_client(cfg.verify_tls, 10)?;
    let request = match cfg.kind {
        IntegrationKind::Ntfy => {
            let topic = cfg.extra.get("topic").map(String::as_str).unwrap_or("").trim();
            if topic.is_empty() {
                return Err("ntfy : topic manquant".into());
            }
            // Publication JSON (et non par en-têtes HTTP) : titre en UTF-8 intact
            let mut req = client.post(&cfg.url).json(&json!({
                "topic": topic,
                "title": title,
                "message": message,
                "priority": if critical { 5 } else { 3 },
                "tags": [if critical { "rotating_light" } else { "information_source" }],
            }));
            if !resolved.secret.is_empty() {
                req = req.bearer_auth(&resolved.secret);
            }
            req
        }
        IntegrationKind::Discord => {
            // L'URL du webhook contient son jeton : elle est stockée comme secret
            if resolved.secret.is_empty() {
                return Err("Discord : URL du webhook manquante".into());
            }
            client.post(&resolved.secret).json(&json!({
                "username": "Server Manager",
                "content": format!("{} **{}**\n{}", if critical { "🚨" } else { "ℹ️" }, title, message),
            }))
        }
        IntegrationKind::Telegram => {
            let chat_id = cfg.extra.get("chat_id").map(String::as_str).unwrap_or("").trim();
            if resolved.secret.is_empty() || chat_id.is_empty() {
                return Err("Telegram : jeton du bot ou chat_id manquant".into());
            }
            client
                .post(format!("https://api.telegram.org/bot{}/sendMessage", resolved.secret))
                .json(&json!({
                    "chat_id": chat_id,
                    "text": format!("{} {}\n{}", if critical { "🚨" } else { "ℹ️" }, title, message),
                }))
        }
        other => return Err(format!("{:?} n'est pas un canal de notification", other)),
    };
    let resp = request.send().await.map_err(|e| format!("{:?} : envoi impossible — {}", cfg.kind, e))?;
    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("{:?} : HTTP {} — {}", cfg.kind, status, body.chars().take(200).collect::<String>()))
    }
}
