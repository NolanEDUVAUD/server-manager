mod alerts;
mod app_update;
mod backup;
mod batch;
mod commands;
mod cron;
mod crypto;
mod dashboard_state;
mod db;
mod discovery;
mod docker;
mod events;
mod external;
mod integration_checks;
mod integrations;
mod keystore;
mod lab_power;
mod lock;
mod loki;
mod known_hosts;
mod metrics;
mod monitor;
mod notify;
mod models;
mod organisation;
mod probes;
mod proxmox;
mod scheduler;
mod smart_batch;
mod storage;
mod terminal;
mod tray;
mod updates;
// ── Authentification SSH par clé (1.2) ──
mod ppk;
mod ssh_auth;
mod ssh_keys;
#[cfg(test)]
mod ssh_test_server;

use commands::{backup as backup_cmd, lock as lock_cmd, loki as loki_cmd, updates as updates_cmd, batch as batch_cmd, snippets as snippets_cmd, discovery as discovery_cmd, lab_power as lab_power_cmd, probes as probes_cmd, alerts as alerts_cmd, tray as tray_cmd, dashboards, integrations as integrations_cmd, docker as docker_cmd, events as events_cmd, external as external_cmd, extensions as extensions_cmd, groups, history as history_cmd, schedules, metrics as metrics_cmd, ping, terminal as terminal_cmd, proxmox as proxmox_cmd, servers, settings, ssh, wol};
use commands::organisation as organisation_cmd;
use commands::ssh_keys as ssh_keys_cmd;
use storage::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .setup(|app| {
            // Charger les données persistées au démarrage
            let state = AppState::load(&app.handle());
            // Empreintes SSH connues, à côté de data.json
            if let Some(dir) = state.data_path.parent() {
                known_hosts::init(dir.join("known_hosts.json"));
            }
            // Clé maître : lecture du coffre Windows, migration des anciens secrets,
            // démarrage verrouillé si un verrouillage ou un mot de passe maître est configuré
            let lock_manager = lock::boot_app(&state);
            // Base d'historique (événements, mesures, agrégats) à côté de data.json
            let db = db::Db::open(&state.data_path.with_file_name("history.db"));
            let probe_ids: Vec<String> = state.data.lock().map(|d| d.probes.iter().map(|p| p.id.clone()).collect()).unwrap_or_default();
            app.manage(state);
            app.manage(lock_manager);
            app.manage(db);
            app.manage(dashboard_state::DashboardState::default());
            app.manage(terminal::TerminalState::default());
            app.manage(batch::BatchInputs::default());
            app.manage(smart_batch::OsCache::default());
            app.manage(events::EventLog::load(app.handle()));
            app.manage(alerts::AlertEngine::new(app.handle()));
            let probe_state = probes::ProbeState::default();
            probe_state.restore(&app.state::<db::Db>(), &probe_ids, events::now_ms());
            app.manage(probe_state);
            app.manage(commands::lab_power::LabPowerState::default());
            app.manage(commands::backup::BackupState::default());
            app.manage(commands::ssh_keys::KeyImportState::default());
            // Boucle du planificateur (tâches WoL / arrêt programmées)
            scheduler::start(app.handle().clone());
            // Surveillance continue (ping + métriques), indépendante de la fenêtre
            monitor::start(app.handle().clone());
            probes::start(app.handle().clone());
            // Rétention de l'historique (purge horaire)
            db::start_maintenance(app.handle().clone());
            // Sauvegarde chiffrée automatique (si activée)
            commands::backup::start(app.handle().clone());
            // Verrouillage automatique (inactivité, session Windows verrouillée)
            lock::start(app.handle().clone());
            // Icône de zone de notification ; la fenêtre, créée masquée, n'est
            // affichée que si l'utilisateur n'a pas demandé un démarrage minimisé
            tray::create(app.handle())?;
            let start_minimized = app
                .state::<AppState>()
                .data
                .lock()
                .map(|d| d.settings.general.start_minimized)
                .unwrap_or(false);
            if !start_minimized {
                tray::show_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Fermer = réduire dans la zone de notification (si activé) : le planificateur,
            // la collecte et les alertes continuent de tourner
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .app_handle()
                    .state::<AppState>()
                    .data
                    .lock()
                    .map(|d| d.settings.general.close_to_tray)
                    .unwrap_or(true);
                if to_tray && window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        // Ouverture du navigateur par défaut (releases, rapport de bug, soutien du projet) :
        // la webview n'a aucune permission de ce plugin, seule la commande
        // `open_external_url` (qui valide l'adresse, voir `external.rs`) peut l'appeler.
        .plugin(tauri_plugin_opener::init())
        // ── Mise à jour automatique de l'application (1.5) ──
        .plugin(commands::app_update::plugin())
        .manage(commands::app_update::AppUpdateState::default())
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
            ssh::forget_host_key,
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
            dashboards::set_dashboard_tab_visible,
            dashboards::resize_dashboard_tab,
            // ── Monitoring des ressources ─────────────────────
            metrics_cmd::get_server_metrics,
            // ── Historique ────────────────────────────────────
            events_cmd::get_events,
            events_cmd::get_event_stats,
            events_cmd::clear_events,
            // ── Base d'historique (SQLite) ──────────────────────
            history_cmd::get_history_info,
            history_cmd::get_recent_metrics,
            history_cmd::get_server_uptime,
            history_cmd::prune_history,
            // ── Planificateur ─────────────────────────────────
            schedules::get_schedules,
            schedules::save_schedule,
            schedules::delete_schedule,
            schedules::run_schedule_now,
            schedules::cron_list,
            schedules::cron_remove_managed,
            // ── Docker ────────────────────────────────────────
            docker_cmd::docker_list,
            docker_cmd::docker_action,
            docker_cmd::docker_logs,
            // ── Intégrations ────────────────────────────────────
            integrations_cmd::get_integrations,
            integrations_cmd::save_integration,
            integrations_cmd::test_integration,
            // ── Zone de notification ────────────────────────────
            tray_cmd::update_tray_status,
            tray_cmd::quit_app,
            // ── Alertes ─────────────────────────────────────────
            alerts_cmd::get_alert_rules,
            alerts_cmd::save_alert_rule,
            alerts_cmd::delete_alert_rule,
            alerts_cmd::test_alert_channels,
            // ── Sondes ──────────────────────────────────────────
            probes_cmd::get_probes,
            probes_cmd::get_probe_results,
            probes_cmd::save_probe,
            probes_cmd::delete_probe,
            probes_cmd::run_probe_now,
            // ── Proxmox avancé ──────────────────────────────────
            proxmox_cmd::proxmox_cluster_health,
            // ── Proxmox avancé ──────────────────────────────────
            proxmox_cmd::proxmox_backup_report,
            proxmox_cmd::proxmox_backup_now,
            // ── Proxmox avancé ──────────────────────────────────
            proxmox_cmd::proxmox_migration_plan,
            proxmox_cmd::proxmox_migrate,
            proxmox_cmd::proxmox_task_status,
            // ── Arrêt / démarrage du lab ────────────────────────
            lab_power_cmd::lab_power_plan,
            lab_power_cmd::lab_power_execute,
            lab_power_cmd::lab_power_cancel,
            // ── Découverte réseau ───────────────────────────────
            discovery_cmd::detect_mac,
            discovery_cmd::network_scan,
            discovery_cmd::get_routes,
            discovery_cmd::get_extra_subnets,
            discovery_cmd::get_wlan_info,
            discovery_cmd::traceroute_lite,
            // ── Commandes mémorisées ────────────────────────────
            snippets_cmd::get_snippets,
            snippets_cmd::save_snippet,
            snippets_cmd::delete_snippet,
            // ── Tâches en lot / Ansible ─────────────────────────
            batch_cmd::get_batch_tasks,
            batch_cmd::save_batch_task,
            batch_cmd::delete_batch_task,
            batch_cmd::run_batch,
            batch_cmd::batch_send_input,
            batch_cmd::get_ansible_config,
            batch_cmd::save_ansible_config,
            batch_cmd::ansible_list_playbooks,
            batch_cmd::ansible_run,
            batch_cmd::smart_batch_detect_os,
            batch_cmd::smart_batch_preview,
            batch_cmd::smart_batch_run,
            // ── Mises à jour ────────────────────────────────────
            updates_cmd::updates_scan,
            // ── Logs Loki ───────────────────────────────────────
            loki_cmd::loki_hosts,
            loki_cmd::loki_units,
            loki_cmd::loki_query,
            // ── Console SSH ───────────────────────────────────
            terminal_cmd::terminal_open,
            terminal_cmd::terminal_write,
            terminal_cmd::terminal_resize,
            terminal_cmd::terminal_close,
            // ── Organisation (tags, dossiers, favoris) ──────────
            organisation_cmd::get_organisation,
            organisation_cmd::save_tag,
            organisation_cmd::delete_tag,
            organisation_cmd::save_folder,
            organisation_cmd::delete_folder,
            organisation_cmd::toggle_favorite,
            // ── Mise à jour automatique de l'application (1.5) ──
            commands::app_update::app_update_info,
            commands::app_update::app_update_check,
            commands::app_update::app_update_install,
            commands::app_update::check_github_release,
            // ── Ouverture d'adresses externes (B4) ──────────────
            external_cmd::open_external_url,
            // ── Verrouillage de l'application (1.3) ───────────
            lock_cmd::lock_status,
            lock_cmd::lock_now,
            lock_cmd::lock_activity,
            lock_cmd::lock_configure,
            lock_cmd::unlock_with_pin,
            lock_cmd::unlock_with_password,
            lock_cmd::unlock_with_hello,
            lock_cmd::master_password_enable,
            lock_cmd::master_password_change,
            lock_cmd::master_password_remove,
            // ── Sauvegarde et restauration chiffrées (1.4) ──
            backup_cmd::backup_export,
            backup_cmd::backup_inspect,
            backup_cmd::backup_apply,
            backup_cmd::backup_cancel,
            backup_cmd::get_backup_settings,
            backup_cmd::save_backup_settings,
            backup_cmd::backup_run_now,
            // ── Authentification SSH par clé (1.2) ──────────────
            ssh_keys_cmd::ssh_keys_list,
            ssh_keys_cmd::ssh_key_generate,
            ssh_keys_cmd::ssh_key_import_pick,
            ssh_keys_cmd::ssh_key_import,
            ssh_keys_cmd::ssh_key_import_cancel,
            ssh_keys_cmd::ssh_key_rename,
            ssh_keys_cmd::ssh_key_delete,
            ssh_keys_cmd::ssh_key_deploy,
            ssh_keys_cmd::ssh_key_use_for_server,
            // ── Extensions communautaires (F1) ──────────────────
            extensions_cmd::get_extensions,
            extensions_cmd::install_extension,
            extensions_cmd::set_extension_enabled,
            extensions_cmd::uninstall_extension,
            extensions_cmd::read_extension_file,
            extensions_cmd::fetch_extension_manifest,
        ])
        .run(tauri::generate_context!())
        .expect("Erreur lors du démarrage de l'application Tauri");
}

