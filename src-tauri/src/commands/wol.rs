/// Commande Tauri — Wake-on-LAN (envoi de magic packets UDP)
use std::net::UdpSocket;
use tauri::State;

use crate::{
    events::{EventKind, EventLog},
    storage::AppState,
};

// ── Réveiller un serveur via WoL ──────────────────────────────────────────
#[tauri::command]
pub async fn wake_on_lan(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    server_id: String,
) -> Result<String, String> {
    let (mac, _ip, name) = {
        let data = state
            .data
            .lock()
            .map_err(|e| format!("Erreur mutex: {}", e))?;
        let server = data
            .servers
            .iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| format!("Serveur introuvable: {}", server_id))?;
        (server.mac_address.clone(), server.ip.clone(), server.name.clone())
    };

    if mac.is_empty() {
        return Err(format!(
            "Adresse MAC non configurée pour le serveur '{}'",
            name
        ));
    }

    if let Err(e) = send_magic_packet(&mac) {
        events.record(EventKind::Failure, Some(&server_id), &name, format!("Wake-on-LAN échoué : {}", e));
        return Err(e);
    }
    log::info!("Magic packet WoL envoyé à {} ({})", name, mac);
    events.record(EventKind::Wake, Some(&server_id), &name, "Wake-on-LAN envoyé");
    Ok(format!("Magic packet envoyé à {} ({})", name, mac))
}

// ── Réveiller tous les serveurs d'un groupe ───────────────────────────────
#[tauri::command]
pub async fn wake_group(
    state: State<'_, AppState>,
    events: State<'_, EventLog>,
    group_id: String,
) -> Result<Vec<String>, String> {
    let servers_to_wake = {
        let data = state
            .data
            .lock()
            .map_err(|e| format!("Erreur mutex: {}", e))?;
        let group = data
            .groups
            .iter()
            .find(|g| g.id == group_id)
            .ok_or_else(|| format!("Groupe introuvable: {}", group_id))?;

        // Récupérer les infos de chaque serveur du groupe
        group
            .server_ids
            .iter()
            .filter_map(|sid| data.servers.iter().find(|s| &s.id == sid))
            .map(|s| (s.id.clone(), s.name.clone(), s.mac_address.clone()))
            .collect::<Vec<_>>()
    };

    let mut results = Vec::new();
    for (id, name, mac) in servers_to_wake {
        if mac.is_empty() {
            results.push(format!("{}: adresse MAC manquante", name));
            continue;
        }
        match send_magic_packet(&mac) {
            Ok(_) => {
                log::info!("WoL envoyé à {} ({})", name, mac);
                events.record(EventKind::Wake, Some(&id), &name, "Wake-on-LAN envoyé (groupe)");
                results.push(format!("{}: magic packet envoyé", name));
            }
            Err(e) => {
                log::error!("Erreur WoL pour {} : {}", name, e);
                events.record(EventKind::Failure, Some(&id), &name, format!("Wake-on-LAN échoué : {}", e));
                results.push(format!("{}: erreur — {}", name, e));
            }
        }
    }

    Ok(results)
}

// ── Construire et envoyer le magic packet ─────────────────────────────────
fn send_magic_packet(mac_address: &str) -> Result<(), String> {
    // Parser l'adresse MAC (format XX:XX:XX:XX:XX:XX)
    let mac_bytes: Vec<u8> = mac_address
        .split(':')
        .map(|b| u8::from_str_radix(b.trim(), 16).map_err(|e| format!("MAC invalide '{}': {}", b, e)))
        .collect::<Result<Vec<_>, _>>()?;

    if mac_bytes.len() != 6 {
        return Err(format!(
            "Format MAC invalide: {} (attendu XX:XX:XX:XX:XX:XX)",
            mac_address
        ));
    }

    // Construire le magic packet : 6 × 0xFF suivi de l'adresse MAC répétée 16 fois
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(&mac_bytes);
    }

    // Envoyer via UDP en broadcast sur le port 9 (WoL standard)
    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Impossible de créer le socket UDP: {}", e))?;

    socket
        .set_broadcast(true)
        .map_err(|e| format!("Impossible d'activer le broadcast: {}", e))?;

    // Envoyer sur les deux adresses broadcast courantes
    for addr in &["255.255.255.255:9", "255.255.255.255:7"] {
        socket
            .send_to(&packet, addr)
            .map_err(|e| format!("Erreur d'envoi UDP vers {}: {}", addr, e))?;
    }

    Ok(())
}
