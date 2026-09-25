/// Arrêt / démarrage ordonnés du lab complet.
/// Le plan est calculé sans rien exécuter (mode simulation) ; l'exécution réutilise
/// les primitives existantes (SSH, API Proxmox, WoL, ping) étape par étape.
use serde::{Deserialize, Serialize};

use crate::models::OsType;

/// Invité Proxmox tel que vu par le planificateur
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Guest {
    pub vmid: u32,
    pub name: String,
    pub node: String,
    pub kind: String,
    pub running: bool,
}

/// Serveur de l'app, avec le nom de nœud Proxmox s'il en est un
#[derive(Debug, Clone, PartialEq)]
pub struct Machine {
    pub id: String,
    pub name: String,
    pub os_type: OsType,
    pub has_mac: bool,
    pub online: bool,
    pub pve_node: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum Action {
    /// Arrêt SSH d'un serveur (commande d'arrêt configurée)
    ShutdownServer { server_id: String },
    /// Arrêt propre d'invités via l'API (en parallèle), avec attente de leur arrêt
    ShutdownGuests { guests: Vec<Guest> },
    /// Réveil Wake-on-LAN puis attente de la réponse au ping
    WakeServer { server_id: String },
    StartGuests { guests: Vec<Guest> },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Step {
    pub title: String,
    /// Actions exécutées en parallèle au sein de l'étape
    pub actions: Vec<Action>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Plan {
    pub steps: Vec<Step>,
    pub warnings: Vec<String>,
}

/// Invité assurant le routage (pare-feu) : on ne l'arrête qu'en dernier
pub fn is_network_guest(g: &Guest) -> bool {
    let n = g.name.to_lowercase();
    ["opnsense", "pfsense", "firewall", "routeur", "router"].iter().any(|k| n.contains(k))
}

/// Nom normalisé (minuscules, lettres et chiffres) pour rapprocher un serveur de l'app
/// d'un invité Proxmox : « DockerHost » ↔ « docker-host »
fn norm(name: &str) -> String {
    name.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

/// Ce serveur de l'app est-il en fait un invité Proxmox (VM/CT) ?
pub fn is_guest_machine(m: &Machine, guests: &[Guest]) -> bool {
    m.pve_node.is_none() && guests.iter().any(|g| norm(&g.name) == norm(&m.name))
}

struct Roles<'a> {
    network_guests: Vec<Guest>,
    network_node: Option<&'a Machine>,
    nodes: Vec<&'a Machine>,
    storage: Vec<&'a Machine>,
    others: Vec<&'a Machine>,
}

fn roles<'a>(machines: &'a [Machine], guests: &[Guest]) -> Roles<'a> {
    let network_guests: Vec<Guest> = guests.iter().filter(|g| is_network_guest(g)).cloned().collect();
    let network_node_name = network_guests.first().map(|g| g.node.clone());
    let network_node = machines.iter().find(|m| m.pve_node.is_some() && m.pve_node == network_node_name);
    let nodes = machines
        .iter()
        .filter(|m| m.pve_node.is_some() && m.pve_node != network_node_name)
        .collect();
    let storage = machines.iter().filter(|m| m.pve_node.is_none() && m.os_type == OsType::TrueNAS).collect();
    // Les serveurs qui sont des invités sont gérés avec les invités, pas comme des machines à part
    let others = machines
        .iter()
        .filter(|m| m.pve_node.is_none() && m.os_type != OsType::TrueNAS && !is_guest_machine(m, guests))
        .collect();
    Roles { network_guests, network_node, nodes, storage, others }
}

fn shutdown_all(ms: &[&Machine]) -> Vec<Action> {
    ms.iter().filter(|m| m.online).map(|m| Action::ShutdownServer { server_id: m.id.clone() }).collect()
}

fn names(ms: &[&Machine]) -> String {
    ms.iter().map(|m| m.name.as_str()).collect::<Vec<_>>().join(", ")
}

pub fn shutdown_plan(machines: &[Machine], guests: &[Guest]) -> Plan {
    let r = roles(machines, guests);
    let mut steps = Vec::new();
    let mut warnings = Vec::new();

    let others = shutdown_all(&r.others);
    if !others.is_empty() {
        steps.push(Step { title: "Serveurs hors cluster".into(), detail: names(&r.others), actions: others });
    }
    let guests_to_stop: Vec<Guest> = guests.iter().filter(|g| g.running && !is_network_guest(g)).cloned().collect();
    if !guests_to_stop.is_empty() {
        steps.push(Step {
            title: "VM et conteneurs".into(),
            detail: format!("{} invité(s), arrêt propre (ACPI / arrêt du conteneur)", guests_to_stop.len()),
            actions: vec![Action::ShutdownGuests { guests: guests_to_stop }],
        });
    }
    let storage = shutdown_all(&r.storage);
    if !storage.is_empty() {
        steps.push(Step { title: "Stockage".into(), detail: format!("{} (après les invités qui l'utilisent)", names(&r.storage)), actions: storage });
    }
    let nodes = shutdown_all(&r.nodes);
    if !nodes.is_empty() {
        steps.push(Step { title: "Nœuds Proxmox".into(), detail: names(&r.nodes), actions: nodes });
    }
    let fw: Vec<Guest> = r.network_guests.iter().filter(|g| g.running).cloned().collect();
    if !fw.is_empty() {
        steps.push(Step {
            title: "Pare-feu / routeur".into(),
            detail: format!("{} : en dernier, le réseau tombe à ce moment-là", fw.iter().map(|g| g.name.as_str()).collect::<Vec<_>>().join(", ")),
            actions: vec![Action::ShutdownGuests { guests: fw }],
        });
    }
    if let Some(n) = r.network_node.filter(|n| n.online) {
        steps.push(Step { title: "Nœud du pare-feu".into(), detail: n.name.clone(), actions: vec![Action::ShutdownServer { server_id: n.id.clone() }] });
    }

    // Avertissements
    for m in machines.iter().filter(|m| !m.has_mac && !is_guest_machine(m, guests)) {
        let extra = if Some(m) == r.network_node { " — c'est le nœud du pare-feu : le lab entier ne pourra pas redémarrer seul" } else { "" };
        warnings.push(format!("{} n'a pas d'adresse MAC : impossible à rallumer à distance{}", m.name, extra));
    }
    if r.nodes.len() + usize::from(r.network_node.is_some()) > 1 {
        warnings.push("Le quorum est perdu dès que la moitié des nœuds est éteinte : normal pour un arrêt complet".into());
    }
    if r.network_guests.is_empty() {
        warnings.push("Aucun pare-feu détecté parmi les invités : l'ordre réseau n'est pas protégé".into());
    }
    Plan { steps, warnings }
}

/// Démarrage : ordre inverse, chaque réveil attend la réponse au ping.
/// `to_start` : invités à relancer (ceux qui tournaient avant l'arrêt).
pub fn startup_plan(machines: &[Machine], guests: &[Guest], to_start: &[Guest]) -> Plan {
    let r = roles(machines, guests);
    let mut steps = Vec::new();
    let mut warnings = Vec::new();
    let wake = |ms: &[&Machine]| -> Vec<Action> {
        ms.iter().filter(|m| m.has_mac).map(|m| Action::WakeServer { server_id: m.id.clone() }).collect()
    };

    if let Some(n) = r.network_node {
        if n.has_mac {
            steps.push(Step { title: "Nœud du pare-feu".into(), detail: n.name.clone(), actions: vec![Action::WakeServer { server_id: n.id.clone() }] });
        } else {
            warnings.push(format!("{} (nœud du pare-feu) n'a pas d'adresse MAC : à allumer à la main en premier", n.name));
        }
    }
    let fw: Vec<Guest> = r.network_guests.clone();
    if !fw.is_empty() {
        steps.push(Step { title: "Pare-feu / routeur".into(), detail: "démarrage du routeur avant le reste du réseau".into(), actions: vec![Action::StartGuests { guests: fw }] });
    }
    for (title, group) in [("Stockage", &r.storage), ("Nœuds Proxmox", &r.nodes)] {
        let actions = wake(group);
        if !actions.is_empty() {
            steps.push(Step { title: title.into(), detail: names(group), actions });
        }
    }
    let restart: Vec<Guest> = to_start.iter().filter(|g| !is_network_guest(g)).cloned().collect();
    if !restart.is_empty() {
        steps.push(Step {
            title: "VM et conteneurs".into(),
            detail: format!("{} invité(s) qui tournaient avant l'arrêt", restart.len()),
            actions: vec![Action::StartGuests { guests: restart }],
        });
    }
    let others = wake(&r.others);
    if !others.is_empty() {
        steps.push(Step { title: "Serveurs hors cluster".into(), detail: names(&r.others), actions: others });
    }
    for m in machines.iter().filter(|m| !m.has_mac && Some(*m) != r.network_node && !is_guest_machine(m, guests)) {
        warnings.push(format!("{} n'a pas d'adresse MAC : à allumer à la main", m.name));
    }
    Plan { steps, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str, os: OsType, mac: bool, node: Option<&str>) -> Machine {
        Machine { id: id.into(), name: id.into(), os_type: os, has_mac: mac, online: true, pve_node: node.map(str::to_string) }
    }
    fn g(vmid: u32, name: &str, node: &str, running: bool) -> Guest {
        Guest { vmid, name: name.into(), node: node.into(), kind: "qemu".into(), running }
    }

    /// Le homelab réel (2026-09-25)
    fn lab() -> (Vec<Machine>, Vec<Guest>) {
        let machines = vec![
            m("minipc", OsType::Proxmox, false, Some("pve-minipc")),
            m("workstation2", OsType::Proxmox, true, Some("workstation2")),
            m("workstation1", OsType::Proxmox, true, Some("workstation1")),
            m("truenas", OsType::TrueNAS, true, None),
            m("FwNode", OsType::Proxmox, false, Some("FwNode")),
            m("DockerHost", OsType::Linux, true, None),
            // Machine physique hors cluster (hypothétique) pour couvrir cette étape
            m("backup-box", OsType::Linux, true, None),
        ];
        let guests = vec![
            g(106, "OPNSense", "FwNode", true),
            g(201, "docker-host", "pve-minipc", true),
            g(108, "zabbix-homelab", "workstation2", true),
            g(105, "LAB-DC2", "workstation2", false),
        ];
        (machines, guests)
    }

    fn titles(p: &Plan) -> Vec<&str> {
        p.steps.iter().map(|s| s.title.as_str()).collect()
    }

    #[test]
    fn shutdown_keeps_the_firewall_for_last() {
        let (ms, gs) = lab();
        let p = shutdown_plan(&ms, &gs);
        assert_eq!(titles(&p), vec!["Serveurs hors cluster", "VM et conteneurs", "Stockage", "Nœuds Proxmox", "Pare-feu / routeur", "Nœud du pare-feu"]);
        // OPNsense n'est pas dans l'étape des invités ordinaires, ni les invités arrêtés
        let Action::ShutdownGuests { guests } = &p.steps[1].actions[0] else { panic!() };
        assert_eq!(guests.iter().map(|g| g.vmid).collect::<Vec<_>>(), vec![201, 108]);
        let Action::ShutdownServer { server_id } = &p.steps[5].actions[0] else { panic!() };
        assert_eq!(server_id, "FwNode");
    }

    #[test]
    fn missing_macs_are_flagged_especially_the_firewall_node() {
        let (ms, gs) = lab();
        let p = shutdown_plan(&ms, &gs);
        assert!(p.warnings.iter().any(|w| w.contains("FwNode") && w.contains("pare-feu")));
        assert!(p.warnings.iter().any(|w| w.starts_with("minipc n'a pas d'adresse MAC")));
    }

    #[test]
    fn startup_is_reversed_and_skips_machines_without_mac() {
        let (ms, gs) = lab();
        let p = startup_plan(&ms, &gs, &[gs[0].clone(), gs[2].clone()]);
        // FwNode sans MAC : pas d'étape de réveil, mais un avertissement en tête
        assert_eq!(titles(&p), vec!["Pare-feu / routeur", "Stockage", "Nœuds Proxmox", "VM et conteneurs", "Serveurs hors cluster"]);
        assert!(p.warnings[0].contains("à allumer à la main en premier"));
        let nodes = &p.steps[2].actions;
        assert_eq!(nodes.len(), 2, "minipc (sans MAC) n'est pas réveillable");
        let Action::StartGuests { guests } = &p.steps[3].actions[0] else { panic!() };
        assert_eq!(guests.iter().map(|g| g.vmid).collect::<Vec<_>>(), vec![108]);
    }

    #[test]
    fn offline_machines_are_not_shut_down_again() {
        let (mut ms, gs) = lab();
        ms[6].online = false;
        let p = shutdown_plan(&ms, &gs);
        assert_ne!(p.steps[0].title, "Serveurs hors cluster");
    }

    #[test]
    fn server_that_is_a_vm_is_handled_as_a_guest() {
        let (mut ms, gs) = lab();
        ms[5].has_mac = false; // DockerHost (= VM docker-host)
        let p = shutdown_plan(&ms, &gs);
        let mentions_docker = |plan: &Plan| {
            plan.steps.iter().flat_map(|st| &st.actions).any(|a| {
                matches!(a, Action::ShutdownServer { server_id } | Action::WakeServer { server_id } if server_id == "DockerHost")
            })
        };
        assert!(!mentions_docker(&p), "DockerHost est arrêté avec les invités, pas en SSH");
        assert!(!p.warnings.iter().any(|w| w.starts_with("DockerHost")));
        assert!(!mentions_docker(&startup_plan(&ms, &gs, &[])));
    }

    #[test]
    fn network_guest_detection() {
        assert!(is_network_guest(&g(1, "OPNSense", "n", true)));
        assert!(is_network_guest(&g(1, "pfSense-edge", "n", true)));
        assert!(!is_network_guest(&g(1, "zabbix", "n", true)));
    }
}
