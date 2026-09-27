/// Commandes Tauri — Règles d'alerte
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::{
    alerts::{send_push, AlertEngine, AlertRule},
    storage::AppState,
};
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
pub fn get_alert_rules(state: State<AppState>) -> Result<Vec<AlertRule>, String> {
    let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
    Ok(data.alert_rules.clone())
}

/// Ajoute (id vide) ou met à jour une règle
#[tauri::command]
pub fn save_alert_rule(app: AppHandle, state: State<AppState>, mut rule: AlertRule) -> Result<AlertRule, String> {
    if rule.name.trim().is_empty() {
        return Err("Le nom de la règle est requis".into());
    }
    rule.name = rule.name.trim().to_string();
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        match data.alert_rules.iter_mut().find(|r| r.id == rule.id && !rule.id.is_empty()) {
            Some(existing) => *existing = rule.clone(),
            None => {
                rule.id = Uuid::new_v4().to_string();
                data.alert_rules.push(rule.clone());
            }
        }
    }
    state.save()?;
    // Toute modification (dont la désactivation) invalide le suivi en cours de cette règle :
    // sans ça un état périmé peut déclencher un « Résolu » fantôme à la prochaine évaluation.
    if let Some(engine) = app.try_state::<AlertEngine>() {
        engine.clear_rule(&rule.id);
    }
    Ok(rule)
}

#[tauri::command]
pub fn delete_alert_rule(app: AppHandle, state: State<AppState>, id: String) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.alert_rules.retain(|r| r.id != id);
    }
    state.save()?;
    if let Some(engine) = app.try_state::<AlertEngine>() {
        engine.clear_rule(&id);
    }
    Ok(())
}

/// Envoie une notification de test sur le bureau et tous les canaux push actifs
#[tauri::command]
pub fn test_alert_channels(app: AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Test d'alerte — Server Manager")
        .body("Si tu lis ceci, les notifications Windows fonctionnent.")
        .show()
        .map_err(|e| e.to_string())?;
    send_push(&app, "Test d'alerte — Server Manager".into(), "Les notifications push fonctionnent.".into(), false);
    Ok(())
}
