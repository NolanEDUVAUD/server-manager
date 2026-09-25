/// Envoi de notifications push : ntfy, Discord (webhook), Telegram (Bot API)
use serde_json::json;

use crate::integrations::{http_client, IntegrationKind, Resolved};

pub const PUSH_KINDS: [IntegrationKind; 3] = [IntegrationKind::Ntfy, IntegrationKind::Discord, IntegrationKind::Telegram];

/// Priorité ntfy (1-5) selon la gravité
pub fn ntfy_priority(critical: bool) -> &'static str {
    if critical { "5" } else { "3" }
}

pub async fn send(resolved: &Resolved, title: &str, message: &str, critical: bool) -> Result<(), String> {
    let cfg = &resolved.config;
    let client = http_client(cfg.verify_tls, 10)?;
    let request = match cfg.kind {
        IntegrationKind::Ntfy => {
            let topic = cfg.extra.get("topic").map(String::as_str).unwrap_or("").trim();
            if topic.is_empty() {
                return Err("ntfy : topic manquant".into());
            }
            let mut req = client
                .post(format!("{}/{}", cfg.url, topic))
                // Titre en en-tête HTTP : ntfy n'accepte que de l'ASCII ici, on le translittère
                .header("Title", ascii_header(title))
                .header("Priority", ntfy_priority(critical))
                .header("Tags", if critical { "rotating_light" } else { "information_source" })
                .body(message.to_string());
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

/// En-tête HTTP ASCII : accents retirés, autres caractères remplacés
pub fn ascii_header(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' => 'i',
            'ô' | 'ö' => 'o',
            'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'É' | 'È' => 'E',
            c if c.is_ascii() && !c.is_ascii_control() => c,
            _ => '?',
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_is_ascii() {
        assert_eq!(ascii_header("Serveur « truenas » hors ligne — échec"), "Serveur ? truenas ? hors ligne ? echec");
        assert!(ascii_header("é\n").is_ascii());
        assert!(!ascii_header("a\nb").contains('\n'));
    }
}
