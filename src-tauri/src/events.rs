/// Historique des événements — journal persistant + statistiques de disponibilité
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Nombre maximal d'événements conservés (les plus anciens sont supprimés)
pub const MAX_EVENTS: usize = 5000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum EventKind {
    Offline,
    Online,
    Wake,
    Shutdown,
    Reboot,
    VmAction,
    Container,
    Failure,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    /// Horodatage en millisecondes depuis l'epoch Unix
    pub ts: i64,
    pub kind: EventKind,
    pub server_id: Option<String>,
    /// Nom lisible de la cible (serveur, VM…) figé au moment de l'événement
    pub target: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ServerStats {
    pub server_id: String,
    pub outages: u32,
    pub downtime_ms: i64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ── Cœur pur (sans IO) ────────────────────────────────────────────────────
#[derive(Default)]
pub struct EventStore {
    /// Du plus ancien au plus récent
    pub events: Vec<Event>,
    /// Dernier statut connu par serveur, pour détecter les transitions de ping
    last_status: HashMap<String, bool>,
}

impl EventStore {
    /// Reconstruit le magasin depuis l'historique persisté, en reprenant le dernier
    /// statut connu de chaque serveur (dernier événement Online / Offline).
    pub fn from_events(events: Vec<Event>) -> Self {
        let mut last_status = HashMap::new();
        for e in &events {
            if let (Some(id), EventKind::Online | EventKind::Offline) = (&e.server_id, e.kind) {
                last_status.insert(id.clone(), e.kind == EventKind::Online);
            }
        }
        EventStore { events, last_status }
    }

    pub fn push(&mut self, event: Event) {
        self.events.push(event);
        if self.events.len() > MAX_EVENTS {
            let excess = self.events.len() - MAX_EVENTS;
            self.events.drain(..excess);
        }
    }

    /// Renvoie le type d'événement si le statut a changé depuis la dernière
    /// observation. La première observation d'un serveur ne produit rien.
    pub fn observe(&mut self, server_id: &str, online: bool) -> Option<EventKind> {
        let previous = self.last_status.insert(server_id.to_string(), online);
        match previous {
            Some(was) if was != online => Some(if online { EventKind::Online } else { EventKind::Offline }),
            _ => None,
        }
    }
}

/// Coupures et temps hors ligne par serveur sur la fenêtre `[now - window, now]`.
/// Une coupure commencée avant la fenêtre n'est comptée qu'à partir de son début ;
/// une coupure toujours en cours est comptée jusqu'à `now`.
pub fn downtime_stats(events: &[Event], now: i64, window_ms: i64) -> Vec<ServerStats> {
    let start = now - window_ms;
    let mut offline_since: HashMap<&str, i64> = HashMap::new();
    let mut stats: HashMap<&str, ServerStats> = HashMap::new();

    let mut sorted: Vec<&Event> = events.iter().collect();
    sorted.sort_by_key(|e| e.ts);

    for e in sorted {
        let Some(id) = e.server_id.as_deref() else { continue };
        let entry = stats.entry(id).or_insert_with(|| ServerStats {
            server_id: id.to_string(),
            outages: 0,
            downtime_ms: 0,
        });
        match e.kind {
            EventKind::Offline => {
                offline_since.entry(id).or_insert(e.ts);
                if e.ts >= start {
                    entry.outages += 1;
                }
            }
            EventKind::Online => {
                if let Some(since) = offline_since.remove(id) {
                    entry.downtime_ms += (e.ts - since.max(start)).max(0);
                }
            }
            _ => {}
        }
    }
    for (id, since) in offline_since {
        if let Some(entry) = stats.get_mut(id) {
            entry.downtime_ms += (now - since.max(start)).max(0);
        }
    }

    let mut result: Vec<ServerStats> = stats.into_values().collect();
    result.sort_by(|a, b| a.server_id.cmp(&b.server_id));
    result
}

// ── Journal persistant ────────────────────────────────────────────────────
pub struct EventLog {
    store: Mutex<EventStore>,
    path: PathBuf,
    app: AppHandle,
}

impl EventLog {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .map(|d| d.join("events.json"))
            .unwrap_or_else(|_| PathBuf::from("events.json"));
        let events: Vec<Event> = std::fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        log::info!("Historique chargé : {} événement(s)", events.len());
        EventLog {
            store: Mutex::new(EventStore::from_events(events)),
            path,
            app: app.clone(),
        }
    }

    /// Enregistre un événement, le persiste et le transmet au frontend.
    /// Ne renvoie jamais d'erreur : l'historique ne doit pas faire échouer l'action qu'il décrit.
    pub fn record(&self, kind: EventKind, server_id: Option<&str>, target: &str, message: impl Into<String>) {
        let event = Event {
            id: Uuid::new_v4().to_string(),
            ts: now_ms(),
            kind,
            server_id: server_id.map(str::to_string),
            target: target.to_string(),
            message: message.into(),
        };
        let Ok(mut store) = self.store.lock() else { return };
        store.push(event.clone());
        if let Ok(json) = serde_json::to_string(&store.events) {
            if let Err(e) = std::fs::write(&self.path, json) {
                log::warn!("Écriture de l'historique impossible : {}", e);
            }
        }
        drop(store);
        let _ = self.app.emit("event-recorded", &event);
    }

    /// Transmet un résultat de ping ; enregistre un événement en cas de changement d'état.
    pub fn observe_ping(&self, server_id: &str, target: &str, online: bool) {
        let kind = match self.store.lock() {
            Ok(mut store) => store.observe(server_id, online),
            Err(_) => None,
        };
        if let Some(kind) = kind {
            let message = if online { "De nouveau joignable" } else { "Ne répond plus au ping" };
            self.record(kind, Some(server_id), target, message);
        }
    }

    pub fn list(&self) -> Vec<Event> {
        self.store
            .lock()
            .map(|s| s.events.iter().rev().cloned().collect())
            .unwrap_or_default()
    }

    pub fn stats(&self, days: u32) -> Vec<ServerStats> {
        let window = i64::from(days) * 24 * 3600 * 1000;
        self.store
            .lock()
            .map(|s| downtime_stats(&s.events, now_ms(), window))
            .unwrap_or_default()
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut store = self.store.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        store.events.clear();
        std::fs::write(&self.path, "[]").map_err(|e| format!("Écriture de l'historique impossible : {}", e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(ts: i64, kind: EventKind, server: &str) -> Event {
        Event {
            id: ts.to_string(),
            ts,
            kind,
            server_id: Some(server.into()),
            target: server.into(),
            message: String::new(),
        }
    }

    #[test]
    fn first_observation_is_silent_then_transitions_are_reported() {
        let mut store = EventStore::default();
        assert_eq!(store.observe("a", true), None);
        assert_eq!(store.observe("a", true), None);
        assert_eq!(store.observe("a", false), Some(EventKind::Offline));
        assert_eq!(store.observe("a", false), None);
        assert_eq!(store.observe("a", true), Some(EventKind::Online));
    }

    #[test]
    fn reloaded_store_resumes_from_last_known_status() {
        // Après un redémarrage de l'app, un serveur noté hors ligne qui répond de
        // nouveau doit produire un retour « en ligne », sinon sa coupure ne se referme jamais
        let mut store = EventStore::from_events(vec![
            ev(1, EventKind::Offline, "a"),
            ev(2, EventKind::Wake, "a"),
            ev(3, EventKind::Online, "b"),
            ev(4, EventKind::Offline, "b"),
        ]);
        assert_eq!(store.observe("a", true), Some(EventKind::Online));
        assert_eq!(store.observe("b", false), None);
        assert_eq!(store.observe("c", true), None);
    }

    #[test]
    fn push_keeps_only_the_most_recent_events() {
        let mut store = EventStore::default();
        for i in 0..(MAX_EVENTS as i64 + 3) {
            store.push(ev(i, EventKind::Wake, "a"));
        }
        assert_eq!(store.events.len(), MAX_EVENTS);
        assert_eq!(store.events[0].ts, 3);
    }

    #[test]
    fn stats_count_closed_and_ongoing_outages() {
        let events = vec![
            ev(100, EventKind::Offline, "a"),
            ev(150, EventKind::Online, "a"),
            ev(200, EventKind::Offline, "a"),
            ev(120, EventKind::Wake, "b"),
        ];
        let stats = downtime_stats(&events, 260, 1000);
        let a = stats.iter().find(|s| s.server_id == "a").unwrap();
        assert_eq!(a.outages, 2);
        // 50 ms de coupure terminée + 60 ms de coupure toujours en cours
        assert_eq!(a.downtime_ms, 110);
        let b = stats.iter().find(|s| s.server_id == "b").unwrap();
        assert_eq!((b.outages, b.downtime_ms), (0, 0));
    }

    #[test]
    fn stats_clip_outage_started_before_window() {
        // Fenêtre = [500, 1000] : la coupure 400→600 ne compte que pour 100 ms et hors comptage
        let events = vec![ev(400, EventKind::Offline, "a"), ev(600, EventKind::Online, "a")];
        let stats = downtime_stats(&events, 1000, 500);
        assert_eq!(stats[0].outages, 0);
        assert_eq!(stats[0].downtime_ms, 100);
    }

    #[test]
    fn stats_ignore_events_without_server() {
        let mut e = ev(10, EventKind::VmAction, "x");
        e.server_id = None;
        assert!(downtime_stats(&[e], 100, 1000).is_empty());
    }
}
