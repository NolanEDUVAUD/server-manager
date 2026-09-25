/// Base locale SQLite (`history.db`) : historique des événements, mesures brutes
/// (pings, sondes, métriques) et leurs agrégats horaires. La configuration et ses
/// secrets chiffrés restent dans data.json : cette base ne contient aucun secret.
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::events::{now_ms, Event, EventKind};
use crate::metrics::ServerMetrics;
use crate::models::HistorySettings;

pub const HOUR_MS: i64 = 3_600_000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// Nombre d'événements renvoyés par défaut / au plus par `get_events`
pub const DEFAULT_EVENTS_PAGE: u32 = 5_000;
pub const MAX_EVENTS_PAGE: u32 = 10_000;

/// Textes libres tronqués avant écriture (la base ne doit pas gonfler sans limite)
const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_DETAIL_CHARS: usize = 300;
const MAX_TARGET_CHARS: usize = 200;

/// Au-delà, l'ancien events.json n'est pas désérialisé (il plafonnait à 5 000 événements, ~1 Mio)
const MAX_LEGACY_EVENTS_BYTES: u64 = 20 * 1024 * 1024;

/// Migrations versionnées : l'élément i fait passer `PRAGMA user_version` de i à i + 1.
/// Une migration publiée n'est plus jamais modifiée ; toute évolution du schéma
/// s'ajoute en fin de liste.
const MIGRATIONS: &[&str] = &[
    // v1 : schéma initial
    r#"
    CREATE TABLE events (
        id        TEXT PRIMARY KEY,
        ts        INTEGER NOT NULL,
        kind      TEXT NOT NULL,
        server_id TEXT,
        target    TEXT NOT NULL,
        message   TEXT NOT NULL
    );
    CREATE INDEX idx_events_ts ON events (ts);
    CREATE INDEX idx_events_server_ts ON events (server_id, ts);

    CREATE TABLE ping_samples (
        server_id  TEXT NOT NULL,
        ts         INTEGER NOT NULL,
        online     INTEGER NOT NULL,
        latency_ms INTEGER
    );
    CREATE INDEX idx_ping_samples_server_ts ON ping_samples (server_id, ts);
    CREATE INDEX idx_ping_samples_ts ON ping_samples (ts);

    CREATE TABLE probe_samples (
        probe_id       TEXT NOT NULL,
        ts             INTEGER NOT NULL,
        ok             INTEGER NOT NULL,
        latency_ms     INTEGER,
        detail         TEXT NOT NULL,
        cert_days_left INTEGER
    );
    CREATE INDEX idx_probe_samples_probe_ts ON probe_samples (probe_id, ts);
    CREATE INDEX idx_probe_samples_ts ON probe_samples (ts);

    CREATE TABLE metric_samples (
        server_id   TEXT NOT NULL,
        ts          INTEGER NOT NULL,
        cpu_percent REAL NOT NULL,
        mem_percent REAL NOT NULL,
        disk_percent REAL,
        load1       REAL NOT NULL,
        cpu_temp    REAL
    );
    CREATE INDEX idx_metric_samples_server_ts ON metric_samples (server_id, ts);
    CREATE INDEX idx_metric_samples_ts ON metric_samples (ts);

    CREATE TABLE ping_hourly (
        server_id     TEXT NOT NULL,
        hour          INTEGER NOT NULL,
        checks        INTEGER NOT NULL,
        ok            INTEGER NOT NULL,
        latency_sum   INTEGER NOT NULL,
        latency_count INTEGER NOT NULL,
        latency_max   INTEGER,
        PRIMARY KEY (server_id, hour)
    ) WITHOUT ROWID;
    CREATE INDEX idx_ping_hourly_hour ON ping_hourly (hour);

    CREATE TABLE probe_hourly (
        probe_id      TEXT NOT NULL,
        hour          INTEGER NOT NULL,
        checks        INTEGER NOT NULL,
        ok            INTEGER NOT NULL,
        latency_sum   INTEGER NOT NULL,
        latency_count INTEGER NOT NULL,
        latency_max   INTEGER,
        PRIMARY KEY (probe_id, hour)
    ) WITHOUT ROWID;
    CREATE INDEX idx_probe_hourly_hour ON probe_hourly (hour);

    CREATE TABLE metric_hourly (
        server_id TEXT NOT NULL,
        hour      INTEGER NOT NULL,
        samples   INTEGER NOT NULL,
        cpu_sum   REAL NOT NULL,
        cpu_max   REAL NOT NULL,
        mem_sum   REAL NOT NULL,
        mem_max   REAL NOT NULL,
        disk_max  REAL,
        temp_max  REAL,
        PRIMARY KEY (server_id, hour)
    ) WITHOUT ROWID;
    CREATE INDEX idx_metric_hourly_hour ON metric_hourly (hour);
    "#,
];

/// Version du schéma attendue par cette version de l'app
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

/// Mise à jour de l'agrégat horaire d'une mesure « succès / latence » (pings et sondes).
/// Dans `DO UPDATE`, les colonnes non préfixées désignent la ligne existante.
fn check_hourly_upsert(table: &str, id_col: &str) -> String {
    format!(
        "INSERT INTO {table} ({id_col}, hour, checks, ok, latency_sum, latency_count, latency_max)
         VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6)
         ON CONFLICT ({id_col}, hour) DO UPDATE SET
             checks = checks + 1,
             ok = ok + excluded.ok,
             latency_sum = latency_sum + excluded.latency_sum,
             latency_count = latency_count + excluded.latency_count,
             latency_max = CASE
                 WHEN excluded.latency_max IS NULL THEN latency_max
                 WHEN latency_max IS NULL OR excluded.latency_max > latency_max THEN excluded.latency_max
                 ELSE latency_max END"
    )
}

