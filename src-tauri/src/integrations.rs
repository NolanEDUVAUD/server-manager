/// Intégrations de services externes (Zabbix, Loki, NPM, TrueNAS, Home Assistant,
/// OPNsense, MikroTik, ntfy, Discord, Telegram, PBS) : configuration commune.
/// Les secrets sont chiffrés avec la clé maître, comme les mots de passe SSH.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

use crate::{crypto, models::AppData};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum IntegrationKind {
    Zabbix,
    Loki,
    Npm,
    TrueNas,
    HomeAssistant,
    OpnSense,
    MikroTik,
    Ntfy,
    Discord,
    Telegram,
    Pbs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Integration {
    pub kind: IntegrationKind,
    pub enabled: bool,
    pub url: String,
    #[serde(default)]
    pub username: String,
    /// Chiffré (clé maître) ; jamais renvoyé au frontend
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub verify_tls: bool,
    /// Champs propres à un service (topic ntfy, chat_id Telegram…)
    #[serde(default)]
    pub extra: HashMap<String, String>,
}

/// Vue envoyée au frontend : le secret est remplacé par un simple indicateur
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct IntegrationView {
    pub kind: IntegrationKind,
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub has_secret: bool,
    pub verify_tls: bool,
    pub extra: HashMap<String, String>,
}

impl From<&Integration> for IntegrationView {
    fn from(i: &Integration) -> Self {
        IntegrationView {
            kind: i.kind,
            enabled: i.enabled,
            url: i.url.clone(),
            username: i.username.clone(),
            has_secret: !i.secret.is_empty(),
            verify_tls: i.verify_tls,
            extra: i.extra.clone(),
        }
    }
}

/// Données reçues du frontend. `secret` : None = inchangé, Some("") = effacé.
#[derive(Debug, Clone, Deserialize)]
pub struct IntegrationPayload {
    pub kind: IntegrationKind,
    pub enabled: bool,
    pub url: String,
    #[serde(default)]
    pub username: String,
    pub secret: Option<String>,
    #[serde(default)]
    pub verify_tls: bool,
    #[serde(default)]
    pub extra: HashMap<String, String>,
}

pub fn validate_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Ok(());
    }
    if !(url.starts_with("http://") || url.starts_with("https://")) || url.contains(char::is_whitespace) {
        return Err(format!("URL invalide : {} (http:// ou https:// attendu)", url));
    }
    Ok(())
}

/// Applique un payload à la liste (création ou mise à jour), en chiffrant le nouveau secret.
pub fn apply_payload(list: &mut Vec<Integration>, payload: IntegrationPayload, key: &[u8; 32]) -> Result<(), String> {
    validate_url(&payload.url)?;
    let secret = match &payload.secret {
        Some(s) if !s.is_empty() => Some(crypto::encrypt(s, key)?),
        Some(_) => Some(String::new()),
        None => None,
    };
    let url = payload.url.trim().trim_end_matches('/').to_string();
    match list.iter_mut().find(|i| i.kind == payload.kind) {
        Some(existing) => {
            existing.enabled = payload.enabled;
            existing.url = url;
            existing.username = payload.username.trim().to_string();
            existing.verify_tls = payload.verify_tls;
            existing.extra = payload.extra;
            if let Some(s) = secret {
                existing.secret = s;
            }
        }
        None => list.push(Integration {
            kind: payload.kind,
            enabled: payload.enabled,
            url,
            username: payload.username.trim().to_string(),
            secret: secret.unwrap_or_default(),
            verify_tls: payload.verify_tls,
            extra: payload.extra,
        }),
    }
    Ok(())
}

/// Intégration active avec son secret déchiffré, prête à l'emploi par une fonctionnalité.
pub struct Resolved {
    pub config: Integration,
    pub secret: String,
}

/// Discord et Telegram n'ont pas d'URL de serveur : tout est dans le secret
pub fn needs_url(kind: IntegrationKind) -> bool {
    !matches!(kind, IntegrationKind::Discord | IntegrationKind::Telegram)
}

/// URL de l'API JSON-RPC de Zabbix, que l'utilisateur ait saisi la racine ou le fichier
pub fn zabbix_api_url(url: &str) -> String {
    if url.ends_with("api_jsonrpc.php") {
        url.to_string()
    } else {
        format!("{}/api_jsonrpc.php", url.trim_end_matches('/'))
    }
}

pub fn resolve(data: &AppData, kind: IntegrationKind) -> Result<Resolved, String> {
    let config = data
        .integrations
        .iter()
        .find(|i| i.kind == kind)
        .filter(|i| i.enabled && (!i.url.is_empty() || !needs_url(kind)))
        .cloned()
        .ok_or_else(|| format!("Intégration {:?} non configurée ou désactivée (Paramètres → Intégrations)", kind))?;
    let secret = crypto::decrypt(&config.secret, &crypto::data_key(data)?)?;
    Ok(Resolved { config, secret })
}

pub fn http_client(verify_tls: bool, timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(!verify_tls)
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("Client HTTP : {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(secret: Option<&str>) -> IntegrationPayload {
        IntegrationPayload {
            kind: IntegrationKind::Zabbix,
            enabled: true,
            url: " http://zabbix.lan/zabbix/ ".into(),
            username: String::new(),
            secret: secret.map(str::to_string),
            verify_tls: false,
            extra: HashMap::new(),
        }
    }

    #[test]
    fn secret_is_encrypted_kept_or_cleared() {
        let key = crypto::generate_key();
        let mut list = Vec::new();
        apply_payload(&mut list, payload(Some("tok")), &key).unwrap();
        assert_eq!(list[0].url, "http://zabbix.lan/zabbix");
        assert_ne!(list[0].secret, "tok");
        assert_eq!(crypto::decrypt(&list[0].secret, &key).unwrap(), "tok");

        // None : secret inchangé
        let before = list[0].secret.clone();
        apply_payload(&mut list, payload(None), &key).unwrap();
        assert_eq!(list[0].secret, before);
        assert_eq!(list.len(), 1);

        // Some("") : secret effacé
        apply_payload(&mut list, payload(Some("")), &key).unwrap();
        assert_eq!(list[0].secret, "");
    }

    #[test]
    fn view_never_exposes_the_secret() {
        let key = crypto::generate_key();
        let mut list = Vec::new();
        apply_payload(&mut list, payload(Some("tok")), &key).unwrap();
        let view = IntegrationView::from(&list[0]);
        assert!(view.has_secret);
        assert!(!serde_json::to_string(&view).unwrap().contains(&list[0].secret));
    }

    #[test]
    fn zabbix_url_accepts_root_or_endpoint() {
        assert_eq!(zabbix_api_url("http://z/zabbix"), "http://z/zabbix/api_jsonrpc.php");
        assert_eq!(zabbix_api_url("http://z/zabbix/api_jsonrpc.php"), "http://z/zabbix/api_jsonrpc.php");
    }

    #[test]
    fn urls_are_validated() {
        assert!(validate_url("https://a.b:8443").is_ok());
        assert!(validate_url("").is_ok());
        assert!(validate_url("ftp://x").is_err());
        assert!(validate_url("http://a b").is_err());
    }
}