#[cfg(test)]
mod acl_tests {
    use std::collections::BTreeSet;

    /// Noms des commandes enregistrées dans `generate_handler!`
    fn handler_commands() -> BTreeSet<String> {
        let src = include_str!("lib.rs");
        let block = src.split("generate_handler![").nth(1).unwrap().split("])").next().unwrap();
        block
            .lines()
            .map(str::trim)
            .filter(|l| !l.starts_with("//") && l.contains("::"))
            .map(|l| l.trim_end_matches(',').rsplit("::").next().unwrap().to_string())
            .collect()
    }

    /// Une commande oubliée dans build.rs ou dans la capability serait refusée par l'ACL
    /// (« not allowed ») : les trois listes doivent rester identiques.
    #[test]
    fn every_command_is_declared_in_manifest_and_capability() {
        let handlers = handler_commands();

        let build = include_str!("../build.rs");
        let manifest: BTreeSet<String> = build
            .split(".commands(&[").nth(1).unwrap().split("])").next().unwrap()
            .split('"').skip(1).step_by(2).map(str::to_string).collect();
        assert_eq!(handlers, manifest, "build.rs (app_manifest) ≠ generate_handler!");

        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        let allowed: BTreeSet<String> = cap["permissions"].as_array().unwrap().iter()
            .filter_map(|p| p.as_str()?.strip_prefix("allow-").map(|c| c.replace('-', "_")))
            .collect();
        assert_eq!(handlers, allowed, "capabilities/main.json ≠ generate_handler!");
    }

