/// Commandes Tauri — Monitoring des ressources (CPU / RAM / disques via SSH)
use tauri::State;

use crate::{
    commands::{servers::get_decrypted_password, ssh::execute_ssh},
    metrics::{parse_metrics, ServerMetrics, METRICS_COMMAND},
    models::OsType,
    storage::AppState,
};

/// Plafond du timeout de collecte : la collecte est périodique, un serveur
/// lent ne doit pas bloquer une requête pendant les 30 s du timeout d'arrêt.
const MAX_METRICS_TIMEOUT_SECS: u64 = 10;

#[tauri::command]
pub async fn get_server_metrics(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<ServerMetrics, String> {
    let (ip, port, user, password, timeout) = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        if matches!(server.os_type, OsType::Windows | OsType::ESXi) {
            return Err(format!("Monitoring non supporté pour {:?}", server.os_type));
        }
        let pass = get_decrypted_password(&data, &server_id)?;
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
        Ok(m) => log::debug!(
            "Métriques {} : CPU {:.1} %, {} disque(s), {} sonde(s), CPU {:?} °C",
            ip, m.cpu_percent, m.disks.len(), m.temperatures.len(), m.cpu_temp_celsius
        ),
        Err(e) => log::warn!("Collecte des métriques échouée pour {} : {}", ip, e),
    }
    metrics
}
