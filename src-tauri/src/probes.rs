/// Sondes de services : HTTP(S), port TCP, expiration de certificat TLS
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpStream;

use crate::{alerts::AlertEngine, events::now_ms, integrations::http_client, storage::AppState};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum ProbeKind {
    Http {
        url: String,
        /// Code HTTP attendu ; None = n'importe quel 2xx/3xx
        #[serde(default)]
        expect_status: Option<u16>,
        /// Texte qui doit apparaître dans la réponse
        #[serde(default)]
        keyword: Option<String>,
    },
    Tcp { host: String, port: u16 },
    TlsExpiry { host: String, port: u16, warn_days: i64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Probe {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub kind: ProbeKind,
    /// Serveur associé (pour cibler les règles d'alerte et regrouper l'affichage)
    #[serde(default)]
    pub server_id: Option<String>,
    pub interval_secs: u64,
    #[serde(default)]
    pub verify_tls: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProbeResult {
    pub probe_id: String,
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub detail: String,
    pub checked_at: i64,
    /// Jours avant expiration du certificat (sondes TLS)
    pub cert_days_left: Option<i64>,
    /// Disponibilité sur les derniers contrôles (%)
    pub uptime_percent: f64,
}

/// Nombre de contrôles gardés en mémoire pour le calcul de disponibilité
const HISTORY: usize = 120;

pub fn validate(probe: &Probe) -> Result<(), String> {
    if probe.name.trim().is_empty() {
        return Err("Le nom de la sonde est requis".into());
    }
    if probe.interval_secs < 10 {
        return Err("Intervalle minimum : 10 secondes".into());
    }
    match &probe.kind {
        ProbeKind::Http { url, .. } => crate::integrations::validate_url(url).and_then(|_| {
            if url.trim().is_empty() { Err("URL requise".into()) } else { Ok(()) }
        }),
        ProbeKind::Tcp { host, port } | ProbeKind::TlsExpiry { host, port, .. } => {
            if host.trim().is_empty() || host.contains(char::is_whitespace) {
                Err("Hôte invalide".into())
            } else if *port == 0 {
                Err("Port invalide".into())
            } else {
                Ok(())
            }
        }
    }
}

/// Évalue une réponse HTTP par rapport aux attentes de la sonde
pub fn judge_http(status: u16, body: &str, expect_status: Option<u16>, keyword: Option<&str>) -> Result<String, String> {
    let status_ok = match expect_status {
        Some(code) => status == code,
        None => (200..400).contains(&status),
    };
    if !status_ok {
        return Err(match expect_status {
            Some(code) => format!("HTTP {} (attendu {})", status, code),
            None => format!("HTTP {}", status),
        });
    }
    match keyword.map(str::trim).filter(|k| !k.is_empty()) {
        Some(k) if !body.contains(k) => Err(format!("HTTP {}, mot-clé « {} » absent", status, k)),
        _ => Ok(format!("HTTP {}", status)),
    }
}

/// Jours restants avant expiration (arrondi vers le bas)
pub fn days_left(not_after_unix: i64, now_unix: i64) -> i64 {
    (not_after_unix - now_unix).div_euclid(86_400)
}

pub fn uptime(history: &VecDeque<bool>) -> f64 {
    if history.is_empty() {
        return 100.0;
    }
    history.iter().filter(|ok| **ok).count() as f64 * 100.0 / history.len() as f64
}

// ── Exécution ─────────────────────────────────────────────────────────────

struct Outcome {
    ok: bool,
    latency_ms: Option<u64>,
    detail: String,
    cert_days_left: Option<i64>,
}

async fn tls_not_after(host: &str, port: u16) -> Result<i64, String> {
    let tcp = tokio::time::timeout(Duration::from_secs(8), TcpStream::connect((host, port)))
        .await
        .map_err(|_| "Délai dépassé".to_string())?
        .map_err(|e| format!("Connexion impossible : {}", e))?;
    // On accepte un certificat non valide : le but est d'en lire la date, pas de le valider
    let connector = native_tls_connector()?;
    let stream = tokio::time::timeout(Duration::from_secs(8), connector.connect(host, tcp))
        .await
        .map_err(|_| "Négociation TLS trop longue".to_string())?
        .map_err(|e| format!("TLS : {}", e))?;
    let cert = stream
        .get_ref()
        .peer_certificate()
        .map_err(|e| e.to_string())?
        .ok_or("Aucun certificat présenté")?;
    let der = cert.to_der().map_err(|e| e.to_string())?;
    let (_, parsed) = x509_parser::parse_x509_certificate(&der).map_err(|e| format!("Certificat illisible : {}", e))?;
    Ok(parsed.validity().not_after.timestamp())
}

fn native_tls_connector() -> Result<tokio_native_tls::TlsConnector, String> {
    tokio_native_tls::native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map(tokio_native_tls::TlsConnector::from)
        .map_err(|e| e.to_string())
}

async fn run(probe: &Probe) -> Outcome {
    let start = Instant::now();
    let elapsed = |s: Instant| Some(s.elapsed().as_millis() as u64);
    match &probe.kind {
        ProbeKind::Http { url, expect_status, keyword } => {
            let client = match http_client(probe.verify_tls, 10) {
                Ok(c) => c,
                Err(e) => return Outcome { ok: false, latency_ms: None, detail: e, cert_days_left: None },
            };
            match client.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let latency = elapsed(start);
                    let body = if keyword.as_deref().map_or(false, |k| !k.trim().is_empty()) {
                        resp.text().await.unwrap_or_default()
                    } else {
                        String::new()
                    };
                    match judge_http(status, &body, *expect_status, keyword.as_deref()) {
                        Ok(d) => Outcome { ok: true, latency_ms: latency, detail: d, cert_days_left: None },
                        Err(d) => Outcome { ok: false, latency_ms: latency, detail: d, cert_days_left: None },
                    }
                }
                Err(e) => Outcome { ok: false, latency_ms: None, detail: format!("Injoignable : {}", crate::integrations::describe_http_error(&e)), cert_days_left: None },
            }
        }
        ProbeKind::Tcp { host, port } => {
            match tokio::time::timeout(Duration::from_secs(5), TcpStream::connect((host.as_str(), *port))).await {
                Ok(Ok(_)) => Outcome { ok: true, latency_ms: elapsed(start), detail: format!("Port {} ouvert", port), cert_days_left: None },
                Ok(Err(e)) => Outcome { ok: false, latency_ms: None, detail: format!("Port {} fermé : {}", port, e), cert_days_left: None },
                Err(_) => Outcome { ok: false, latency_ms: None, detail: format!("Port {} : délai dépassé", port), cert_days_left: None },
            }
        }
        ProbeKind::TlsExpiry { host, port, warn_days } => match tls_not_after(host, *port).await {
            Ok(not_after) => {
                let days = days_left(not_after, now_ms() / 1000);
                let ok = days > *warn_days;
                let detail = if days < 0 {
                    format!("Certificat EXPIRÉ depuis {} j", -days)
                } else {
                    format!("Certificat valable encore {} j", days)
                };
                Outcome { ok, latency_ms: elapsed(start), detail, cert_days_left: Some(days) }
            }
            Err(e) => Outcome { ok: false, latency_ms: None, detail: e, cert_days_left: None },
        },
    }
}

/// État en mémoire : dernier passage et historique de chaque sonde
#[derive(Default)]
pub struct ProbeState {
    last_run: Mutex<HashMap<String, Instant>>,
    history: Mutex<HashMap<String, VecDeque<bool>>>,
    latest: Mutex<HashMap<String, ProbeResult>>,
}

impl ProbeState {
    pub fn latest(&self) -> Vec<ProbeResult> {
        self.latest.lock().map(|m| m.values().cloned().collect()).unwrap_or_default()
    }
    pub fn forget(&self, id: &str) {
        if let Ok(mut m) = self.latest.lock() { m.remove(id); }
        if let Ok(mut m) = self.history.lock() { m.remove(id); }
        if let Ok(mut m) = self.last_run.lock() { m.remove(id); }
    }
}

/// Exécute une sonde, met à jour l'état, prévient le moteur d'alertes et le frontend
pub async fn execute(app: &AppHandle, probe: &Probe) -> ProbeResult {
    let outcome = run(probe).await;
    let st = app.state::<ProbeState>();
    let uptime_percent = {
        let mut h = st.history.lock().unwrap_or_else(|e| e.into_inner());
        let entry = h.entry(probe.id.clone()).or_default();
        entry.push_back(outcome.ok);
        while entry.len() > HISTORY {
            entry.pop_front();
        }
        uptime(entry)
    };
    let result = ProbeResult {
        probe_id: probe.id.clone(),
        ok: outcome.ok,
        latency_ms: outcome.latency_ms,
        detail: outcome.detail.clone(),
        checked_at: now_ms(),
        cert_days_left: outcome.cert_days_left,
        uptime_percent,
    };
    if let Ok(mut l) = st.latest.lock() {
        l.insert(probe.id.clone(), result.clone());
    }
    app.state::<AlertEngine>().on_probe(&probe.id, &probe.name, probe.server_id.as_deref(), outcome.ok, &outcome.detail);
    let _ = app.emit("probe-result", &result);
    result
}

/// Boucle : vérifie toutes les 5 s quelles sondes sont dues selon leur intervalle
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let due: Vec<Probe> = {
                let probes = app.state::<AppState>().data.lock().map(|d| d.probes.clone()).unwrap_or_default();
                let st = app.state::<ProbeState>();
                let mut last = st.last_run.lock().unwrap_or_else(|e| e.into_inner());
                let now = Instant::now();
                let due: Vec<Probe> = probes
                    .into_iter()
                    .filter(|p| p.enabled)
                    .filter(|p| last.get(&p.id).map_or(true, |t| now.duration_since(*t) >= Duration::from_secs(p.interval_secs)))
                    .collect();
                for p in &due {
                    last.insert(p.id.clone(), now);
                }
                due
            };
            for probe in due {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    execute(&app, &probe).await;
                });
            }
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_judgement() {
        assert!(judge_http(200, "", None, None).is_ok());
        assert!(judge_http(302, "", None, None).is_ok());
        assert_eq!(judge_http(503, "", None, None).unwrap_err(), "HTTP 503");
        assert!(judge_http(401, "", Some(401), None).is_ok());
        assert_eq!(judge_http(200, "", Some(204), None).unwrap_err(), "HTTP 200 (attendu 204)");
        assert!(judge_http(200, "Loki ready", None, Some("ready")).is_ok());
        assert!(judge_http(200, "starting", None, Some("ready")).unwrap_err().contains("absent"));
        assert!(judge_http(200, "x", None, Some("  ")).is_ok());
    }

    #[test]
    fn cert_days_and_uptime() {
        assert_eq!(days_left(10 * 86_400 + 5, 0), 10);
        assert_eq!(days_left(-1, 0), -1);
        let h: VecDeque<bool> = [true, true, false, true].into_iter().collect();
        assert_eq!(uptime(&h), 75.0);
        assert_eq!(uptime(&VecDeque::new()), 100.0);
    }

    #[test]
    fn validation() {
        let mut p = Probe {
            id: String::new(),
            name: "Proxmox".into(),
            enabled: true,
            kind: ProbeKind::Tcp { host: "192.168.50.53".into(), port: 8006 },
            server_id: None,
            interval_secs: 60,
            verify_tls: false,
        };
        assert!(validate(&p).is_ok());
        p.interval_secs = 5;
        assert!(validate(&p).is_err());
        p.interval_secs = 60;
        p.kind = ProbeKind::Http { url: "ftp://x".into(), expect_status: None, keyword: None };
        assert!(validate(&p).is_err());
        p.kind = ProbeKind::TlsExpiry { host: "a b".into(), port: 443, warn_days: 14 };
        assert!(validate(&p).is_err());
    }
}