// ── Types échangés ────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ProbeSample {
    pub probe_id: String,
    pub ts: i64,
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub detail: String,
    pub cert_days_left: Option<i64>,
}

/// Point de courbe CPU / RAM (même forme que `MetricsSample` côté frontend)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MetricPoint {
    pub t: i64,
    pub cpu: f64,
    pub mem: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ServerUptime {
    pub server_id: String,
    pub checks: u64,
    pub online: u64,
    pub uptime_percent: f64,
    pub avg_latency_ms: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct PruneReport {
    pub raw_rows: usize,
    pub hourly_rows: usize,
    pub events: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryInfo {
    /// Chemin du fichier ; None si la base est en mémoire (repli)
    pub path: Option<String>,
    pub persistent: bool,
    pub size_bytes: u64,
    pub schema_version: i64,
    pub events: u64,
    pub ping_samples: u64,
    pub probe_samples: u64,
    pub metric_samples: u64,
    pub hourly_rows: u64,
    /// Plus ancienne donnée conservée (mesure brute, agrégat ou événement)
    pub oldest_ts: Option<i64>,
    /// Raison du repli en mémoire, le cas échéant
    pub warning: Option<String>,
}

/// Disponibilité en % ; 100 % faute de mesure (rien ne prouve une coupure)
pub fn uptime_percent(ok: u64, checks: u64) -> f64 {
    if checks == 0 {
        100.0
    } else {
        ok as f64 * 100.0 / checks as f64
    }
}

pub fn hour_of(ts: i64) -> i64 {
    ts - ts.rem_euclid(HOUR_MS)
}

fn truncate(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => s[..idx].to_string(),
        None => s.to_string(),
    }
}

fn to_i64(v: u64) -> i64 {
    i64::try_from(v).unwrap_or(i64::MAX)
}

fn sql_err(e: rusqlite::Error) -> String {
    format!("Base d'historique : {}", e)
}

/// Pourcentage d'utilisation du disque le plus plein (None sans disque)
fn fullest_disk_percent(m: &ServerMetrics) -> Option<f64> {
    m.disks
        .iter()
        .filter(|d| d.total_bytes > 0)
        .map(|d| d.used_bytes as f64 * 100.0 / d.total_bytes as f64)
        .fold(None, |max, p| Some(max.map_or(p, |m: f64| m.max(p))))
}

// ── Ouverture et migrations ───────────────────────────────────────────────

#[derive(Debug)]
enum OpenError {
    /// Base créée par une version plus récente de l'app : on n'y touche pas
    FromFuture(i64),
    /// Fichier illisible, corrompu ou migration impossible
    Unusable(String),
}

impl From<rusqlite::Error> for OpenError {
    fn from(e: rusqlite::Error) -> Self {
        OpenError::Unusable(e.to_string())
    }
}

/// Réglages de connexion puis migrations jusqu'à `SCHEMA_VERSION`
fn init(conn: &mut Connection) -> Result<(), OpenError> {
    conn.busy_timeout(Duration::from_secs(5))?;
    // Première lecture : échoue sur un fichier qui n'est pas une base SQLite
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(OpenError::FromFuture(version));
    }
    if version == 0 {
        // Ne prend effet qu'avant la création de la première table
        conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL;")?;
    }
    // Renvoie le mode obtenu (« memory » pour une base en mémoire) : la valeur est ignorée
    let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |r| r.get(0))?;
    conn.execute_batch("PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")?;

    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
        log::info!("Base d'historique migrée vers la version {}", i + 1);
    }
    Ok(())
}

fn open_file(path: &Path) -> Result<Connection, OpenError> {
    let mut conn = Connection::open(path)?;
    init(&mut conn)?;
    Ok(conn)
}

/// Met de côté une base inutilisable (et ses fichiers WAL / SHM) sans la supprimer
fn set_aside(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_string_lossy().to_string();
    let aside = path.with_file_name(format!("{}.corrupt-{}", name, now_ms()));
    std::fs::rename(path, &aside).ok()?;
    for suffix in ["-wal", "-shm"] {
        let side = path.with_file_name(format!("{}{}", name, suffix));
        if side.exists() {
            let _ = std::fs::rename(&side, aside.with_file_name(format!("{}{}", aside.file_name()?.to_string_lossy(), suffix)));
        }
    }
    Some(aside)
}

// ── Base ──────────────────────────────────────────────────────────────────

pub struct Db {
    conn: Mutex<Connection>,
    path: Option<PathBuf>,
    warning: Option<String>,
}

impl Db {
    /// Ouvre (ou crée) la base. Ne renvoie jamais d'erreur : l'historique ne doit pas
    /// empêcher l'app de démarrer. Base corrompue → mise de côté puis recréée ;
    /// base d'une version plus récente → laissée intacte, repli en mémoire.
    pub fn open(path: &Path) -> Db {
        let warning = match open_file(path) {
            Ok(conn) => return Db { conn: Mutex::new(conn), path: Some(path.to_path_buf()), warning: None },
            Err(OpenError::FromFuture(v)) => format!(
                "La base d'historique a été créée par une version plus récente de l'application (schéma {}) : \
                 elle n'est pas modifiée et l'historique de cette session ne sera pas conservé",
                v
            ),
            Err(OpenError::Unusable(e)) => {
                log::error!("Base d'historique inutilisable ({}) : mise de côté", e);
                match set_aside(path) {
                    Some(aside) => match open_file(path) {
                        Ok(conn) => {
                            log::warn!("Ancienne base conservée sous {:?}, nouvelle base créée", aside);
                            return Db { conn: Mutex::new(conn), path: Some(path.to_path_buf()), warning: None };
                        }
                        Err(e) => format!("Base d'historique impossible à créer : {:?}", e),
                    },
                    None => format!("Base d'historique illisible et impossible à mettre de côté : {}", e),
                }
            }
        };
        log::error!("{}", warning);
        let mut db = Db::in_memory();
        db.warning = Some(warning);
        db
    }