    /// La capability ne doit jamais s'ouvrir aux origines distantes (onglets web)
    #[test]
    fn capability_is_local_only() {
        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/main.json")).unwrap();
        assert!(cap.get("remote").is_none());
        assert_eq!(cap["webviews"], serde_json::json!(["main"]));
    }
}

/// Outil de développement (ignoré par défaut) : exécute une commande sur un serveur
/// du homelab avec les identifiants réels de l'app (clé maître Windows).
/// Usage : DEV_SERVER=minipc DEV_CMD="pvesh get /cluster/status --output-format json" \
///         cargo test dev_exec -- --ignored --nocapture
#[cfg(test)]
mod dev_tools {
    #[tokio::test]
    #[ignore]
    async fn dev_exec() {
        let server = std::env::var("DEV_SERVER").expect("DEV_SERVER");
        let cmd = std::env::var("DEV_CMD").expect("DEV_CMD");
        let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.homelab.server-manager");
        let data = crate::storage::load_app_data(&dir.join("data.json"));
        crate::crypto::set_master_key(crate::keystore::load_or_create_master_key().unwrap());
        crate::known_hosts::init(dir.join("known_hosts.json"));
        let s = data.servers.iter().find(|s| s.name == server || s.ip == server).expect("serveur inconnu");
        let target = crate::ssh_auth::resolve_ssh(&data, &s.id).unwrap();
        let r = crate::commands::ssh::execute_ssh(&target, &cmd, 20).await.unwrap();
        println!("===SORTIE===\n{}\n===FIN=== (succès : {})", r.output, r.success);
    }
}
