/// Commandes Tauri — Centre de mises à jour (lecture seule)
use serde::Serialize;
use tauri::State;

use crate::{
    commands::ssh::execute_ssh,
    cron::shell_quote,
    models::{AppData, OsType},
    ssh_auth::{resolve_ssh, SshTarget},
    storage::AppState,
    updates::{parse_scan, referenced_images, UpdateReport, SCAN_COMMAND},
};

#[derive(Debug, Clone, Serialize)]
pub struct ServerUpdates {
    pub server_id: String,
    pub name: String,
    pub report: Option<UpdateReport>,
    pub error: Option<String>,
}

/// (identifiant, nom, cible SSH)
type Target = (String, String, SshTarget);

async fn scan_one((id, name, target): Target) -> ServerUpdates {
    let result: Result<UpdateReport, String> = async {
        let out = execute_ssh(&target, SCAN_COMMAND, 15).await?.output;
        let images = referenced_images(&out);
        let mut ids = Vec::new();
        if !images.is_empty() {
            let list = images.iter().map(|i| shell_quote(i)).collect::<Vec<_>>().join(" ");
            let cmd = format!("for i in {}; do echo \"$i|$(docker image inspect -f '{{{{.Id}}}}' \"$i\" 2>/dev/null)\"; done", list);
            let r = execute_ssh(&target, &cmd, 15).await?;
            ids = r
                .output
                .lines()
                .filter_map(|l| l.split_once('|'))
                .filter(|(_, id)| !id.trim().is_empty())
                .map(|(img, id)| (img.to_string(), id.trim().to_string()))
                .collect();
        }
        Ok(parse_scan(&out, &ids))
    }
    .await;
    match result {
        Ok(r) => ServerUpdates { server_id: id, name, report: Some(r), error: None },
        Err(e) => ServerUpdates { server_id: id, name, report: None, error: Some(e) },
    }
}

fn targets(data: &AppData) -> Vec<Target> {
    data.servers
        .iter()
        // Windows / ESXi : pas d'apt ; TrueNAS : mises à jour gérées par son interface
        .filter(|s| !matches!(s.os_type, OsType::Windows | OsType::ESXi | OsType::TrueNAS))
        .filter_map(|s| {
            let target = resolve_ssh(data, &s.id).ok()?;
            Some((s.id.clone(), s.name.clone(), target))
        })
        .collect()
}

#[tauri::command]
pub async fn updates_scan(state: State<'_, AppState>) -> Result<Vec<ServerUpdates>, String> {
    let t = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        targets(&data)
    };
    Ok(futures::future::join_all(t.into_iter().map(scan_one)).await)
}

#[cfg(test)]
mod live {
    /// Lecture seule : cargo test live_updates -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_updates() {
        let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.homelab.server-manager");
        let data = crate::storage::load_app_data(&dir.join("data.json"));
        crate::crypto::set_master_key(crate::keystore::load_or_create_master_key().unwrap());
        crate::known_hosts::init(dir.join("known_hosts.json"));
        for r in futures::future::join_all(super::targets(&data).into_iter().map(super::scan_one)).await {
            match (r.report, r.error) {
                (Some(rep), _) => println!(
                    "{} : {} paquet(s) dont {} sécurité · reboot requis {} · noyau {} · listes {:?} j · conteneurs obsolètes {:?}",
                    r.name, rep.packages.len(), rep.security_count, rep.reboot_required, rep.kernel, rep.lists_age_days,
                    rep.stale_containers.iter().map(|c| c.name.as_str()).collect::<Vec<_>>()
                ),
                (_, Some(e)) => println!("{} : erreur {}", r.name, e),
                _ => {}
            }
        }
    }
}
