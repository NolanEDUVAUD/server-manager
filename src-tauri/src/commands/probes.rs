/// Commandes Tauri — Sondes de services
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::{
    probes::{execute, validate, Probe, ProbeResult, ProbeState},
    storage::AppState,
};

#[tauri::command]
pub fn get_probes(state: State<AppState>) -> Result<Vec<Probe>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.probes.clone())
}

/// Derniers résultats connus (pour l'affichage à l'ouverture de la page)
#[tauri::command]
pub fn get_probe_results(probes: State<ProbeState>) -> Vec<ProbeResult> {
    probes.latest()
}

/// Ajoute (id vide) ou met à jour une sonde, puis l'exécute immédiatement
#[tauri::command]
pub async fn save_probe(app: AppHandle, state: State<'_, AppState>, mut probe: Probe) -> Result<Probe, String> {
    validate(&probe)?;
    probe.name = probe.name.trim().to_string();
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        match data.probes.iter_mut().find(|p| p.id == probe.id && !probe.id.is_empty()) {
            Some(existing) => *existing = probe.clone(),
            None => {
                probe.id = Uuid::new_v4().to_string();
                data.probes.push(probe.clone());
            }
        }
    }
    state.save()?;
    if probe.enabled {
        execute(&app, &probe).await;
    }
    Ok(probe)
}

#[tauri::command]
pub fn delete_probe(state: State<AppState>, probes: State<ProbeState>, id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.probes.retain(|p| p.id != id);
    }
    probes.forget(&id);
    state.save()
}

#[tauri::command]
pub async fn run_probe_now(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<ProbeResult, String> {
    let probe = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.probes.iter().find(|p| p.id == id).cloned().ok_or("Sonde introuvable")?
    };
    Ok(execute(&app, &probe).await)
}
