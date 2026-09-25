/// Tests de connexion authentifiés, propres à chaque intégration
use serde_json::{json, Value};

use crate::{
    integrations::{http_client, zabbix_api_url, IntegrationKind, Resolved},
    notify,
};

async fn json_ok(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {} — {}", status.as_u16(), text.chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&text).map_err(|_| format!("Réponse inattendue : {}", text.chars().take(120).collect::<String>()))
}

pub async fn check(kind: IntegrationKind, r: &Resolved) -> Result<String, String> {
    let c = &r.config;
    let http = http_client(c.verify_tls, 10)?;
    match kind {
        IntegrationKind::Zabbix => {
            let url = zabbix_api_url(&c.url);
            let version = json_ok(
                http.post(&url)
                    .json(&json!({"jsonrpc": "2.0", "method": "apiinfo.version", "params": [], "id": 1}))
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            let auth = json_ok(
                http.post(&url)
                    .bearer_auth(&r.secret)
                    .json(&json!({"jsonrpc": "2.0", "method": "host.get", "params": {"limit": 1, "output": ["hostid"]}, "id": 2}))
                    .send()
                    .await
                    .map_err(|e| e.to_string())?,
            )
            .await?;
            if let Some(err) = auth.get("error") {
                return Err(format!("Jeton refusé : {}", err["data"].as_str().unwrap_or("erreur")));
            }
            Ok(format!("Zabbix {} — jeton valide", version["result"].as_str().unwrap_or("?")))
        }
        IntegrationKind::Loki => {
            let mut req = http.get(format!("{}/ready", c.url));
            if !c.username.is_empty() {
                req = req.basic_auth(&c.username, Some(&r.secret));
            }
            let resp = req.send().await.map_err(|e| format!("Injoignable : {}", e))?;
            let status = resp.status().as_u16();
            let text = resp.text().await.unwrap_or_default();
            if status == 200 { Ok("Loki prêt".into()) } else { Err(format!("HTTP {} — {}", status, text.trim())) }
        }
        IntegrationKind::Npm => {
            let body = json_ok(
                http.post(format!("{}/api/tokens", c.url))
                    .json(&json!({"identity": c.username, "secret": r.secret}))
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            body.get("token").map(|_| "Connexion à Nginx Proxy Manager réussie".to_string()).ok_or("Identifiants refusés".into())
        }
        IntegrationKind::TrueNas => {
            let info = json_ok(
                http.get(format!("{}/api/v2.0/system/info", c.url))
                    .bearer_auth(&r.secret)
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            Ok(format!("TrueNAS {} ({})", info["version"].as_str().unwrap_or("?"), info["hostname"].as_str().unwrap_or("?")))
        }
        IntegrationKind::HomeAssistant => {
            let body = json_ok(
                http.get(format!("{}/api/", c.url))
                    .bearer_auth(&r.secret)
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            Ok(body["message"].as_str().unwrap_or("Home Assistant joignable").to_string())
        }
        IntegrationKind::OpnSense => {
            let body = json_ok(
                http.get(format!("{}/api/core/firmware/status", c.url))
                    .basic_auth(&c.username, Some(&r.secret))
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            Ok(format!("OPNsense {}", body["product_version"].as_str().or(body["product"]["product_version"].as_str()).unwrap_or("joignable")))
        }
        IntegrationKind::MikroTik => {
            let body = json_ok(
                http.get(format!("{}/rest/system/resource", c.url))
                    .basic_auth(&c.username, Some(&r.secret))
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            Ok(format!("RouterOS {} ({})", body["version"].as_str().unwrap_or("?"), body["board-name"].as_str().unwrap_or("?")))
        }
        IntegrationKind::Pbs => {
            let body = json_ok(
                http.get(format!("{}/api2/json/version", c.url))
                    .header("Authorization", format!("PBSAPIToken={}:{}", c.username, r.secret))
                    .send()
                    .await
                    .map_err(|e| format!("Injoignable : {}", e))?,
            )
            .await?;
            Ok(format!("Proxmox Backup Server {}", body["data"]["version"].as_str().unwrap_or("?")))
        }
        IntegrationKind::Ntfy | IntegrationKind::Discord | IntegrationKind::Telegram => {
            notify::send(r, "Test Server Manager", "Les notifications fonctionnent.", false).await?;
            Ok("Message de test envoyé".into())
        }
    }
}
