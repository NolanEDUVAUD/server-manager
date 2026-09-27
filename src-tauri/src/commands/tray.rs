/// Commandes Tauri — Icône de zone de notification
use tauri::AppHandle;

use crate::tray::{build_menu, tooltip_for, TRAY_ID};

/// Appelée par le frontend après chaque ping : infobulle « X/Y en ligne » et menu
/// reconstruit (les groupes ont pu changer).
#[tauri::command]
pub fn update_tray_status(app: AppHandle, online: u32, total: u32) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or("Icône de zone de notification absente")?;
    tray.set_tooltip(Some(tooltip_for(&app, online, total))).map_err(|e| e.to_string())?;
    tray.set_menu(Some(build_menu(&app).map_err(|e| e.to_string())?)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Quitte réellement l'application (la fermeture de la fenêtre la réduit seulement
/// dans la zone de notification). Utilisée par le refus de l'EULA.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}
