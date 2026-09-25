/// Commandes Tauri — Découverte réseau et détection de MAC (lecture seule)
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Semaphore;

use crate::{
    commands::ping::ping_host,
    discovery::{read_arp, subnet_hosts, virtual_nic, Device},
    storage::AppState,
};

#[derive(Debug, Clone, Serialize)]
pub struct MacDetection {
    pub mac: Option<String>,
    /// Carte virtuelle (VM) : WoL inutile, c'est Proxmox qui la démarre
    pub virtual_nic: Option<String>,
}

/// Ping une IP (pour peupler le cache ARP) puis lit sa MAC dans la table ARP.
/// Ne fonctionne que sur le même réseau local (l'ARP ne traverse pas les routeurs).
#[tauri::command]
pub async fn detect_mac(ip: String) -> Result<MacDetection, String> {
    ip.parse::<std::net::Ipv4Addr>().map_err(|_| format!("IP invalide : {}", ip))?;
    ping_host(&ip, 1000).await;
    let mac = read_arp().await?.into_iter().find(|e| e.ip == ip).map(|e| e.mac);
    Ok(MacDetection { virtual_nic: mac.as_deref().and_then(virtual_nic).map(str::to_string), mac })
}

/// Balaye le(s) /24 des serveurs configurés (ou `subnet_of` s'il est fourni),
/// puis croise avec la table ARP. Uniquement des pings : rien n'est modifié.
#[tauri::command]
pub async fn network_scan(state: State<'_, AppState>, subnet_of: Option<String>) -> Result<Vec<Device>, String> {
    let servers: Vec<(String, String)> = {
        let data = state.data.lock().map_err(|e| format!("Erreur mutex: {}", e))?;
        data.servers.iter().map(|s| (s.ip.clone(), s.name.clone())).collect()
    };
    let seeds: Vec<String> = match subnet_of {
        Some(ip) => vec![ip],
        None => servers.iter().map(|(ip, _)| ip.clone()).collect(),
    };
    let mut hosts: Vec<String> = seeds.iter().filter_map(|ip| subnet_hosts(ip)).flatten().collect();
    hosts.sort();
    hosts.dedup();
    if hosts.is_empty() {
        return Err("Aucun réseau privé à balayer (ajoute un serveur ou indique une IP)".into());
    }

    // 64 pings simultanés au maximum, 500 ms chacun
    let limit = Arc::new(Semaphore::new(64));
    let online: Vec<String> = futures::future::join_all(hosts.into_iter().map(|ip| {
        let limit = limit.clone();
        async move {
            let _permit = limit.acquire().await.ok()?;
            ping_host(&ip, 500).await.0.then_some(ip)
        }
    }))
    .await
    .into_iter()
    .flatten()
    .collect();

    let arp = read_arp().await.unwrap_or_default();
    let mut devices: Vec<Device> = online
        .iter()
        .map(|ip| {
            let mac = arp.iter().find(|e| &e.ip == ip).map(|e| e.mac.clone());
            Device {
                ip: ip.clone(),
                virtual_nic: mac.as_deref().and_then(virtual_nic).map(str::to_string),
                mac,
                known_server: servers.iter().find(|(sip, _)| sip == ip).map(|(_, n)| n.clone()),
            }
        })
        .collect();
    // Tri numérique des IP
    devices.sort_by_key(|d| d.ip.parse::<std::net::Ipv4Addr>().map(u32::from).unwrap_or(0));
    Ok(devices)
}

#[cfg(test)]
mod live {
    /// Lecture seule (ping + table ARP locale) :
    /// DEV_IPS=192.168.1.10,192.168.1.11 cargo test live_detect -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_detect() {
        let ips = std::env::var("DEV_IPS").expect("DEV_IPS (adresses séparées par des virgules)");
        for ip in ips.split(',').map(str::trim).filter(|ip| !ip.is_empty()) {
            println!("{} → {:?}", ip, super::detect_mac(ip.into()).await.map(|d| (d.mac, d.virtual_nic)));
        }
    }
}