    /// Base en mémoire : tests et repli quand le fichier est inutilisable
    pub fn in_memory() -> Db {
        let mut conn = Connection::open_in_memory().expect("SQLite en mémoire indisponible");
        init(&mut conn).expect("schéma de la base en mémoire");
        Db { conn: Mutex::new(conn), path: None, warning: None }
    }

    fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>) -> Result<T, String> {
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut conn).map_err(sql_err)
    }

    fn with_tx<T>(&self, f: impl FnOnce(&Transaction) -> rusqlite::Result<T>) -> Result<T, String> {
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let out = f(&tx)?;
            tx.commit()?;
            Ok(out)
        })
    }

    // ── Événements ────────────────────────────────────────────────────────

    pub fn insert_event(&self, e: &Event) -> Result<(), String> {
        self.with_conn(|c| insert_event(c, e).map(|_| ()))
    }

    /// Événements du plus récent au plus ancien, strictement avant `before` si fourni
    pub fn events(&self, limit: u32, before: Option<i64>) -> Result<Vec<Event>, String> {
        let limit = limit.clamp(1, MAX_EVENTS_PAGE);
        self.with_conn(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, ts, kind, server_id, target, message FROM events
                 WHERE ts < ?1 ORDER BY ts DESC, rowid DESC LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![before.unwrap_or(i64::MAX), limit], row_to_event)?;
            rows.filter_map(|r| r.transpose()).collect()
        })
    }

    /// Dernier statut connu (événement Online / Offline le plus récent) de chaque serveur
    pub fn last_status(&self) -> Result<HashMap<String, bool>, String> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT server_id, kind FROM (
                     SELECT server_id, kind,
                            ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY ts DESC, rowid DESC) AS rn
                     FROM events WHERE server_id IS NOT NULL AND kind IN ('Online', 'Offline'))
                 WHERE rn = 1",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)? == "Online")))?;
            rows.collect()
        })
    }

    /// Événements d'état (Online / Offline) depuis `start`, précédés, pour chaque serveur,
    /// du dernier événement d'état antérieur : une coupure commencée avant la fenêtre
    /// reste ainsi comptée par `events::downtime_stats`.
    pub fn state_events_since(&self, start: i64) -> Result<Vec<Event>, String> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT id, ts, kind, server_id, target, message FROM (
                     SELECT id, ts, kind, server_id, target, message, rowid AS rid FROM events
                     WHERE server_id IS NOT NULL AND kind IN ('Online', 'Offline') AND ts >= ?1
                     UNION ALL
                     SELECT id, ts, kind, server_id, target, message, rid FROM (
                         SELECT id, ts, kind, server_id, target, message, rowid AS rid,
                                ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY ts DESC, rowid DESC) AS rn
                         FROM events
                         WHERE server_id IS NOT NULL AND kind IN ('Online', 'Offline') AND ts < ?1)
                     WHERE rn = 1)
                 ORDER BY ts, rid",
            )?;
            let rows = stmt.query_map(params![start], row_to_event)?;
            rows.filter_map(|r| r.transpose()).collect()
        })
    }

    pub fn clear_events(&self) -> Result<(), String> {
        self.with_conn(|c| c.execute("DELETE FROM events", []).map(|_| ()))
    }

    /// Reprend l'ancien historique `events.json`, puis supprime le fichier. Idempotent
    /// (`INSERT OR IGNORE` sur l'identifiant). Un fichier trop gros ou illisible est
    /// renommé en `.bak` sans être importé.
    pub fn import_legacy_events(&self, path: &Path) -> Result<usize, String> {
        let Ok(meta) = std::fs::metadata(path) else { return Ok(0) };
        let backup = path.with_extension("json.bak");
        if meta.len() > MAX_LEGACY_EVENTS_BYTES {
            let _ = std::fs::rename(path, &backup);
            return Err(format!("Ancien historique trop volumineux ({} octets) : conservé sous {:?}", meta.len(), backup));
        }
        let parsed = std::fs::read_to_string(path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<Vec<Event>>(&s).map_err(|e| e.to_string()));
        let events = match parsed {
            Ok(events) => events,
            Err(e) => {
                let _ = std::fs::rename(path, &backup);
                return Err(format!("Ancien historique illisible ({}) : conservé sous {:?}", e, backup));
            }
        };
        let imported = self.with_tx(|tx| {
            let mut n = 0;
            for e in &events {
                n += insert_event(tx, e)?;
            }
            Ok(n)
        })?;
        std::fs::remove_file(path).map_err(|e| format!("Suppression de l'ancien historique impossible : {}", e))?;
        Ok(imported)
    }

    // ── Pings ─────────────────────────────────────────────────────────────

    /// Enregistre une série de pings (même horodatage) et met à jour les agrégats horaires
    pub fn record_pings(&self, ts: i64, samples: &[(String, bool, Option<u64>)]) -> Result<(), String> {
        let upsert = check_hourly_upsert("ping_hourly", "server_id");
        self.with_tx(|tx| {
            let mut raw = tx.prepare_cached("INSERT INTO ping_samples (server_id, ts, online, latency_ms) VALUES (?1, ?2, ?3, ?4)")?;
            let mut hourly = tx.prepare_cached(&upsert)?;
            for (server_id, online, latency) in samples {
                let latency = latency.map(to_i64);
                raw.execute(params![server_id, ts, online, latency])?;
                hourly.execute(params![server_id, hour_of(ts), *online as i64, latency.unwrap_or(0), latency.is_some() as i64, latency])?;
            }
            Ok(())
        })
    }

    /// Disponibilité de chaque serveur depuis `since`, d'après les agrégats horaires
    pub fn server_uptime(&self, since: i64) -> Result<Vec<ServerUptime>, String> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT server_id, SUM(checks), SUM(ok), SUM(latency_sum), SUM(latency_count)
                 FROM ping_hourly WHERE hour >= ?1 GROUP BY server_id ORDER BY server_id",
            )?;
            let rows = stmt.query_map(params![hour_of(since)], |r| {
                let (checks, ok): (i64, i64) = (r.get(1)?, r.get(2)?);
                let (lat_sum, lat_count): (i64, i64) = (r.get(3)?, r.get(4)?);
                Ok(ServerUptime {
                    server_id: r.get(0)?,
                    checks: checks.max(0) as u64,
                    online: ok.max(0) as u64,
                    uptime_percent: uptime_percent(ok.max(0) as u64, checks.max(0) as u64),
                    avg_latency_ms: (lat_count > 0).then(|| lat_sum as f64 / lat_count as f64),
                })
            })?;
            rows.collect()
        })
    }

    // ── Sondes ────────────────────────────────────────────────────────────

    pub fn record_probe(&self, s: &ProbeSample) -> Result<(), String> {
        let upsert = check_hourly_upsert("probe_hourly", "probe_id");
        self.with_tx(|tx| {
            let latency = s.latency_ms.map(to_i64);
            tx.prepare_cached(
                "INSERT INTO probe_samples (probe_id, ts, ok, latency_ms, detail, cert_days_left) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )?
            .execute(params![s.probe_id, s.ts, s.ok, latency, truncate(&s.detail, MAX_DETAIL_CHARS), s.cert_days_left])?;
            tx.prepare_cached(&upsert)?
                .execute(params![s.probe_id, hour_of(s.ts), s.ok as i64, latency.unwrap_or(0), latency.is_some() as i64, latency])?;
            Ok(())
        })
    }

    /// Dernier résultat enregistré de chaque sonde
    pub fn latest_probe_samples(&self) -> Result<Vec<ProbeSample>, String> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT probe_id, ts, ok, latency_ms, detail, cert_days_left FROM (
                     SELECT *, ROW_NUMBER() OVER (PARTITION BY probe_id ORDER BY ts DESC, rowid DESC) AS rn
                     FROM probe_samples)
                 WHERE rn = 1 ORDER BY probe_id",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(ProbeSample {
                    probe_id: r.get(0)?,
                    ts: r.get(1)?,
                    ok: r.get(2)?,
                    latency_ms: r.get::<_, Option<i64>>(3)?.map(|v| v.max(0) as u64),
                    detail: r.get(4)?,
                    cert_days_left: r.get(5)?,
                })
            })?;
            rows.collect()
        })
    }

    /// Disponibilité (%) d'une sonde depuis `since`, d'après les agrégats horaires
    pub fn probe_uptime(&self, probe_id: &str, since: i64) -> Result<f64, String> {
        self.with_conn(|c| {
            c.query_row(
                "SELECT COALESCE(SUM(ok), 0), COALESCE(SUM(checks), 0) FROM probe_hourly WHERE probe_id = ?1 AND hour >= ?2",
                params![probe_id, hour_of(since)],
                |r| Ok(uptime_percent(r.get::<_, i64>(0)?.max(0) as u64, r.get::<_, i64>(1)?.max(0) as u64)),
            )
        })
    }

    /// Oublie tout l'historique d'une sonde supprimée
    pub fn forget_probe(&self, probe_id: &str) -> Result<(), String> {
        self.with_tx(|tx| {
            tx.execute("DELETE FROM probe_samples WHERE probe_id = ?1", params![probe_id])?;
            tx.execute("DELETE FROM probe_hourly WHERE probe_id = ?1", params![probe_id])?;
            Ok(())
        })
    }

    // ── Métriques ─────────────────────────────────────────────────────────

    pub fn record_metrics(&self, server_id: &str, ts: i64, m: &ServerMetrics) -> Result<(), String> {
        let cpu = m.cpu_percent;
        let mem = if m.mem_total_bytes > 0 { m.mem_used_bytes as f64 * 100.0 / m.mem_total_bytes as f64 } else { 0.0 };
        let disk = fullest_disk_percent(m);
        self.with_tx(|tx| {
            tx.prepare_cached(
                "INSERT INTO metric_samples (server_id, ts, cpu_percent, mem_percent, disk_percent, load1, cpu_temp)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )?
            .execute(params![server_id, ts, cpu, mem, disk, m.load_avg[0], m.cpu_temp_celsius])?;
            tx.prepare_cached(
                "INSERT INTO metric_hourly (server_id, hour, samples, cpu_sum, cpu_max, mem_sum, mem_max, disk_max, temp_max)
                 VALUES (?1, ?2, 1, ?3, ?3, ?4, ?4, ?5, ?6)
                 ON CONFLICT (server_id, hour) DO UPDATE SET
                     samples = samples + 1,
                     cpu_sum = cpu_sum + excluded.cpu_sum,
                     cpu_max = MAX(cpu_max, excluded.cpu_max),
                     mem_sum = mem_sum + excluded.mem_sum,
                     mem_max = MAX(mem_max, excluded.mem_max),
                     disk_max = CASE WHEN excluded.disk_max IS NULL THEN disk_max
                                     WHEN disk_max IS NULL THEN excluded.disk_max
                                     ELSE MAX(disk_max, excluded.disk_max) END,
                     temp_max = CASE WHEN excluded.temp_max IS NULL THEN temp_max
                                     WHEN temp_max IS NULL THEN excluded.temp_max
                                     ELSE MAX(temp_max, excluded.temp_max) END",
            )?
            .execute(params![server_id, hour_of(ts), cpu, mem, disk, m.cpu_temp_celsius])?;
            Ok(())
        })
    }

    /// Derniers points CPU / RAM de chaque serveur depuis `since`, du plus ancien au plus récent
    pub fn recent_metrics(&self, per_server: u32, since: i64) -> Result<HashMap<String, Vec<MetricPoint>>, String> {
        self.with_conn(|c| {
            let mut stmt = c.prepare(
                "SELECT server_id, ts, cpu_percent, mem_percent FROM (
                     SELECT server_id, ts, cpu_percent, mem_percent,
                            ROW_NUMBER() OVER (PARTITION BY server_id ORDER BY ts DESC, rowid DESC) AS rn
                     FROM metric_samples WHERE ts >= ?1)
                 WHERE rn <= ?2 ORDER BY server_id, ts",
            )?;
            let rows = stmt.query_map(params![since, per_server], |r| {
                Ok((r.get::<_, String>(0)?, MetricPoint { t: r.get(1)?, cpu: r.get(2)?, mem: r.get(3)? }))
            })?;
            let mut map: HashMap<String, Vec<MetricPoint>> = HashMap::new();
            for row in rows {
                let (id, point) = row?;
                map.entry(id).or_default().push(point);
            }
            Ok(map)
        })
    }

    // ── Rétention et informations ─────────────────────────────────────────

    /// Supprime ce qui dépasse la rétention, puis rend l'espace libéré au système
    pub fn prune(&self, now: i64, settings: &HistorySettings) -> Result<PruneReport, String> {
        let raw_cut = now - i64::from(settings.raw_days) * DAY_MS;
        let hourly_cut = now - i64::from(settings.hourly_days) * DAY_MS;
        let event_cut = now - i64::from(settings.event_days) * DAY_MS;
        let report = self.with_tx(|tx| {
            let mut r = PruneReport::default();
            for table in ["ping_samples", "probe_samples", "metric_samples"] {
                r.raw_rows += tx.execute(&format!("DELETE FROM {} WHERE ts < ?1", table), params![raw_cut])?;
            }
            for table in ["ping_hourly", "probe_hourly", "metric_hourly"] {
                r.hourly_rows += tx.execute(&format!("DELETE FROM {} WHERE hour < ?1", table), params![hourly_cut])?;
            }
            r.events = tx.execute("DELETE FROM events WHERE ts < ?1", params![event_cut])?;
            Ok(r)
        })?;
        self.with_conn(|c| c.execute_batch("PRAGMA incremental_vacuum;"))?;
        Ok(report)
    }

    pub fn info(&self) -> Result<HistoryInfo, String> {
        let count = |c: &Connection, table: &str| -> rusqlite::Result<u64> {
            c.query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |r| r.get::<_, i64>(0)).map(|n| n.max(0) as u64)
        };
        let (schema_version, events, ping, probe, metric, hourly, oldest) = self.with_conn(|c| {
            let hourly = count(c, "ping_hourly")? + count(c, "probe_hourly")? + count(c, "metric_hourly")?;
            let oldest: Option<i64> = c
                .query_row(
                    "SELECT MIN(t) FROM (
                         SELECT MIN(ts) AS t FROM events UNION ALL SELECT MIN(ts) FROM ping_samples
                         UNION ALL SELECT MIN(ts) FROM probe_samples UNION ALL SELECT MIN(ts) FROM metric_samples
                         UNION ALL SELECT MIN(hour) FROM ping_hourly UNION ALL SELECT MIN(hour) FROM probe_hourly
                         UNION ALL SELECT MIN(hour) FROM metric_hourly)",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .flatten();
            Ok((
                c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?,
                count(c, "events")?,
                count(c, "ping_samples")?,
                count(c, "probe_samples")?,
                count(c, "metric_samples")?,
                hourly,
                oldest,
            ))
        })?;
        // Taille réelle sur disque : fichier principal + journal WAL
        let size_bytes = self
            .path
            .as_ref()
            .map(|p| {
                let wal = p.with_file_name(format!("{}-wal", p.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()));
                [p.clone(), wal].iter().filter_map(|f| std::fs::metadata(f).ok()).map(|m| m.len()).sum()
            })
            .unwrap_or(0);
        Ok(HistoryInfo {
            path: self.path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            persistent: self.path.is_some(),
            size_bytes,
            schema_version,
            events,
            ping_samples: ping,
            probe_samples: probe,
            metric_samples: metric,
            hourly_rows: hourly,
            oldest_ts: oldest,
            warning: self.warning.clone(),
        })
    }
}

