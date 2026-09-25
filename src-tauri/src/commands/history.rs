/// Commandes Tauri — Base d'historique (rétention, disponibilité, courbes)
use std::collections::HashMap;
use tauri::State;

use crate::{
    db::{Db, HistoryInfo, MetricPoint, PruneReport, ServerUptime, DAY_MS},
    events::now_ms,
    storage::AppState,
};

/// Nombre maximal de points de courbe renvoyés par serveur
const MAX_RECENT_METRICS: u32 = 1_000;

#[tauri::command]
pub fn get_history_info(db: State<Db>) -> Result<HistoryInfo, String> {
    db.info()
}

/// Derniers points CPU / RAM de chaque serveur (dans la limite de la rétention brute),
/// pour que les courbes de la page Ressources survivent à un redémarrage.
#[tauri::command]
pub fn get_recent_metrics(db: State<Db>, state: State<AppState>, limit: u32) -> Result<HashMap<String, Vec<MetricPoint>>, String> {
    let raw_days = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.settings.history.raw_days;
    db.recent_metrics(limit.clamp(1, MAX_RECENT_METRICS), now_ms() - i64::from(raw_days) * DAY_MS)
}

/// Disponibilité de chaque serveur (pings) sur les `days` derniers jours
#[tauri::command]
pub fn get_server_uptime(db: State<Db>, days: u32) -> Result<Vec<ServerUptime>, String> {
    db.server_uptime(now_ms() - i64::from(days.clamp(1, 730)) * DAY_MS)
}

/// Applique immédiatement la rétention configurée (sinon appliquée toutes les heures)
#[tauri::command]
pub fn prune_history(db: State<Db>, state: State<AppState>) -> Result<PruneReport, String> {
    let settings = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.settings.history.clone();
    db.prune(now_ms(), &settings)
}
