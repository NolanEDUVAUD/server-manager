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
        "apply_import_config",
        "clear_events",
        "close_dashboard_tab",
        "cron_list",
        "cron_remove_managed",
        "delete_alert_rule",
        "delete_custom_theme",
        "delete_group",
        "delete_probe",
        "delete_schedule",
        "delete_server",
        "docker_action",
        "docker_list",
        "docker_logs",
        "export_config",
        "export_full_config",
        "forget_host_key",
        "get_alert_rules",
        "get_autostart",
        "get_data_path",
        "get_event_stats",
        "get_events",
        "get_groups",
        "get_integrations",
        "get_probe_results",
        "get_probes",
        "get_schedules",
        "get_server_metrics",
        "get_servers",
        "get_settings",
        "import_config",
        "import_full_config",
        "open_dashboard_tab",
        "ping_all",
        "ping_group",
        "ping_server",
        "proxmox_add_connection",
        "proxmox_delete_connection",
        "proxmox_list_connections",
        "proxmox_list_vms",
        "proxmox_test_connection",
        "proxmox_update_connection",
        "proxmox_vm_action",
        "proxmox_vm_clone",
        "proxmox_vm_snapshot_create",
        "proxmox_vm_snapshot_list",
        "proxmox_vm_snapshot_rollback",
        "resize_dashboard_tab",
        "run_probe_now",
        "run_schedule_now",
        "save_alert_rule",
        "save_custom_theme",
        "save_integration",
        "save_probe",
        "save_schedule",
        "set_autostart",
        "set_dashboard_tab_visible",
        "ssh_execute",
        "ssh_reboot",
        "ssh_shutdown",
        "ssh_shutdown_group",
        "terminal_close",
        "terminal_open",
        "terminal_resize",
        "terminal_write",
        "test_alert_channels",
        "test_integration",
        "toggle_server_in_group",
        "update_group",
        "update_server",
        "update_settings",
        "update_tray_status",
        "upload_server_icon",
        "wake_group",
        "wake_on_lan",
    ])
}
