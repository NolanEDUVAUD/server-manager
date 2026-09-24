mod commands;
mod crypto;
mod dashboard_state;
mod models;
mod proxmox;
mod storage;

use commands::{dashboards, groups, ping, proxmox as proxmox_cmd, servers, settings, ssh, wol};
use storage::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .setup(|app| {
            // Charger les données persistées au démarrage
            let state = AppState::load(&app.handle());
            app.manage(state);
            app.manage(dashboard_state::DashboardState::default());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // ── Serveurs ──────────────────────────────────────
            servers::get_servers,
            servers::add_server,
            servers::update_server,
            servers::delete_server,
            // ── Groupes ───────────────────────────────────────
            groups::get_groups,
            groups::add_group,
            groups::update_group,
            groups::toggle_server_in_group,
            groups::delete_group,
            // ── Wake-on-LAN ───────────────────────────────────
            wol::wake_on_lan,
            wol::wake_group,
            // ── SSH ───────────────────────────────────────────
            ssh::ssh_shutdown,
            ssh::ssh_reboot,
            ssh::ssh_execute,
            ssh::ssh_shutdown_group,
            // ── Ping ──────────────────────────────────────────
            ping::ping_server,
            ping::ping_all,
            ping::ping_group,
            // ── Paramètres ────────────────────────────────────
            settings::get_settings,
            settings::update_settings,
            settings::export_config,
            settings::import_config,
            settings::get_data_path,
            settings::get_autostart,
            settings::set_autostart,
            settings::export_full_config,
            settings::import_full_config,
            settings::apply_import_config,
            settings::save_custom_theme,
            settings::delete_custom_theme,
            servers::upload_server_icon,
            // ── Proxmox ───────────────────────────────────────
            proxmox_cmd::proxmox_list_connections,
            proxmox_cmd::proxmox_add_connection,
            proxmox_cmd::proxmox_update_connection,
            proxmox_cmd::proxmox_delete_connection,
            proxmox_cmd::proxmox_test_connection,
            proxmox_cmd::proxmox_list_vms,
            proxmox_cmd::proxmox_vm_action,
            proxmox_cmd::proxmox_vm_snapshot_list,
            proxmox_cmd::proxmox_vm_snapshot_create,
            proxmox_cmd::proxmox_vm_snapshot_rollback,
            proxmox_cmd::proxmox_vm_clone,
            // ── Onglets web intégrés ────────────────────────
            dashboards::open_dashboard_tab,
            dashboards::close_dashboard_tab,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du démarrage de l'application Tauri");
}
