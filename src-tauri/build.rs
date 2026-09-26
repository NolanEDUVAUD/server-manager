fn main() {
    // `tauri_build::build()` normally embeds a Windows application manifest
    // (requesting Common Controls v6, required by Tauri/Wry's window-
    // subclassing machinery) as a compiled resource, linked only into the
    // `bin` target's executable. Any other executable produced from this
    // crate — notably the `cargo test` harness binary for the `lib` target,
    // which links the same window-subclassing machinery because it embeds a
    // `Mutex<HashMap<String, Webview<Wry>>>` field (see `dashboard_state.rs`)
    // — does not get that manifest. Without it, the OS loader falls back to
    // the ancient default comctl32 (v5.82), can't resolve the v6-only
    // symbols the subclassing machinery imports (SetWindowSubclass,
    // DefSubclassProc, RemoveWindowSubclass, TaskDialogIndirect), and the
    // binary aborts at load time with STATUS_ENTRYPOINT_NOT_FOUND before any
    // test runs.
    //
    // Fix: embed the manifest ourselves via a linker flag
    // (`cargo:rustc-link-arg`, unscoped) so it reaches every linked
    // executable this crate produces (the `bin` target and the `lib` test
    // harness alike), and tell `tauri_build` not to embed its own manifest
    // resource, so there is exactly one source of the manifest and no
    // "duplicate resource" link error. `tauri_build` still handles the icon
    // and version-info resources as before — only the manifest sub-part is
    // opted out of.
    //
    // Note: `CARGO_CFG_WINDOWS` reflects the *target* platform inside a
    // build script (unlike `#[cfg(windows)]`, which would reflect the host
    // if this build script were ever cross-compiled), so it is the correct
    // check here.
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        let manifest_path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
            manifest_path.display()
        );
        println!("cargo:rerun-if-changed={}", manifest_path.display());

        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest())
                .app_manifest(app_manifest()),
        )
        .expect("failed to run tauri-build");
    } else {
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest()))
            .expect("failed to run tauri-build");
    }
}

/// Manifeste ACL de l'app. Sans lui, Tauri n'applique AUCUN contrôle d'accès aux
/// commandes de l'app : n'importe quelle page chargée dans un onglet web (origine
/// distante) pouvait appeler `ssh_execute` & co. Avec lui, chaque commande n'est
/// accessible que si une capability l'autorise (voir capabilities/main.json,
/// réservée à l'interface locale de la fenêtre principale).
fn app_manifest() -> tauri_build::AppManifest {
    tauri_build::AppManifest::new().commands(&[
        "add_group",
        "add_server",
        "ansible_list_playbooks",
        "ansible_run",
        "app_update_check",
        "app_update_info",
        "app_update_install",
        "apply_import_config",
        "backup_apply",
        "backup_cancel",
        "backup_export",
        "backup_inspect",
        "backup_run_now",
        "batch_send_input",
        "clear_events",
        "close_dashboard_tab",
        "cron_list",
        "cron_remove_managed",
        "delete_alert_rule",
        "delete_batch_task",
        "delete_custom_theme",
        "delete_folder",
        "delete_group",
        "delete_probe",
        "delete_schedule",
        "delete_server",
        "delete_snippet",
        "delete_tag",
        "detect_mac",
        "docker_action",
        "docker_list",
        "docker_logs",
        "export_config",
        "export_full_config",
        "fetch_extension_manifest",
        "forget_host_key",
        "get_alert_rules",
        "get_ansible_config",
        "get_autostart",
        "get_backup_settings",
        "get_batch_tasks",
        "get_data_path",
        "get_event_stats",
        "get_events",
        "get_extensions",
        "get_groups",
        "get_history_info",
        "get_integrations",
        "get_organisation",
        "get_probe_results",
        "get_probes",
        "get_recent_metrics",
        "get_schedules",
        "get_server_metrics",
        "get_server_uptime",
        "get_servers",
        "get_settings",
        "get_snippets",
        "import_config",
        "import_full_config",
        "install_extension",
        "lab_power_cancel",
        "lab_power_execute",
        "lab_power_plan",
        "lock_activity",
        "lock_configure",
        "lock_now",
        "lock_status",
        "loki_hosts",
        "loki_query",
        "loki_units",
        "master_password_change",
        "master_password_enable",
        "master_password_remove",
        "network_scan",
        "open_dashboard_tab",
        "ping_all",
        "ping_group",
        "ping_server",
        "proxmox_add_connection",
        "proxmox_backup_now",
        "proxmox_backup_report",
        "proxmox_cluster_health",
        "proxmox_delete_connection",
        "proxmox_list_connections",
        "proxmox_list_vms",
        "proxmox_migrate",
        "proxmox_migration_plan",
        "proxmox_task_status",
        "proxmox_test_connection",
        "proxmox_update_connection",
        "proxmox_vm_action",
        "proxmox_vm_clone",
        "proxmox_vm_snapshot_create",
        "proxmox_vm_snapshot_list",
        "proxmox_vm_snapshot_rollback",
        "prune_history",
        "read_extension_file",
        "resize_dashboard_tab",
        "run_batch",
        "run_probe_now",
        "run_schedule_now",
        "save_alert_rule",
        "save_ansible_config",
        "save_backup_settings",
        "save_batch_task",
        "save_custom_theme",
        "save_folder",
        "save_integration",
        "save_probe",
        "save_schedule",
        "save_snippet",
        "save_tag",
        "set_autostart",
        "set_dashboard_tab_visible",
        "set_extension_enabled",
        "ssh_agent_status",
        "ssh_execute",
        "ssh_key_delete",
        "ssh_key_deploy",
        "ssh_key_generate",
        "ssh_key_import",
        "ssh_key_import_cancel",
        "ssh_key_import_pick",
        "ssh_key_rename",
        "ssh_key_use_for_server",
        "ssh_keys_list",
        "ssh_reboot",
        "ssh_shutdown",
        "ssh_shutdown_group",
        "terminal_close",
        "terminal_open",
        "terminal_resize",
        "terminal_write",
        "test_alert_channels",
        "test_integration",
        "toggle_favorite",
        "toggle_server_in_group",
        "uninstall_extension",
        "unlock_with_hello",
        "unlock_with_password",
        "unlock_with_pin",
        "update_group",
        "update_server",
        "update_settings",
        "update_tray_status",
        "updates_scan",
        "upload_server_icon",
        "wake_group",
        "wake_on_lan",
    ])
}
