/// Commandes Tauri — Historique des événements
use tauri::State;

use crate::db::DEFAULT_EVENTS_PAGE;
use crate::events::{Event, EventLog, ServerStats};

/// Événements du plus récent au plus ancien. `before` (horodatage en ms) permet de
/// charger la page suivante ; `limit` est borné côté base.
#[tauri::command]
pub fn get_events(events: State<EventLog>, limit: Option<u32>, before: Option<i64>) -> Result<Vec<Event>, String> {
    events.list(limit.unwrap_or(DEFAULT_EVENTS_PAGE), before)
}

#[tauri::command]
pub fn get_event_stats(events: State<EventLog>, days: u32) -> Result<Vec<ServerStats>, String> {
    events.stats(days.clamp(1, 365))
}

#[tauri::command]
pub fn clear_events(events: State<EventLog>) -> Result<(), String> {
    events.clear()
}
