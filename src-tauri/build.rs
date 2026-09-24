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
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("failed to run tauri-build");
    } else {
        tauri_build::build();
    }
}
