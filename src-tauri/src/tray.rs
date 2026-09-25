/// Icône de zone de notification : état global, réveil rapide des groupes, réouverture
use tauri::{
    menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};
use tauri_plugin_notification::NotificationExt;

use crate::{commands::wol::wake_group_inner, events::EventLog, storage::AppState};

pub const TRAY_ID: &str = "main";
const WOL_PREFIX: &str = "wol:";
const LOCK_ID: &str = "lock";

/// Textes du menu et de l'infobulle dans la langue de l'interface
pub struct TrayTexts {
    pub open: &'static str,
    pub wake: &'static str,
    pub lock: &'static str,
    pub quit: &'static str,
    pub online: &'static str,
}

pub fn texts(language: &str) -> TrayTexts {
    match language {
        "en" => TrayTexts { open: "Open Server Manager", wake: "Wake a group (WoL)", lock: "Lock now", quit: "Quit", online: "online" },
        _ => TrayTexts {
            open: "Ouvrir Server Manager",
            wake: "Réveiller un groupe (WoL)",
            lock: "Verrouiller maintenant",
            quit: "Quitter",
            online: "en ligne",
        },
    }
}

fn language(app: &AppHandle) -> String {
    app.state::<AppState>().data.lock().map(|d| d.settings.general.language.clone()).unwrap_or_default()
}

/// Texte de l'infobulle selon le nombre de serveurs en ligne
pub fn tooltip(online: u32, total: u32, language: &str) -> String {
    if total == 0 {
        "Server Manager".into()
    } else {
        format!("Server Manager — {}/{} {}", online, total, texts(language).online)
    }
}

pub fn tooltip_for(app: &AppHandle, online: u32, total: u32) -> String {
    tooltip(online, total, &language(app))
}

/// Identifiant d'élément de menu → groupe à réveiller
pub fn parse_wol_id(id: &str) -> Option<&str> {
    id.strip_prefix(WOL_PREFIX).filter(|g| !g.is_empty())
}

/// Menu reconstruit à partir des groupes actuels. Pas d'arrêt ici, volontairement :
/// un menu de zone de notification ne permet pas de demander une confirmation.
pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let (groups, lock_cfg): (Vec<(String, String)>, _) = app
        .state::<AppState>()
        .data
        .lock()
        .map(|d| (d.groups.iter().map(|g| (g.id.clone(), g.name.clone())).collect(), d.lock.clone()))
        .unwrap_or_default();
    // Verrouillée : WoL grisé ; « Verrouiller » seulement si une méthode est configurée
    let (lock_enabled, locked) = app
        .try_state::<crate::lock::LockManager>()
        .map(|l| (l.is_enabled(&lock_cfg), l.is_locked()))
        .unwrap_or((false, false));

    let tx = texts(&language(app));
    let open = MenuItem::with_id(app, "open", tx.open, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let wol_items: Vec<MenuItem<Wry>> = groups
        .iter()
        .map(|(id, name)| MenuItem::with_id(app, format!("{}{}", WOL_PREFIX, id), name, true, None::<&str>))
        .collect::<tauri::Result<_>>()?;
    let wol_refs: Vec<&dyn IsMenuItem<Wry>> = wol_items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let wake = Submenu::with_items(app, tx.wake, !groups.is_empty() && !locked, &wol_refs)?;
    let lock = MenuItem::with_id(app, LOCK_ID, tx.lock, !locked, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", tx.quit, true, None::<&str>)?;
    if lock_enabled {
        Menu::with_items(app, &[&open, &sep1, &wake, &lock, &sep2, &quit])
    } else {
        Menu::with_items(app, &[&open, &sep1, &wake, &sep2, &quit])
    }
}

/// Reconstruit le menu (groupes modifiés, verrouillage / déverrouillage)
pub fn refresh_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id(TRAY_ID), build_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "open" => show_main_window(app),
        "quit" => app.exit(0),
        LOCK_ID => {
            if let Err(e) = crate::lock::lock_app(app, "zone de notification") {
                log::warn!("Verrouillage impossible : {}", e);
            }
        }
        _ => {
            if let Some(group_id) = parse_wol_id(id) {
                let app = app.clone();
                let group_id = group_id.to_string();
                tauri::async_runtime::spawn(async move {
                    let result = wake_group_inner(&app.state::<AppState>(), &app.state::<EventLog>(), &group_id);
                    let body = match result {
                        Ok(lines) => lines.join("\n"),
                        Err(e) => e,
                    };
                    let _ = app.notification().builder().title("Wake-on-LAN").body(body).show();
                });
            }
        }
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Server Manager")
        .menu(&build_menu(app)?)
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu)
        .on_tray_icon_event(|tray, event| {
            // Clic gauche : rouvrir la fenêtre ; clic droit : menu
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tooltip_shows_online_count() {
        assert_eq!(tooltip(5, 6, "fr"), "Server Manager — 5/6 en ligne");
        assert_eq!(tooltip(5, 6, "en"), "Server Manager — 5/6 online");
        assert_eq!(tooltip(0, 0, "en"), "Server Manager");
        // Langue inconnue ou absente : français
        assert_eq!(texts("").quit, "Quitter");
    }

    #[test]
    fn wol_menu_ids_round_trip() {
        assert_eq!(parse_wol_id("wol:abc-123"), Some("abc-123"));
        assert_eq!(parse_wol_id("wol:"), None);
        assert_eq!(parse_wol_id("quit"), None);
    }
}
