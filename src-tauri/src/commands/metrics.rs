/// Commandes Tauri — Monitoring des ressources (CPU / RAM / disques via SSH)
use tauri::{AppHandle, Manager};

use crate::{
    alerts::AlertEngine,
    commands::{servers::get_decrypted_password, ssh::execute_ssh},
    db::Db,
    events::now_ms,
    metrics::{parse_metrics, ServerMetrics, METRICS_COMMAND},
    models::OsType,
    storage::AppState,
};

/// Plafond du timeout de collecte : la collecte est périodique, un serveur
/// lent ne doit pas bloquer une requête pendant les 30 s du timeout d'arrêt.
const MAX_METRICS_TIMEOUT_SECS: u64 = 10;

/// Collecte les métriques d'un serveur et les transmet au moteur d'alertes.
/// Utilisée par la boucle de surveillance (monitor.rs) et par la commande manuelle.
pub async fn collect_metrics(app: &AppHandle, server_id: &str) -> Result<ServerMetrics, String> {
    let (ip, port, user, password, timeout) = {
        let state = app.state::<AppState>();
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        if matches!(server.os_type, OsType::Windows | OsType::ESXi) {
            return Err(format!("Monitoring non supporté pour {:?}", server.os_type));
        }
        let pass = get_decrypted_password(&data, server_id)?;
        (
            server.ip.clone(),
            server.ssh_port,
            server.ssh_user.clone(),
            pass,
            data.settings.network.ssh_timeout_secs.min(MAX_METRICS_TIMEOUT_SECS),
        )
    };

    let metrics = execute_ssh(&ip, port, &user, &password, METRICS_COMMAND, timeout)
        .await
        .and_then(|result| parse_metrics(&result.output));
    match &metrics {
        Ok(m) => {
            log::debug!(
                "Métriques {} : CPU {:.1} %, {} disque(s), {} sonde(s), CPU {:?} °C",
                ip, m.cpu_percent, m.disks.len(), m.temperatures.len(), m.cpu_temp_celsius
            );
            app.state::<AlertEngine>().on_metrics(server_id, m);
            if let Err(e) = app.state::<Db>().record_metrics(server_id, now_ms(), m) {
                log::warn!("{}", e);
            }
        }
        Err(e) => log::warn!("Collecte des métriques échouée pour {} : {}", ip, e),
    }
    metrics
}

#[tauri::command]
pub async fn get_server_metrics(app: AppHandle, server_id: String) -> Result<ServerMetrics, String> {
    collect_metrics(&app, &server_id).await
}
