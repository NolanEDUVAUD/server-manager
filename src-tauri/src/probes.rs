/// Sondes de services : HTTP(S) avec authentification et lecture JSON, port TCP,
/// expiration de certificat TLS. Sert aussi d'intégration générique : n'importe quel
/// service web peut être surveillé, avec un secret chiffré par la clé maître.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::net::TcpStream;

use zeroize::Zeroizing;

use crate::{
    alerts::AlertEngine,
    crypto,
    db::{Db, ProbeSample, DAY_MS},
    events::now_ms,
    integrations::http_client,
    storage::AppState,
};

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
        /// Chemin dans la réponse JSON (ex. « data.version », « items.0.state »)
        #[serde(default)]
        json_path: Option<String>,
        /// Valeur attendue à ce chemin ; absente = la valeur est seulement affichée
        #[serde(default)]
        json_expect: Option<String>,
    },
    Tcp { host: String, port: u16 },
    TlsExpiry { host: String, port: u16, warn_days: i64 },
}

/// Authentification d'une sonde HTTP. Le secret correspondant (mot de passe,
/// jeton, valeur d'en-tête) est stocké chiffré dans `Probe::secret`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(tag = "type")]
pub enum ProbeAuth {
    #[default]
    None,
    Basic { username: String },
    Bearer,
    /// En-tête personnalisé (ex. X-Api-Key, Authorization: PVEAPIToken=…)
    Header { name: String },
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
    #[serde(default)]
    pub auth: ProbeAuth,
    /// Secret chiffré (clé maître) ; jamais envoyé au frontend
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub secret: String,
    // ── Organisation (données seulement, voir organisation.rs) ────────────
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub favorite: bool,
}

/// Sonde telle que vue par le frontend : le secret est remplacé par un indicateur
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProbeView {
    #[serde(flatten)]
    pub probe: Probe,
    pub has_secret: bool,
}

impl From<&Probe> for ProbeView {
    fn from(p: &Probe) -> Self {
        let has_secret = !p.secret.is_empty();
        ProbeView { probe: Probe { secret: String::new(), ..p.clone() }, has_secret }
    }
}

/// Fixe le secret chiffré d'une sonde enregistrée :
/// `new_secret` None = garder l'ancien, Some("") = effacer, Some(x) = chiffrer x.
pub fn apply_secret(probe: &mut Probe, previous: Option<&Probe>, new_secret: Option<Zeroizing<String>>, key: &[u8; 32]) -> Result<(), String> {
    probe.secret = match (&probe.auth, new_secret) {
        (ProbeAuth::None, _) => String::new(),
        (_, Some(s)) if s.is_empty() => String::new(),
        (_, Some(s)) => crypto::encrypt(&s, key)?,
        (_, None) => previous.map(|p| p.secret.clone()).unwrap_or_default(),
    };
    if probe.auth != ProbeAuth::None && probe.secret.is_empty() {
        return Err("Secret requis pour cette authentification (mot de passe, jeton ou valeur d'en-tête)".into());
    }
    Ok(())
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
    /// Disponibilité sur les dernières 24 h (%), d'après l'historique en base
    pub uptime_percent: f64,
}

impl ProbeResult {
    fn from_sample(s: ProbeSample, uptime_percent: f64) -> Self {
        ProbeResult {
            probe_id: s.probe_id,
            ok: s.ok,
            latency_ms: s.latency_ms,
            detail: s.detail,
            checked_at: s.ts,
            cert_days_left: s.cert_days_left,
            uptime_percent,
        }
    }
}

