/// Commandes Tauri — Verrouillage de l'application
/// Les dérivations Argon2id (64 Mio, ~0,5 s) tournent dans `spawn_blocking` pour
/// ne pas monopoliser un thread du runtime asynchrone.
use tauri::{AppHandle, Manager, State};
use zeroize::Zeroizing;

use crate::{
    crypto,
    lock::{self, platform, platform::HelloOutcome, LockConfigPayload, LockManager, LockMethod, LockStatus},
    storage::AppState,
};

/// Exécute `f` sur un thread bloquant avec le gestionnaire de verrouillage
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&LockManager) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let worker = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&worker.state::<LockManager>()))
        .await
        .map_err(|e| format!("Tâche interrompue : {}", e))?
}

/// Disponibilité de Windows Hello (appel système bloquant, borné à 3 s : l'écran de
/// verrouillage attend cette réponse pour s'afficher)
async fn hello_available() -> bool {
    let check = tauri::async_runtime::spawn_blocking(platform::hello_available);
    matches!(tokio::time::timeout(std::time::Duration::from_secs(3), check).await, Ok(Ok(true)))
}

#[tauri::command]
pub async fn lock_status(app: AppHandle) -> Result<LockStatus, String> {
    let manager = app.state::<LockManager>();
    if manager.hello_available_cached().is_none() {
        manager.set_hello_available(hello_available().await);
    }
    Ok(lock::status(&app))
}

#[tauri::command]
pub fn lock_now(app: AppHandle) -> Result<LockStatus, String> {
    lock::lock_app(&app, "demande de l'utilisateur")?;
    Ok(lock::status(&app))
}

/// Activité clavier / souris remontée (avec limitation) par le frontend
#[tauri::command]
pub fn lock_activity(lock: State<'_, LockManager>) {
    lock.touch(lock::now_ms());
}

#[tauri::command]
pub async fn unlock_with_pin(app: AppHandle, pin: String) -> Result<LockStatus, String> {
    let pin = Zeroizing::new(pin);
    let cfg = lock::lock_config(&app)?;
    blocking(&app, move |m| m.unlock_with_pin(&cfg, &pin, lock::now_ms())).await?;
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}

#[tauri::command]
pub async fn unlock_with_password(app: AppHandle, password: String) -> Result<LockStatus, String> {
    let password = Zeroizing::new(password);
    blocking(&app, move |m| m.unlock_with_password(&password, lock::now_ms())).await?;
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}

#[tauri::command]
pub async fn unlock_with_hello(app: AppHandle) -> Result<LockStatus, String> {
    let cfg = lock::lock_config(&app)?;
    app.state::<LockManager>().check_hello_allowed(&cfg)?;
    let hwnd = main_window_handle(&app)?;
    let outcome = tauri::async_runtime::spawn_blocking(move || platform::hello_verify(hwnd, "Déverrouiller Server Power Manager"))
        .await
        .map_err(|e| format!("Tâche interrompue : {}", e))?;
    match outcome {
        HelloOutcome::Verified => app.state::<LockManager>().unlock_after_hello(&cfg, lock::now_ms())?,
        HelloOutcome::Canceled => return Err("Vérification Windows Hello annulée".into()),
        HelloOutcome::Failed(message) => return Err(message),
    }
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}

/// HWND de la fenêtre principale : l'invite Windows Hello s'affiche devant elle
#[cfg(windows)]
fn main_window_handle(app: &AppHandle) -> Result<isize, String> {
    let window = app.get_webview_window("main").ok_or("Fenêtre principale introuvable")?;
    window.hwnd().map(|h| h.0 as isize).map_err(|e| format!("Fenêtre principale : {}", e))
}

#[cfg(not(windows))]
fn main_window_handle(_app: &AppHandle) -> Result<isize, String> {
    Ok(0)
}

/// Enregistre la configuration du verrouillage (méthode, PIN, délais). Exige l'app
/// déverrouillée et le secret actuel si le verrouillage est déjà actif.
#[tauri::command]
pub async fn lock_configure(
    app: AppHandle,
    config: LockConfigPayload,
    new_pin: Option<String>,
    current_secret: Option<String>,
) -> Result<LockStatus, String> {
    crypto::ensure_unlocked()?;
    let new_pin = new_pin.map(Zeroizing::new);
    let current_secret = current_secret.map(Zeroizing::new);
    let current = lock::lock_config(&app)?;
    // Windows Hello demandé : disponibilité vérifiée à nouveau (et mise en cache)
    let hello = config.method == LockMethod::Hello && hello_available().await;
    if config.method == LockMethod::Hello {
        app.state::<LockManager>().set_hello_available(hello);
    }
    let next = blocking(&app, move |m| {
        m.verify_current(&current, current_secret.as_deref().map(String::as_str), lock::now_ms())?;
        m.build_config(&current, &config, new_pin.as_deref().map(String::as_str), hello)
    })
    .await?;
    let state = app.state::<AppState>();
    state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.lock = next;
    state.save()?;
    let manager = app.state::<LockManager>();
    manager.touch(lock::now_ms());
    lock::notify_changed(&app);
    log::info!("Configuration du verrouillage mise à jour");
    Ok(lock::status(&app))
}

#[tauri::command]
pub async fn master_password_enable(
    app: AppHandle,
    password: String,
    current_secret: Option<String>,
) -> Result<LockStatus, String> {
    crypto::ensure_unlocked()?;
    let password = Zeroizing::new(password);
    let current_secret = current_secret.map(Zeroizing::new);
    let cfg = lock::lock_config(&app)?;
    let key_version = app.state::<AppState>().data.lock().map_err(|e| format!("Erreur mutex: {}", e))?.key_version;
    blocking(&app, move |m| {
        m.verify_current(&cfg, current_secret.as_deref().map(String::as_str), lock::now_ms())?;
        m.enable_master_password(key_version, &password)
    })
    .await?;
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}

#[tauri::command]
pub async fn master_password_change(app: AppHandle, current: String, new_password: String) -> Result<LockStatus, String> {
    crypto::ensure_unlocked()?;
    let (current, new_password) = (Zeroizing::new(current), Zeroizing::new(new_password));
    blocking(&app, move |m| m.change_master_password(&current, &new_password, lock::now_ms())).await?;
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}

#[tauri::command]
pub async fn master_password_remove(app: AppHandle, current: String) -> Result<LockStatus, String> {
    crypto::ensure_unlocked()?;
    let current = Zeroizing::new(current);
    blocking(&app, move |m| m.remove_master_password(&current, lock::now_ms())).await?;
    lock::notify_changed(&app);
    Ok(lock::status(&app))
}