fn insert_event(c: &Connection, e: &Event) -> rusqlite::Result<usize> {
    c.prepare_cached("INSERT OR IGNORE INTO events (id, ts, kind, server_id, target, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?
        .execute(params![
            e.id,
            e.ts,
            e.kind.as_str(),
            e.server_id,
            truncate(&e.target, MAX_TARGET_CHARS),
            truncate(&e.message, MAX_MESSAGE_CHARS)
        ])
}

/// Ligne → événement ; None pour un type inconnu (écrit par une version plus récente)
fn row_to_event(r: &rusqlite::Row) -> rusqlite::Result<Option<Event>> {
    let kind: String = r.get(2)?;
    let Some(kind) = EventKind::parse(&kind) else { return Ok(None) };
    Ok(Some(Event { id: r.get(0)?, ts: r.get(1)?, kind, server_id: r.get(3)?, target: r.get(4)?, message: r.get(5)? }))
}

/// Purge périodique : 30 s après le démarrage, puis toutes les heures
pub fn start_maintenance(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let settings = app
                .state::<crate::storage::AppState>()
                .data
                .lock()
                .map(|d| d.settings.history.clone())
                .unwrap_or_default();
            match app.state::<Db>().prune(now_ms(), &settings) {
                Ok(r) if r != PruneReport::default() => log::info!(
                    "Rétention appliquée : {} mesure(s), {} agrégat(s), {} événement(s) supprimés",
                    r.raw_rows, r.hourly_rows, r.events
                ),
                Ok(_) => {}
                Err(e) => log::warn!("Purge de l'historique impossible : {}", e),
            }
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::DiskUsage;

    fn ev(id: &str, ts: i64, kind: EventKind, server: Option<&str>) -> Event {
        Event {
            id: id.into(),
            ts,
            kind,
            server_id: server.map(str::to_string),
            target: server.unwrap_or("vm").into(),
            message: String::new(),
        }
    }

    fn metrics(cpu: f64, used: u64, total: u64, disks: &[(u64, u64)], temp: Option<f64>) -> ServerMetrics {
        ServerMetrics {
            cpu_percent: cpu,
            mem_total_bytes: total,
            mem_used_bytes: used,
            uptime_secs: 1,
            load_avg: [0.5, 0.4, 0.3],
            disks: disks
                .iter()
                .map(|(u, t)| DiskUsage { name: "d".into(), mount: "/".into(), fs_type: "ext4".into(), total_bytes: *t, used_bytes: *u })
                .collect(),
            temperatures: Vec::new(),
            cpu_temp_celsius: temp,
        }
    }

    /// Dossier temporaire propre à un test, supprimé à la fin
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("spm-db-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn user_version(db: &Db) -> i64 {
        db.with_conn(|c| c.query_row("PRAGMA user_version", [], |r| r.get(0))).unwrap()
    }

    // ── Migrations et ouverture ───────────────────────────────────────────

    #[test]
    fn fresh_database_is_migrated_to_current_schema() {
        let tmp = TempDir::new();
        let db = Db::open(&tmp.0.join("history.db"));
        assert_eq!(user_version(&db), SCHEMA_VERSION);
        assert!(db.info().unwrap().persistent);
        let auto_vacuum: i64 = db.with_conn(|c| c.query_row("PRAGMA auto_vacuum", [], |r| r.get(0))).unwrap();
        assert_eq!(auto_vacuum, 2, "auto_vacuum doit être INCREMENTAL dès la création");
    }

    #[test]
    fn reopening_is_idempotent() {
        let tmp = TempDir::new();
        let path = tmp.0.join("history.db");
        drop(Db::open(&path));
        let db = Db::open(&path);
        assert_eq!(user_version(&db), SCHEMA_VERSION);
        assert!(db.info().unwrap().warning.is_none());
    }

    #[test]
    fn database_from_a_newer_version_is_left_untouched() {
        let tmp = TempDir::new();
        let path = tmp.0.join("history.db");
        {
            let c = Connection::open(&path).unwrap();
            c.pragma_update(None, "user_version", SCHEMA_VERSION + 5).unwrap();
            c.execute_batch("CREATE TABLE future (x INTEGER);").unwrap();
        }
        let db = Db::open(&path);
        let info = db.info().unwrap();
        assert!(!info.persistent && info.warning.unwrap().contains("plus récente"));
        // Le fichier d'origine n'a été ni renommé ni modifié
        let c = Connection::open(&path).unwrap();
        assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(), SCHEMA_VERSION + 5);
    }

    #[test]
    fn corrupt_file_is_set_aside_and_replaced() {
        let tmp = TempDir::new();
        let path = tmp.0.join("history.db");
        std::fs::write(&path, "ceci n'est pas une base SQLite. ".repeat(20)).unwrap();
        let db = Db::open(&path);
        assert!(db.info().unwrap().persistent);
        assert_eq!(user_version(&db), SCHEMA_VERSION);
        let aside: Vec<_> = std::fs::read_dir(&tmp.0)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("history.db.corrupt-"))
            .collect();
        assert_eq!(aside.len(), 1, "l'ancien fichier doit être conservé à part");
    }

    // ── Persistance (critère : survit au redémarrage) ─────────────────────

    #[test]
    fn history_and_availability_survive_a_restart() {
        let tmp = TempDir::new();
        let path = tmp.0.join("history.db");
        let now = 100 * DAY_MS;
        {
            let db = Db::open(&path);
            db.insert_event(&ev("e1", now - 1000, EventKind::Offline, Some("minipc"))).unwrap();
            db.record_pings(now - 500, &[("minipc".into(), false, None)]).unwrap();
            db.record_pings(now - 400, &[("minipc".into(), true, Some(4))]).unwrap();
            db.record_probe(&ProbeSample { probe_id: "p".into(), ts: now - 300, ok: true, latency_ms: Some(12), detail: "HTTP 200".into(), cert_days_left: None }).unwrap();
            db.record_probe(&ProbeSample { probe_id: "p".into(), ts: now - 200, ok: false, latency_ms: None, detail: "HTTP 503".into(), cert_days_left: None }).unwrap();
            db.record_metrics("minipc", now - 100, &metrics(40.0, 1, 4, &[], None)).unwrap();
        }
        // « Redémarrage » : nouvelle connexion sur le même fichier
        let db = Db::open(&path);
        assert_eq!(db.events(10, None).unwrap().len(), 1);
        assert_eq!(db.last_status().unwrap().get("minipc"), Some(&false));
        assert_eq!(db.server_uptime(now - DAY_MS).unwrap()[0].uptime_percent, 50.0);
        assert_eq!(db.probe_uptime("p", now - DAY_MS).unwrap(), 50.0);
        let latest = db.latest_probe_samples().unwrap();
        assert_eq!((latest.len(), latest[0].detail.as_str()), (1, "HTTP 503"));
        assert_eq!(db.recent_metrics(10, 0).unwrap()["minipc"][0].cpu, 40.0);
    }

    // ── Événements ────────────────────────────────────────────────────────

    #[test]
    fn events_are_newest_first_with_limit_and_pagination() {
        let db = Db::in_memory();
        for i in 0..5 {
            db.insert_event(&ev(&format!("e{}", i), i * 10, EventKind::Wake, Some("a"))).unwrap();
        }
        let ids = |v: Vec<Event>| v.into_iter().map(|e| e.id).collect::<Vec<_>>();
        assert_eq!(ids(db.events(2, None).unwrap()), vec!["e4", "e3"]);
        assert_eq!(ids(db.events(10, Some(30)).unwrap()), vec!["e2", "e1", "e0"]);
        // Réinsertion d'un même identifiant : ignorée
        db.insert_event(&ev("e0", 999, EventKind::Wake, Some("a"))).unwrap();
        assert_eq!(db.events(10, None).unwrap().len(), 5);
        db.clear_events().unwrap();
        assert!(db.events(10, None).unwrap().is_empty());
    }

    #[test]
    fn long_texts_are_truncated() {
        let db = Db::in_memory();
        let mut e = ev("long", 1, EventKind::Failure, None);
        e.message = "é".repeat(MAX_MESSAGE_CHARS + 50);
        db.insert_event(&e).unwrap();
        assert_eq!(db.events(1, None).unwrap()[0].message.chars().count(), MAX_MESSAGE_CHARS);
    }

    #[test]
    fn last_status_uses_the_latest_state_event_per_server() {
        let db = Db::in_memory();
        db.insert_event(&ev("1", 1, EventKind::Offline, Some("a"))).unwrap();
        db.insert_event(&ev("2", 2, EventKind::Wake, Some("a"))).unwrap();
        db.insert_event(&ev("3", 3, EventKind::Online, Some("b"))).unwrap();
        db.insert_event(&ev("4", 4, EventKind::Offline, Some("b"))).unwrap();
        db.insert_event(&ev("5", 5, EventKind::VmAction, None)).unwrap();
        let status = db.last_status().unwrap();
        assert_eq!(status.len(), 2);
        assert_eq!((status["a"], status["b"]), (false, false));
    }

    #[test]
    fn stats_window_includes_the_state_before_it() {
        let db = Db::in_memory();
        // a : coupure commencée avant la fenêtre [500, 1000], terminée à 600
        db.insert_event(&ev("1", 100, EventKind::Online, Some("a"))).unwrap();
        db.insert_event(&ev("2", 400, EventKind::Offline, Some("a"))).unwrap();
        db.insert_event(&ev("3", 600, EventKind::Online, Some("a"))).unwrap();
        db.insert_event(&ev("4", 700, EventKind::Wake, Some("a"))).unwrap();
        let events = db.state_events_since(500).unwrap();
        assert_eq!(events.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["2", "3"]);
        let stats = crate::events::downtime_stats(&events, 1000, 500);
        assert_eq!((stats[0].outages, stats[0].downtime_ms), (0, 100));
    }

    #[test]
    fn unknown_event_kinds_are_skipped() {
        let db = Db::in_memory();
        db.with_conn(|c| c.execute("INSERT INTO events VALUES ('x', 1, 'FromTheFuture', NULL, 't', 'm')", [])).unwrap();
        db.insert_event(&ev("ok", 2, EventKind::Wake, None)).unwrap();
        assert_eq!(db.events(10, None).unwrap().len(), 1);
    }

    // ── Agrégats ──────────────────────────────────────────────────────────

    #[test]
    fn ping_aggregates_count_checks_success_and_latency() {
        let db = Db::in_memory();
        let h = 10 * HOUR_MS;
        db.record_pings(h + 1, &[("a".into(), true, Some(10)), ("b".into(), false, None)]).unwrap();
        db.record_pings(h + 2, &[("a".into(), true, Some(30)), ("b".into(), true, Some(5))]).unwrap();
        db.record_pings(h + 3, &[("a".into(), false, None)]).unwrap();
        let (checks, ok, sum, count, max): (i64, i64, i64, i64, Option<i64>) = db
            .with_conn(|c| c.query_row("SELECT checks, ok, latency_sum, latency_count, latency_max FROM ping_hourly WHERE server_id = 'a'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))))
            .unwrap();
        assert_eq!((checks, ok, sum, count, max), (3, 2, 40, 2, Some(30)));
        let up = db.server_uptime(h).unwrap();
        let a = up.iter().find(|u| u.server_id == "a").unwrap();
        assert!((a.uptime_percent - 200.0 / 3.0).abs() < 1e-9);
        assert_eq!(a.avg_latency_ms, Some(20.0));
        let b = up.iter().find(|u| u.server_id == "b").unwrap();
        assert_eq!((b.checks, b.online, b.avg_latency_ms), (2, 1, Some(5.0)));
        // Une autre heure crée un autre agrégat
        db.record_pings(h + HOUR_MS, &[("a".into(), true, None)]).unwrap();
        let rows: i64 = db.with_conn(|c| c.query_row("SELECT COUNT(*) FROM ping_hourly WHERE server_id = 'a'", [], |r| r.get(0))).unwrap();
        assert_eq!(rows, 2);
    }

    #[test]
    fn probe_uptime_and_latest_result() {
        let db = Db::in_memory();
        assert_eq!(db.probe_uptime("p", 0).unwrap(), 100.0);
        for (ts, ok) in [(1, true), (2, true), (3, true), (4, false)] {
            db.record_probe(&ProbeSample { probe_id: "p".into(), ts, ok, latency_ms: Some(ts as u64), detail: format!("#{}", ts), cert_days_left: Some(30) }).unwrap();
        }
        db.record_probe(&ProbeSample { probe_id: "q".into(), ts: 9, ok: true, latency_ms: None, detail: "x".repeat(500), cert_days_left: None }).unwrap();
        assert_eq!(db.probe_uptime("p", 0).unwrap(), 75.0);
        let latest = db.latest_probe_samples().unwrap();
        assert_eq!(latest.len(), 2);
        assert_eq!((latest[0].detail.as_str(), latest[0].ok, latest[0].cert_days_left), ("#4", false, Some(30)));
        assert_eq!(latest[1].detail.len(), MAX_DETAIL_CHARS);
        db.forget_probe("p").unwrap();
        assert_eq!(db.latest_probe_samples().unwrap().len(), 1);
        assert_eq!(db.probe_uptime("p", 0).unwrap(), 100.0);
    }

    #[test]
    fn metric_aggregates_keep_average_and_maxima() {
        let db = Db::in_memory();
        let h = 5 * HOUR_MS;
        db.record_metrics("a", h + 1, &metrics(20.0, 1, 4, &[(10, 100), (90, 100)], None)).unwrap();
        db.record_metrics("a", h + 2, &metrics(60.0, 3, 4, &[], Some(55.5))).unwrap();
        let row: (i64, f64, f64, f64, f64, Option<f64>, Option<f64>) = db
            .with_conn(|c| c.query_row("SELECT samples, cpu_sum, cpu_max, mem_sum, mem_max, disk_max, temp_max FROM metric_hourly", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))))
            .unwrap();
        assert_eq!(row, (2, 80.0, 60.0, 100.0, 75.0, Some(90.0), Some(55.5)));
        let disk: Option<f64> = db.with_conn(|c| c.query_row("SELECT disk_percent FROM metric_samples WHERE ts = ?1", [h + 2], |r| r.get(0))).unwrap();
        assert_eq!(disk, None, "sans disque, pas de pourcentage");
    }

    #[test]
    fn recent_metrics_are_limited_per_server_and_ascending() {
        let db = Db::in_memory();
        for t in 1..=5 {
            db.record_metrics("a", t * 1000, &metrics(t as f64, 1, 2, &[], None)).unwrap();
        }
        db.record_metrics("b", 100, &metrics(9.0, 0, 0, &[], None)).unwrap();
        let recent = db.recent_metrics(3, 0).unwrap();
        assert_eq!(recent["a"].iter().map(|p| p.t).collect::<Vec<_>>(), vec![3000, 4000, 5000]);
        assert_eq!(recent["a"][0].mem, 50.0);
        assert_eq!(recent["b"][0].mem, 0.0, "RAM totale inconnue : 0 %");
        assert!(!db.recent_metrics(3, 10_000).unwrap().contains_key("a"));
    }

    // ── Rétention ─────────────────────────────────────────────────────────

    #[test]
    fn prune_applies_each_retention_separately() {
        let db = Db::in_memory();
        let settings = HistorySettings { raw_days: 7, hourly_days: 90, event_days: 30 };
        let now = 200 * DAY_MS;
        let old_raw = now - 8 * DAY_MS; // brut expiré, agrégat conservé
        let very_old = now - 91 * DAY_MS; // agrégat expiré aussi
        for ts in [old_raw, very_old, now - HOUR_MS] {
            db.record_pings(ts, &[("a".into(), true, Some(1))]).unwrap();
            db.record_probe(&ProbeSample { probe_id: "p".into(), ts, ok: true, latency_ms: None, detail: String::new(), cert_days_left: None }).unwrap();
            db.record_metrics("a", ts, &metrics(1.0, 1, 2, &[], None)).unwrap();
        }
        db.insert_event(&ev("old", now - 31 * DAY_MS, EventKind::Wake, None)).unwrap();
        db.insert_event(&ev("recent", now - 29 * DAY_MS, EventKind::Wake, None)).unwrap();

        let report = db.prune(now, &settings).unwrap();
        assert_eq!(report, PruneReport { raw_rows: 6, hourly_rows: 3, events: 1 });
        let info = db.info().unwrap();
        assert_eq!((info.ping_samples, info.probe_samples, info.metric_samples), (1, 1, 1));
        assert_eq!(info.hourly_rows, 6, "agrégats de l'heure récente et d'il y a 8 jours");
        assert_eq!(db.events(10, None).unwrap()[0].id, "recent");
        // Deuxième passage : plus rien à supprimer
        assert_eq!(db.prune(now, &settings).unwrap(), PruneReport::default());
    }

    // ── Reprise de l'ancien events.json ───────────────────────────────────

    #[test]
    fn legacy_events_json_is_imported_then_removed() {
        let tmp = TempDir::new();
        let legacy = tmp.0.join("events.json");
        let events = vec![ev("a", 1, EventKind::Offline, Some("minipc")), ev("b", 2, EventKind::Online, Some("minipc"))];
        std::fs::write(&legacy, serde_json::to_string(&events).unwrap()).unwrap();
        let db = Db::in_memory();
        assert_eq!(db.import_legacy_events(&legacy).unwrap(), 2);
        assert!(!legacy.exists());
        assert_eq!(db.events(10, None).unwrap(), events.into_iter().rev().collect::<Vec<_>>());
        // Idempotent : plus de fichier, rien à faire
        assert_eq!(db.import_legacy_events(&legacy).unwrap(), 0);
    }

    #[test]
    fn unreadable_legacy_file_is_kept_aside() {
        let tmp = TempDir::new();
        let legacy = tmp.0.join("events.json");
        std::fs::write(&legacy, "{pas du json").unwrap();
        let db = Db::in_memory();
        assert!(db.import_legacy_events(&legacy).is_err());
        assert!(!legacy.exists() && tmp.0.join("events.json.bak").exists());
        assert!(db.events(10, None).unwrap().is_empty());
    }

    #[test]
    fn helpers() {
        assert_eq!(hour_of(HOUR_MS + 5), HOUR_MS);
        assert_eq!(hour_of(-1), -HOUR_MS);
        assert_eq!(uptime_percent(0, 0), 100.0);
        assert_eq!(uptime_percent(1, 4), 25.0);
        assert_eq!(truncate("abc", 2), "ab");
        assert_eq!(truncate("ab", 5), "ab");
        assert_eq!(to_i64(u64::MAX), i64::MAX);
    }
}