pub fn validate(probe: &Probe) -> Result<(), String> {
    if probe.name.trim().is_empty() {
        return Err("Le nom de la sonde est requis".into());
    }
    if probe.interval_secs < 10 {
        return Err("Intervalle minimum : 10 secondes".into());
    }
    match &probe.auth {
        ProbeAuth::Basic { username } if username.trim().is_empty() => return Err("Nom d'utilisateur requis".into()),
        ProbeAuth::Header { name } => validate_header_name(name)?,
        _ => {}
    }
    if probe.auth != ProbeAuth::None && !matches!(probe.kind, ProbeKind::Http { .. }) {
        return Err("L'authentification ne concerne que les sondes HTTP".into());
    }
    match &probe.kind {
        ProbeKind::Http { url, json_path, .. } => {
            crate::integrations::validate_url(url)?;
            if url.trim().is_empty() {
                return Err("URL requise".into());
            }
            if let Some(p) = json_path.as_deref().filter(|p| !p.trim().is_empty()) {
                if p.len() > 200 || !p.chars().all(|c| c.is_alphanumeric() || "._-".contains(c)) {
                    return Err("Chemin JSON invalide (ex. data.version ou items.0.state)".into());
                }
            }
            Ok(())
        }
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

/// Nom d'en-tête HTTP valide, hors en-têtes gérés par le client lui-même
fn validate_header_name(name: &str) -> Result<(), String> {
    let n = name.trim();
    reqwest::header::HeaderName::from_bytes(n.as_bytes()).map_err(|_| format!("Nom d'en-tête invalide : {}", n))?;
    if ["host", "content-length", "transfer-encoding", "connection"].contains(&n.to_ascii_lowercase().as_str()) {
        return Err(format!("En-tête réservé : {}", n));
    }
    Ok(())
}

/// Valeur d'un chemin « a.b.0.c » dans un document JSON, sous forme de texte
pub fn json_lookup(doc: &serde_json::Value, path: &str) -> Option<String> {
    let mut cur = doc;
    for part in path.split('.').filter(|p| !p.is_empty()) {
        cur = match cur {
            serde_json::Value::Array(a) => a.get(part.parse::<usize>().ok()?)?,
            serde_json::Value::Object(o) => o.get(part)?,
            _ => return None,
        };
    }
    Some(match cur {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

/// Compare la valeur lue dans le JSON à l'attente (insensible à la casse)
pub fn judge_json(body: &str, path: &str, expect: Option<&str>) -> Result<String, String> {
    let doc: serde_json::Value = serde_json::from_str(body).map_err(|_| "Réponse non JSON".to_string())?;
    let value = json_lookup(&doc, path).ok_or_else(|| format!("« {} » absent de la réponse", path))?;
    let shown: String = value.chars().take(60).collect();
    match expect.map(str::trim).filter(|e| !e.is_empty()) {
        Some(e) if !value.eq_ignore_ascii_case(e) => Err(format!("{} = {} (attendu {})", path, shown, e)),
        _ => Ok(format!("{} = {}", path, shown)),
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

/// Requête HTTP authentifiée. Les en-têtes d'authentification sont marqués sensibles
/// (jamais journalisés) et les redirections sont refusées : un en-tête personnalisé
/// ne doit pas pouvoir être relayé vers un autre hôte.
fn http_request(probe: &Probe, url: &str, secret: Option<&str>) -> Result<reqwest::RequestBuilder, String> {
    let client = match (&probe.auth, secret) {
        (ProbeAuth::None, _) | (_, None) => http_client(probe.verify_tls, 10)?,
        _ => reqwest::Client::builder()
            .danger_accept_invalid_certs(!probe.verify_tls)
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| format!("Client HTTP : {}", e))?,
    };
    let req = client.get(url);
    Ok(match (&probe.auth, secret) {
        (ProbeAuth::Basic { username }, Some(s)) => req.basic_auth(username.trim(), Some(s)),
        (ProbeAuth::Bearer, Some(s)) => req.bearer_auth(s),
        (ProbeAuth::Header { name }, Some(s)) => {
            let mut value = reqwest::header::HeaderValue::from_str(s).map_err(|_| "Valeur d'en-tête invalide".to_string())?;
            value.set_sensitive(true);
            req.header(name.trim(), value)
        }
        _ => req,
    })
}

async fn run(probe: &Probe, secret: Option<&str>) -> Outcome {
    let start = Instant::now();
    let elapsed = |s: Instant| Some(s.elapsed().as_millis() as u64);
    match &probe.kind {
        ProbeKind::Http { url, expect_status, keyword, json_path, json_expect } => {
            let req = match http_request(probe, url, secret) {
                Ok(r) => r,
                Err(e) => return Outcome { ok: false, latency_ms: None, detail: e, cert_days_left: None },
            };
            let json_path = json_path.as_deref().map(str::trim).filter(|p| !p.is_empty());
            match req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let latency = elapsed(start);
                    let needs_body = json_path.is_some() || keyword.as_deref().is_some_and(|k| !k.trim().is_empty());
                    let body = if needs_body { resp.text().await.unwrap_or_default() } else { String::new() };
                    let verdict = judge_http(status, &body, *expect_status, keyword.as_deref()).and_then(|d| match json_path {
                        Some(p) => judge_json(&body, p, json_expect.as_deref()).map(|j| format!("{} · {}", d, j)),
                        None => Ok(d),
                    });
                    match verdict {
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

/// État en mémoire : dernier passage et dernier résultat de chaque sonde
/// (l'historique complet est en base, voir db.rs)
#[derive(Default)]
pub struct ProbeState {
    last_run: Mutex<HashMap<String, Instant>>,
    latest: Mutex<HashMap<String, ProbeResult>>,
}

impl ProbeState {
    pub fn latest(&self) -> Vec<ProbeResult> {
        self.latest.lock().map(|m| m.values().cloned().collect()).unwrap_or_default()
    }
    pub fn forget(&self, id: &str) {
        if let Ok(mut m) = self.latest.lock() { m.remove(id); }
        if let Ok(mut m) = self.last_run.lock() { m.remove(id); }
    }

    /// Au démarrage : derniers résultats connus des sondes existantes, relus en base,
    /// pour que la page Services les affiche avant le prochain contrôle.
    pub fn restore(&self, db: &Db, probe_ids: &[String], now: i64) {
        let samples = match db.latest_probe_samples() {
            Ok(s) => s,
            Err(e) => return log::warn!("{}", e),
        };
        let Ok(mut latest) = self.latest.lock() else { return };
        for s in samples.into_iter().filter(|s| probe_ids.contains(&s.probe_id)) {
            let uptime = db.probe_uptime(&s.probe_id, now - DAY_MS).unwrap_or(100.0);
            latest.insert(s.probe_id.clone(), ProbeResult::from_sample(s, uptime));
        }
    }
}

/// Exécute une sonde, met à jour l'état, prévient le moteur d'alertes et le frontend
pub async fn execute(app: &AppHandle, probe: &Probe) -> ProbeResult {
    // Secret déchiffré juste pour la requête, effacé de la mémoire ensuite (Zeroizing)
    let secret: Result<Option<Zeroizing<String>>, String> = if probe.secret.is_empty() {
        Ok(None)
    } else {
        app.state::<AppState>()
            .data
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|d| crypto::data_key(&d))
            .and_then(|key| crypto::decrypt(&probe.secret, &key))
            .map(|s| Some(Zeroizing::new(s)))
    };
    let outcome = match &secret {
        Ok(s) => run(probe, s.as_deref().map(String::as_str)).await,
        Err(_) => Outcome { ok: false, latency_ms: None, detail: "Secret illisible : ressaisis-le dans la sonde".into(), cert_days_left: None },
    };
    let sample = ProbeSample {
        probe_id: probe.id.clone(),
        ts: now_ms(),
        ok: outcome.ok,
        latency_ms: outcome.latency_ms,
        detail: outcome.detail.clone(),
        cert_days_left: outcome.cert_days_left,
    };
    // Historique persistant ; la disponibilité affichée porte sur les dernières 24 h
    let db = app.state::<Db>();
    if let Err(e) = db.record_probe(&sample) {
        log::warn!("{}", e);
    }
    let uptime_percent = db.probe_uptime(&probe.id, sample.ts - DAY_MS).unwrap_or(if outcome.ok { 100.0 } else { 0.0 });
    let result = ProbeResult::from_sample(sample, uptime_percent);
    let st = app.state::<ProbeState>();
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
    fn json_lookup_and_judgement() {
        let body = r#"{"data":{"version":"8.2.4","nodes":[{"state":"online"}]},"installed":true}"#;
        let doc: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(json_lookup(&doc, "data.version").as_deref(), Some("8.2.4"));
        assert_eq!(json_lookup(&doc, "data.nodes.0.state").as_deref(), Some("online"));
        assert_eq!(json_lookup(&doc, "installed").as_deref(), Some("true"));
        assert_eq!(json_lookup(&doc, "data.nodes.3"), None);
        assert_eq!(judge_json(body, "data.version", None).unwrap(), "data.version = 8.2.4");
        assert!(judge_json(body, "installed", Some("TRUE")).is_ok());
        assert!(judge_json(body, "data.nodes.0.state", Some("offline")).unwrap_err().contains("attendu offline"));
        assert!(judge_json("<html>", "a", None).unwrap_err().contains("non JSON"));
    }

    fn http_probe(auth: ProbeAuth) -> Probe {
        Probe {
            id: "p".into(),
            name: "API".into(),
            enabled: true,
            kind: ProbeKind::Http { url: "https://svc.local/api".into(), expect_status: None, keyword: None, json_path: None, json_expect: None },
            server_id: None,
            interval_secs: 60,
            verify_tls: true,
            auth,
            secret: String::new(),
            tag_ids: Vec::new(),
            folder_id: None,
            favorite: false,
        }
    }

    #[test]
    fn secret_is_encrypted_kept_cleared_and_never_exposed() {
        let key = crypto::generate_key();
        let mut p = http_probe(ProbeAuth::Bearer);
        // Nouveau secret : chiffré, jamais en clair
        apply_secret(&mut p, None, Some(Zeroizing::new("tok-123".into())), &key).unwrap();
        assert!(!p.secret.contains("tok-123"));
        assert_eq!(crypto::decrypt(&p.secret, &key).unwrap(), "tok-123");
        // Vue frontend : aucun secret, seulement l'indicateur
        let view = serde_json::to_string(&ProbeView::from(&p)).unwrap();
        assert!(!view.contains(&p.secret) && view.contains("\"has_secret\":true"), "{}", view);
        // Modification sans ressaisie : le secret est conservé
        let previous = p.clone();
        let mut edited = http_probe(ProbeAuth::Bearer);
        apply_secret(&mut edited, Some(&previous), None, &key).unwrap();
        assert_eq!(edited.secret, previous.secret);
        // Passage à « aucune authentification » : secret effacé
        let mut none = http_probe(ProbeAuth::None);
        apply_secret(&mut none, Some(&previous), None, &key).unwrap();
        assert!(none.secret.is_empty());
        // Authentification sans secret : refusée
        let mut missing = http_probe(ProbeAuth::Bearer);
        assert!(apply_secret(&mut missing, None, None, &key).is_err());
    }

    #[test]
    fn auth_validation() {
        assert!(validate(&http_probe(ProbeAuth::Header { name: "X-Api-Key".into() })).is_ok());
        assert!(validate(&http_probe(ProbeAuth::Header { name: "Bad Header".into() })).is_err());
        assert!(validate(&http_probe(ProbeAuth::Header { name: "Host".into() })).is_err());
        assert!(validate(&http_probe(ProbeAuth::Basic { username: " ".into() })).is_err());
        let mut p = http_probe(ProbeAuth::None);
        p.kind = ProbeKind::Http { url: "https://x".into(), expect_status: None, keyword: None, json_path: Some("data.$eval".into()), json_expect: None };
        assert!(validate(&p).is_err());
    }

    #[test]
    fn custom_header_is_sensitive_and_redirects_are_refused() {
        let p = http_probe(ProbeAuth::Header { name: "X-Api-Key".into() });
        let req = http_request(&p, "https://svc.local/api", Some("k3y")).unwrap().build().unwrap();
        let h = req.headers().get("x-api-key").unwrap();
        assert!(h.is_sensitive());
        assert!(!format!("{:?}", req.headers()).contains("k3y"));
    }

    #[test]
    fn cert_days() {
        assert_eq!(days_left(10 * 86_400 + 5, 0), 10);
        assert_eq!(days_left(-1, 0), -1);
    }

    #[test]
    fn latest_results_are_restored_from_the_database() {
        let db = Db::in_memory();
        let now = 10 * DAY_MS;
        for (probe_id, ts, ok) in [("p", now - 2000, true), ("p", now - 1000, false), ("deleted", now - 500, true)] {
            db.record_probe(&ProbeSample { probe_id: probe_id.into(), ts, ok, latency_ms: Some(7), detail: format!("contrôle {}", ts), cert_days_left: None }).unwrap();
        }
        let st = ProbeState::default();
        st.restore(&db, &["p".to_string()], now);
        let latest = st.latest();
        // La sonde supprimée depuis n'est pas restaurée
        assert_eq!(latest.len(), 1);
        assert_eq!((latest[0].ok, latest[0].checked_at, latest[0].uptime_percent), (false, now - 1000, 50.0));
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
            auth: ProbeAuth::None,
            secret: String::new(),
            tag_ids: Vec::new(),
            folder_id: None,
            favorite: false,
        };
        assert!(validate(&p).is_ok());
        p.interval_secs = 5;
        assert!(validate(&p).is_err());
        p.interval_secs = 60;
        p.kind = ProbeKind::Http { url: "ftp://x".into(), expect_status: None, keyword: None, json_path: None, json_expect: None };
        assert!(validate(&p).is_err());
        p.kind = ProbeKind::TlsExpiry { host: "a b".into(), port: 443, warn_days: 14 };
        assert!(validate(&p).is_err());
    }
}
