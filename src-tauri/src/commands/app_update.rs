/// Commandes Tauri — Mise à jour automatique signée de l'application.
///
/// Aucune permission `updater:*` n'est accordée à la webview : le plugin n'est
/// piloté que par ces commandes, avec la clé publique embarquée à la compilation
/// (voir `app_update.rs`). Rien n'est installé sans une signature valide ni sans
/// que l'interface ait confirmé la version exacte proposée.
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use serde::Serialize;
use tauri::{plugin::TauriPlugin, AppHandle, Emitter, Runtime, State};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::app_update::{
    self, PackageTooLarge, ProgressTracker, PubkeyState, RemoteUpdate, UpdateCheck, UpdatePhase,
    UpdateProgress, MAX_PACKAGE_BYTES, NOT_CONFIGURED_MESSAGE, PROGRESS_EVENT,
};

/// Délai maximal de lecture du manifeste `latest.json`
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Délai maximal du téléchargement complet de l'installateur
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Default)]
pub struct AppUpdateState {
    /// Dernière mise à jour trouvée : la seule que l'utilisateur peut installer
    pending: Mutex<Option<Update>>,
    /// Une seule installation à la fois
    installing: AtomicBool,
}

/// Plugin updater configuré avec la clé publique embarquée. Il est toujours
/// enregistré (clé vide si non configurée) mais n'est jamais appelé dans ce cas.
pub fn plugin<R: Runtime>() -> TauriPlugin<R, tauri_plugin_updater::Config> {
    match app_update::embedded_pubkey_state() {
        PubkeyState::Valid(_) => {}
        PubkeyState::Missing => log::info!("{NOT_CONFIGURED_MESSAGE}"),
        PubkeyState::Invalid => log::error!(
            "updater-pubkey.txt ne contient pas une clé publique de signature valide : \
             mises à jour automatiques désactivées"
        ),
    }
    tauri_plugin_updater::Builder::new()
        .pubkey(app_update::configured_pubkey().unwrap_or_default())
        .build()
}

#[derive(Debug, Serialize)]
pub struct UpdaterInfo {
    pub configured: bool,
    pub current_version: String,
}

// ── Version installée et état de la configuration (sans réseau) ────────────
#[tauri::command]
pub fn app_update_info(app: AppHandle) -> UpdaterInfo {
    UpdaterInfo {
        configured: app_update::configured_pubkey().is_some(),
        current_version: app.package_info().version.to_string(),
    }
}

// ── Rechercher une nouvelle version ────────────────────────────────────────
#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    state: State<'_, AppUpdateState>,
) -> Result<UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    let result = app_update::check_with(app_update::configured_pubkey(), &current, |key| async {
        // Adresse du manifeste retrouvée à l'exécution (voir GITHUB_REPOSITORY_ID)
        let manifest =
            app_update::fetch_manifest_url(&app_update::latest_release_api_url(), CHECK_TIMEOUT).await?;
        let updater = app
            .updater_builder()
            .pubkey(key)
            .endpoints(vec![manifest])
            .map_err(|e| e.to_string())?
            .timeout(CHECK_TIMEOUT)
            .build()
            .map_err(|e| e.to_string())?;
        let update = updater.check().await.map_err(|e| e.to_string())?;
        let remote = update.as_ref().map(|u| RemoteUpdate {
            version: u.version.clone(),
            date_unix: u.date.map(|d| d.unix_timestamp()),
            notes: u.body.clone(),
        });
        *state.pending.lock().map_err(|e| format!("Erreur mutex: {e}"))? = update;
        Ok(remote)
    })
    .await;

    // Échec réseau (hors ligne, GitHub injoignable…) : journalisé, jamais bloquant
    result.map_err(|e| {
        let msg = app_update::error_message("Impossible de vérifier les mises à jour", e);
        log::warn!("{msg}");
        msg
    })
}

// ── Télécharger, vérifier, installer puis redémarrer ───────────────────────
#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    state: State<'_, AppUpdateState>,
    version: String,
) -> Result<(), String> {
    app_update::validate_version(&version)?;
    if app_update::configured_pubkey().is_none() {
        return Err(NOT_CONFIGURED_MESSAGE.to_string());
    }
    let pending = state.pending.lock().map_err(|e| format!("Erreur mutex: {e}"))?.clone();
    app_update::ensure_expected_version(&version, pending.as_ref().map(|u| u.version.as_str()))?;
    let Some(mut update) = pending else {
        return Err("Aucune mise à jour en attente : relance la recherche".to_string());
    };

    if state.installing.swap(true, Ordering::SeqCst) {
        return Err("Une installation est déjà en cours".to_string());
    }
    let result = download_and_install(&app, &mut update).await;
    // Atteint seulement en cas d'échec : sinon l'application a déjà quitté ou redémarré
    state.installing.store(false, Ordering::SeqCst);
    if let Err(e) = &result {
        log::warn!("{e}");
    }
    result
}

async fn download_and_install(app: &AppHandle, update: &mut Update) -> Result<(), String> {
    // Le plugin ne fixe aucun délai au téléchargement : on en impose un
    update.timeout = Some(DOWNLOAD_TIMEOUT);

    let emit = |p: UpdateProgress| {
        let _ = app.emit(PROGRESS_EVENT, p);
    };
    emit(UpdateProgress { phase: UpdatePhase::Downloading, downloaded: 0, total: None });

    // Le plugin garde tout le paquet en mémoire et n'offre pas de plafond : au-delà
    // de MAX_PACKAGE_BYTES (annoncés ou reçus), `too_large` interrompt le
    // téléchargement en abandonnant son futur dans le `select!` ci-dessous.
    let too_large = Arc::new(tokio::sync::Notify::new());
    let received = Arc::new(AtomicU64::new(0));
    let on_chunk = {
        let app = app.clone();
        let too_large = too_large.clone();
        let received = received.clone();
        let mut tracker = ProgressTracker::new(MAX_PACKAGE_BYTES);
        move |chunk: usize, total: Option<u64>| match tracker.add(chunk as u64, total) {
            Ok(progress) => {
                received.store(tracker.downloaded(), Ordering::Relaxed);
                if let Some(p) = progress {
                    let _ = app.emit(PROGRESS_EVENT, p);
                }
            }
            Err(PackageTooLarge) => too_large.notify_one(),
        }
    };
    let on_finish = {
        let app = app.clone();
        let received = received.clone();
        move || {
            let downloaded = received.load(Ordering::Relaxed);
            let _ = app.emit(
                PROGRESS_EVENT,
                UpdateProgress { phase: UpdatePhase::Verifying, downloaded, total: Some(downloaded) },
            );
        }
    };

    // `download` vérifie la signature minisign avec la clé embarquée avant de rendre les octets
    let bytes = tokio::select! {
        r = update.download(on_chunk, on_finish) => r.map_err(|e| {
            app_update::error_message("Téléchargement ou vérification de la signature impossible", e)
        })?,
        _ = too_large.notified() => return Err(PackageTooLarge.to_string()),
    };

    let downloaded = received.load(Ordering::Relaxed);
    emit(UpdateProgress { phase: UpdatePhase::Installing, downloaded, total: Some(downloaded) });
    log::info!("Signature vérifiée : installation de la version {}", update.version);
    update
        .install(bytes)
        .map_err(|e| app_update::error_message("Installation impossible", e))?;

    // Windows : `install` a lancé l'installateur (NSIS /P /R ou msiexec /passive),
    // qui relance l'application, puis a quitté le processus. Ailleurs, on relance
    // nous-mêmes pour charger la nouvelle version.
    app.restart()
}
