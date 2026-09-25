/// Commandes Tauri — Historique des événements
use tauri::State;

use crate::events::{Event, EventLog, ServerStats};

#[tauri::command]
pub fn get_events(events: State<EventLog>) -> Vec<Event> {
    events.list()
}

#[tauri::command]
pub fn get_event_stats(events: State<EventLog>, days: u32) -> Vec<ServerStats> {
    events.stats(days.clamp(1, 365))
}

#[tauri::command]
pub fn clear_events(events: State<EventLog>) -> Result<(), String> {
    events.clear()
}
