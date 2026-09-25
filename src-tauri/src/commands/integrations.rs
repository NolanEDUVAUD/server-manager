/// Commandes Tauri — Intégrations (configuration des services externes)
use tauri::State;

use crate::{
    crypto,
    integrations::{apply_payload, resolve, IntegrationKind, IntegrationPayload, IntegrationView},
    storage::AppState,
};

#[tauri::command]
pub fn get_integrations(state: State<AppState>) -> Result<Vec<IntegrationView>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.integrations.iter().map(IntegrationView::from).collect())
}

#[tauri::command]
pub fn save_integration(state: State<AppState>, payload: IntegrationPayload) -> Result<IntegrationView, String> {
    let view = {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let key = crypto::data_key(&data)?;
        let kind = payload.kind;
        apply_payload(&mut data.integrations, payload, &key)?;
        data.integrations
            .iter()
            .find(|i| i.kind == kind)
            .map(IntegrationView::from)
            .ok_or("Intégration introuvable après enregistrement")?
    };
    state.save()?;
    Ok(view)
}

/// Test de connexion authentifié propre au service (voir integration_checks)
#[tauri::command]
pub async fn test_integration(state: State<'_, AppState>, kind: IntegrationKind) -> Result<String, String> {
    let resolved = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        resolve(&data, kind)?
    };
    crate::integration_checks::check(kind, &resolved).await
}
