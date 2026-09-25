/// Commandes Tauri — Sauvegarde et restauration chiffrées (`.spmbackup`)
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

use crate::{
    backup::{self, BackupConfig, BackupConfigView, BackupPayload, BackupSummary},
    crypto,
    events::{now_ms, EventKind, EventLog},
    known_hosts,
    storage::AppState,
};

/// Restauration déchiffrée en attente de confirmation (jamais envoyée au frontend)
#[derive(Default)]
pub struct BackupState {
    pending: Mutex<Option<BackupPayload>>,
}

const FILE_FILTER: &str = "Sauvegarde Server Power Manager";

fn lock_err(e: impl std::fmt::Display) -> String {
    format!("Erreur mutex: {}", e)
}

/// Charge utile de la configuration actuelle : secrets rechiffrés par une clé de transfert
fn current_payload(state: &AppState) -> Result<BackupPayload, String> {
    crypto::ensure_unlocked()?;
    let data = state.data.lock().map_err(lock_err)?;
    let key = crypto::data_key(&data)?;
    backup::build_payload(&data, &key, known_hosts::snapshot(), chrono::Utc::now().to_rfc3339())
}

/// Argon2id (64 Mio) prend une fraction de seconde : hors du fil des commandes
async fn seal_payload(payload: BackupPayload, passphrase: Zeroizing<String>) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || backup::export_bytes(&payload, &passphrase, backup::EXPORT_KDF))
        .await
        .map_err(|e| format!("Chiffrement interrompu : {}", e))?
}

/// Exporte toute la configuration, secrets compris, chiffrée par la phrase de passe
#[tauri::command]
pub async fn backup_export(app: AppHandle, state: State<'_, AppState>, passphrase: String) -> Result<String, String> {
    let passphrase = Zeroizing::new(passphrase);
    backup::validate_passphrase(&passphrase)?;
    crypto::ensure_unlocked()?;
    let name = format!("spm-{}.spmbackup", chrono::Local::now().format("%Y%m%d-%H%M"));
    let path = app
        .dialog()
        .file()
        .set_title("Enregistrer la sauvegarde chiffrée")
        .set_file_name(&name)
        .add_filter(FILE_FILTER, &["spmbackup"])
        .blocking_save_file()
        .ok_or("Export annulé")?
        .into_path()
        .map_err(|e| e.to_string())?;
    let payload = current_payload(&state)?;
    let bytes = seal_payload(payload, passphrase).await?;
    backup::write_atomic(&path, &bytes)?;
    log::info!("Sauvegarde chiffrée exportée");
    Ok(path.to_string_lossy().into_owned())
}

/// Déchiffre une sauvegarde choisie par l'utilisateur et renvoie son aperçu ; la
/// restauration reste en attente jusqu'à `backup_apply`.
#[tauri::command]
pub async fn backup_inspect(app: AppHandle, pending: State<'_, BackupState>, passphrase: String) -> Result<BackupSummary, String> {
    let passphrase = Zeroizing::new(passphrase);
    crypto::ensure_unlocked()?;
    let path = app
        .dialog()
        .file()
        .set_title("Restaurer une sauvegarde chiffrée")
        .add_filter(FILE_FILTER, &["spmbackup"])
        .blocking_pick_file()
        .ok_or("Restauration annulée")?
        .into_path()
        .map_err(|e| e.to_string())?;
    let bytes = backup::read_limited(&path)?;
    let payload = tauri::async_runtime::spawn_blocking(move || backup::import_bytes(&bytes, &passphrase))
        .await
        .map_err(|e| format!("Déchiffrement interrompu : {}", e))??;
    let summary = payload.summary();
    *pending.pending.lock().map_err(lock_err)? = Some(payload);
    Ok(summary)
}

/// Remplace toute la configuration par la sauvegarde en attente (après confirmation)
#[tauri::command]
pub fn backup_apply(app: AppHandle, state: State<AppState>, pending: State<BackupState>) -> Result<(), String> {
    crypto::ensure_unlocked()?;
    let payload = pending.pending.lock().map_err(lock_err)?.take().ok_or("Aucune restauration en attente")?;
    let master = crypto::vault().master_key()?;
    let mut restored = backup::into_local_data(&payload, &master)?;

    // Copie de sécurité de la configuration actuelle (toujours chiffrée par la clé de ce PC)
    if state.data_path.exists() {
        std::fs::copy(&state.data_path, state.data_path.with_file_name("data.json.before-restore.bak"))
            .map_err(|e| format!("Copie de sécurité de la configuration impossible : {}", e))?;
    }
    {
        let mut data = state.data.lock().map_err(lock_err)?;
        // Verrouillage et sauvegarde automatique restent ceux de cette machine
        restored.lock = data.lock.clone();
        restored.backup = data.backup.clone();
        *data = restored;
    }
    state.save()?;
    match known_hosts::merge_restored(payload.known_hosts.clone()) {
        Ok(n) => log::info!("Configuration restaurée ({} empreinte(s) SSH ajoutée(s))", n),
        Err(e) => log::warn!("Empreintes SSH non restaurées : {}", e),
    }
    crate::tray::refresh_menu(&app);
    Ok(())
}

