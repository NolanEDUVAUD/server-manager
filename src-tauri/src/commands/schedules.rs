/// Commandes Tauri — Planificateur
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    scheduler::{run_schedule, validate, Schedule},
    storage::AppState,
};

#[tauri::command]
pub fn get_schedules(state: State<AppState>) -> Result<Vec<Schedule>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.schedules.clone())
}

/// Ajoute (id vide) ou met à jour une tâche, après validation.
#[tauri::command]
pub fn save_schedule(state: State<AppState>, mut schedule: Schedule) -> Result<Schedule, String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        validate(&schedule, &data)?;
        schedule.name = schedule.name.trim().to_string();
        schedule.days.sort_unstable();
        schedule.days.dedup();
        match data.schedules.iter_mut().find(|s| s.id == schedule.id && !schedule.id.is_empty()) {
            Some(existing) => {
                // Modifier l'heure ne doit pas faire perdre la trace du dernier créneau exécuté
                schedule.last_run = existing.last_run;
                *existing = schedule.clone();
            }
            None => {
                schedule.id = Uuid::new_v4().to_string();
                schedule.last_run = None;
                data.schedules.push(schedule.clone());
            }
        }
    }
    state.save()?;
    Ok(schedule)
}

#[tauri::command]
pub fn delete_schedule(state: State<AppState>, id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.schedules.retain(|s| s.id != id);
    }
    state.save()
}

#[tauri::command]
pub async fn run_schedule_now(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    let schedule = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.schedules
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or_else(|| format!("Tâche introuvable : {}", id))?
    };
    run_schedule(&app, &schedule).await;
    Ok(())
}
