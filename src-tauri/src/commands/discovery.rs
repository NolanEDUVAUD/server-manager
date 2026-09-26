/// Commandes Tauri — Découverte réseau et détection de MAC (lecture seule)
use serde::Serialize;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Semaphore;

use crate::{
    commands::ping::ping_host,
    discovery::{
        extra_subnets, guess_device_kind, lookup_vendor, parse_ip_route, parse_netsh_wlan, parse_nmcli_wifi,
        parse_route_print, parse_tracert, read_arp, subnet_hosts, virtual_nic, Device, RouteEntry, TracerouteHop,
        WlanInfo,
    },
    storage::AppState,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Debug, Clone, Serialize)]
pub struct MacDetection {
    pub mac: Option<String>,
    /// Carte virtuelle (VM) : WoL inutile, c'est Proxmox qui la démarre
    pub virtual_nic: Option<String>,
}

/// Exécute une commande système sans jamais ouvrir de fenêtre console sur Windows.
async fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(program);
    cmd.args(args);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().await.map_err(|e| format!("{} : {}", program, e))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Table de routage locale — passerelle(s) par défaut, sous-réseaux (VPN, routes
/// statiques…). Lecture seule (`route print` sur Windows, `ip route` en repli Linux).
#[tauri::command]
pub async fn get_routes() -> Result<Vec<RouteEntry>, String> {
    #[cfg(target_os = "windows")]
    let output = run("route", &["print", "-4"]).await?;
    #[cfg(not(target_os = "windows"))]
    let output = run("ip", &["route"]).await.unwrap_or_default();

    #[cfg(target_os = "windows")]
    return Ok(parse_route_print(&output));
    #[cfg(not(target_os = "windows"))]
    Ok(parse_ip_route(&output))
}

/// Sous-réseaux « supplémentaires » (VPN, routes statiques) déduits de la table de
/// routage — pratique pour dessiner des clusters à part dans le graphe réseau.
#[tauri::command]
pub async fn get_extra_subnets() -> Result<Vec<RouteEntry>, String> {
    Ok(extra_subnets(&get_routes().await?))
}

/// Informations du Wi-Fi auquel l'hôte est connecté (SSID, BSSID, canal, signal),
/// pour représenter le point d'accès comme un nœud à part dans le graphe.
/// `None` si l'hôte n'est pas connecté en Wi-Fi (ou n'a pas d'interface Wi-Fi).
#[tauri::command]
pub async fn get_wlan_info() -> Result<Option<WlanInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let output = run("netsh", &["wlan", "show", "interfaces"]).await?;
        Ok(parse_netsh_wlan(&output))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let output = run("nmcli", &["-t", "-f", "active,ssid,bssid,signal,chan", "dev", "wifi"]).await.unwrap_or_default();
        Ok(parse_nmcli_wifi(&output))
    }
}

/// Traceroute « léger » (peu de sauts, timeout court) vers une cible — la
/// passerelle par défaut si `target` est omis, sinon une IP publique (1.1.1.1 par
/// défaut) pour visualiser box → FAI → Internet.
#[tauri::command]
pub async fn traceroute_lite(target: Option<String>) -> Result<Vec<TracerouteHop>, String> {
    let target = target.unwrap_or_else(|| "1.1.1.1".to_string());
    target.parse::<std::net::Ipv4Addr>().map_err(|_| format!("Cible invalide : {}", target))?;

    #[cfg(target_os = "windows")]
    let output = run("tracert", &["-d", "-h", "5", "-w", "300", &target]).await?;
    #[cfg(not(target_os = "windows"))]
    let output = run("traceroute", &["-n", "-m", "5", "-w", "1", &target]).await.unwrap_or_default();

    Ok(parse_tracert(&output))
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
            let known_server = servers.iter().find(|(sip, _)| sip == ip).map(|(_, n)| n.clone());
            let vendor = mac.as_deref().and_then(lookup_vendor).map(str::to_string);
            let device_kind = Some(guess_device_kind(vendor.as_deref(), known_server.as_deref()));
            Device {
                ip: ip.clone(),
                virtual_nic: mac.as_deref().and_then(virtual_nic).map(str::to_string),
                mac,
                known_server,
                vendor,
                device_kind,
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