#[tauri::command]
pub fn backup_cancel(pending: State<BackupState>) -> Result<(), String> {
    pending.pending.lock().map_err(lock_err)?.take();
    Ok(())
}

#[tauri::command]
pub fn get_backup_settings(state: State<AppState>) -> Result<BackupConfigView, String> {
    let data = state.data.lock().map_err(lock_err)?;
    Ok(BackupConfigView::from(&data.backup))
}

/// Réglages de la sauvegarde automatique. `passphrase` : None = garder l'actuelle,
/// "" = l'effacer, sinon la nouvelle (chiffrée par la clé maître).
#[tauri::command]
pub fn save_backup_settings(state: State<AppState>, config: BackupConfig, passphrase: Option<String>) -> Result<BackupConfigView, String> {
    crypto::ensure_unlocked()?;
    let mut config = BackupConfig { folder: config.folder.trim().to_string(), ..config };
    config.validate()?;
    let view = {
        let mut data = state.data.lock().map_err(lock_err)?;
        let key = crypto::data_key(&data)?;
        let previous = data.backup.clone();
        // L'état des exécutions est tenu par le backend, pas par le formulaire
        config.last_run = previous.last_run;
        config.last_error = previous.last_error.clone();
        backup::apply_passphrase(&mut config, &previous, passphrase.map(Zeroizing::new), &key)?;
        data.backup = config;
        BackupConfigView::from(&data.backup)
    };
    state.save()?;
    Ok(view)
}

/// Sauvegarde automatique immédiate (bouton « Sauvegarder maintenant »)
#[tauri::command]
pub async fn backup_run_now(app: AppHandle) -> Result<String, String> {
    run_and_record(&app).await.map(|p| p.to_string_lossy().into_owned())
}

/// Écrit une sauvegarde dans le dossier configuré puis supprime les plus anciennes
async fn run_auto(app: &AppHandle) -> Result<PathBuf, String> {
    let (folder, keep, payload, passphrase) = {
        crypto::ensure_unlocked()?;
        let state = app.state::<AppState>();
        let data = state.data.lock().map_err(lock_err)?;
        if !data.backup.enabled {
            return Err("La sauvegarde automatique n'est pas activée".into());
        }
        data.backup.validate()?;
        let key = crypto::data_key(&data)?;
        let passphrase = Zeroizing::new(crypto::decrypt(&data.backup.passphrase, &key)?);
        let payload = backup::build_payload(&data, &key, known_hosts::snapshot(), chrono::Utc::now().to_rfc3339())?;
        (data.backup.folder.clone(), data.backup.keep, payload, passphrase)
    };
    let bytes = seal_payload(payload, passphrase).await?;
    let path = backup::auto_path(&folder, chrono::Local::now());
    backup::write_atomic(&path, &bytes)?;
    backup::rotate(Path::new(folder.trim()), keep)?;
    Ok(path)
}

/// Exécute la sauvegarde automatique et en garde la trace (réglages + historique).
/// Un échec est journalisé comme événement « Échec », ce qui déclenche les alertes.
async fn run_and_record(app: &AppHandle) -> Result<PathBuf, String> {
    let result = run_auto(app).await;
    let state = app.state::<AppState>();
    if let Ok(mut data) = state.data.lock() {
        match &result {
            Ok(_) => {
                data.backup.last_run = Some(now_ms());
                data.backup.last_error = None;
            }
            Err(e) => data.backup.last_error = Some(e.clone()),
        }
    }
    if let Err(e) = state.save() {
        log::warn!("{}", e);
    }
    match &result {
        Ok(path) => log::info!("Sauvegarde automatique écrite : {:?}", path.file_name().unwrap_or_default()),
        Err(e) => app.state::<EventLog>().record(EventKind::Failure, None, "Sauvegarde automatique", format!("Échec : {}", e)),
    }
    result
}

/// Boucle : toutes les heures, écrit une sauvegarde si elle est due. Rien n'est tenté
/// pendant le verrouillage (aucun secret n'est alors déchiffrable).
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(120)).await;
        loop {
            let due = app.state::<AppState>().data.lock().map(|d| d.backup.is_due(now_ms())).unwrap_or(false);
            if due && !crypto::is_locked() {
                let _ = run_and_record(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}
