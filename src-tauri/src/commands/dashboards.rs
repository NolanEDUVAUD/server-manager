/// Commandes Tauri — Onglets web intégrés (multiwebview)
use tauri::{LogicalPosition, LogicalSize, State, WebviewUrl, Window};

use crate::dashboard_state::DashboardState;

#[tauri::command]
pub fn open_dashboard_tab(
    window: Window,
    state: State<DashboardState>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    if let Some(webview) = webviews.get(&label) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Erreur de positionnement: {}", e))?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("Erreur de redimensionnement: {}", e))?;
        webview
            .show()
            .map_err(|e| format!("Erreur d'affichage: {}", e))?;
        return Ok(());
    }

    let parsed_url = url
        .parse()
        .map_err(|e| format!("URL invalide '{}': {}", url, e))?;
    let builder = tauri::webview::WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed_url));
    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| format!("Impossible de créer l'onglet: {}", e))?;

    log::info!("Onglet web ouvert : {} ({})", label, url);
    webviews.insert(label, webview);
    Ok(())
}

#[tauri::command]
pub fn close_dashboard_tab(state: State<DashboardState>, label: String) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    if let Some(webview) = webviews.remove(&label) {
        webview
            .close()
            .map_err(|e| format!("Erreur de fermeture: {}", e))?;
        log::info!("Onglet web fermé : {}", label);
    }
    // Idempotent : si le label n'existe pas (déjà fermé côté OS), on ne fait rien
    // et on retourne Ok, sans jamais paniquer.
    Ok(())
}

#[tauri::command]
pub fn set_dashboard_tab_visible(
    state: State<DashboardState>,
    label: String,
    visible: bool,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Onglet introuvable: {}", label))?;

    if visible {
        webview.show().map_err(|e| format!("Erreur d'affichage: {}", e))
    } else {
        webview.hide().map_err(|e| format!("Erreur de masquage: {}", e))
    }
}

#[tauri::command]
pub fn resize_dashboard_tab(
    state: State<DashboardState>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Onglet introuvable: {}", label))?;

    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("Erreur de positionnement: {}", e))?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("Erreur de redimensionnement: {}", e))?;
    Ok(())
}
