/// Migration de VM/CT : faisabilité par nœud cible (avec les raisons d'un refus)
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TargetCheck {
    pub node: String,
    pub allowed: bool,
    /// Raisons lisibles d'un refus
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MigrationPlan {
    pub running: bool,
    pub targets: Vec<TargetCheck>,
    /// Disques locaux qui seraient copiés (migration plus longue)
    pub local_disks: Vec<String>,
    /// Remarques générales (périphériques locaux…)
    pub notes: Vec<String>,
}

/// VM (qemu) : analyse la réponse de GET /nodes/{n}/qemu/{id}/migrate
pub fn qemu_plan(pre: &Value, source: &str, online_nodes: &[String]) -> MigrationPlan {
    let allowed: Vec<String> = pre["allowed_nodes"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let not_allowed = pre["not_allowed_nodes"].as_object().cloned().unwrap_or_default();
    let local_resources: Vec<String> = pre["local_resources"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let mut notes = Vec::new();
    if !local_resources.is_empty() {
        notes.push(format!(
            "Périphérique(s) local(aux) {} : à retirer avant toute migration",
            local_resources.join(", ")
        ));
    }
    let local_disks: Vec<String> = pre["local_disks"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|d| d["cdrom"].as_u64() != Some(1))
                .filter_map(|d| d["volid"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let isos: Vec<String> = pre["local_disks"]
        .as_array()
        .map(|a| a.iter().filter(|d| d["cdrom"].as_u64() == Some(1)).filter_map(|d| d["volid"].as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if !isos.is_empty() {
        notes.push(format!("ISO locale montée ({}) : à éjecter avant de migrer", isos.join(", ")));
    }

    let targets = online_nodes
        .iter()
        .filter(|n| n.as_str() != source)
        .map(|node| {
            let mut reasons = Vec::new();
            if let Some(info) = not_allowed.get(node) {
                if let Some(st) = info["unavailable_storages"].as_array() {
                    let names: Vec<&str> = st.iter().filter_map(Value::as_str).collect();
                    if !names.is_empty() {
                        reasons.push(format!("stockage absent sur ce nœud : {}", names.join(", ")));
                    }
                }
                if info.get("blocking-ha-resources").is_some() {
                    reasons.push("bloqué par une ressource HA".into());
                }
                if reasons.is_empty() {
                    reasons.push("refusé par Proxmox".into());
                }
            }
            if !local_resources.is_empty() {
                reasons.push("périphérique local attaché".into());
            }
            // Seuls les nœuds explicitement listés par Proxmox dans allowed_nodes sont proposés
            TargetCheck { node: node.clone(), allowed: reasons.is_empty() && allowed.contains(node), reasons }
        })
        .collect();

    MigrationPlan { running: pre["running"].as_u64() == Some(1), targets, local_disks, notes }
}

/// Conteneur (lxc) : pas d'endpoint de pré-contrôle ; on vérifie que chaque stockage
/// utilisé par le conteneur est disponible sur le nœud cible.
pub fn lxc_plan(config: &Value, running: bool, source: &str, storages_by_node: &BTreeMap<String, Vec<String>>) -> MigrationPlan {
    let mut used: Vec<String> = config
        .as_object()
        .map(|o| {
            o.iter()
                .filter(|(k, _)| *k == "rootfs" || k.starts_with("mp"))
                .filter_map(|(_, v)| v.as_str())
                .filter_map(|v| v.split(':').next().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    used.sort();
    used.dedup();

    let targets = storages_by_node
        .iter()
        .filter(|(n, _)| n.as_str() != source)
        .map(|(node, available)| {
            let missing: Vec<&String> = used.iter().filter(|s| !available.contains(s)).collect();
            let reasons = if missing.is_empty() {
                vec![]
            } else {
                vec![format!("stockage absent sur ce nœud : {}", missing.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "))]
            };
            TargetCheck { node: node.clone(), allowed: reasons.is_empty(), reasons }
        })
        .collect();

    let mut notes = Vec::new();
    if running {
        notes.push("Un conteneur ne migre pas à chaud : il sera redémarré sur le nœud cible".into());
    }
    MigrationPlan { running, targets, local_disks: used, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn nodes() -> Vec<String> {
        ["FwNode", "workstation1", "workstation2", "pve-minipc"].iter().map(|s| s.to_string()).collect()
    }

    /// Réponse réelle pour docker-host (VM 201) le 2026-09-25
    #[test]
    fn docker_srv_cannot_move_and_says_why() {
        let pre = json!({"allowed_nodes":[],"local_disks":[
            {"cdrom":0,"volid":"docker-data:vm-201-disk-0"},{"cdrom":1,"volid":"local:iso/debian-13.2.0-amd64-netinst.iso"},
            {"cdrom":0,"volid":"local-lvm:vm-201-disk-1"}],
            "local_resources":["usb0"],
            "not_allowed_nodes":{"FwNode":{"unavailable_storages":["docker-data"]},"workstation1":{"unavailable_storages":["docker-data"]},"workstation2":{"unavailable_storages":["docker-data"]}},
            "running":1});
        let plan = qemu_plan(&pre, "pve-minipc", &nodes());
        assert!(plan.running);
        assert_eq!(plan.targets.len(), 3);
        assert!(plan.targets.iter().all(|t| !t.allowed));
        assert!(plan.targets[0].reasons.iter().any(|r| r.contains("docker-data")));
        assert!(plan.notes.iter().any(|n| n.contains("usb0")));
        assert!(plan.notes.iter().any(|n| n.contains("ISO")));
        assert_eq!(plan.local_disks, vec!["docker-data:vm-201-disk-0", "local-lvm:vm-201-disk-1"]);
    }

    #[test]
    fn allowed_node_is_offered() {
        let pre = json!({"allowed_nodes":["workstation1"],"local_disks":[],"local_resources":[],"not_allowed_nodes":{"workstation2":{"unavailable_storages":["x"]}},"running":0});
        let plan = qemu_plan(&pre, "pve-minipc", &nodes());
        let ok: Vec<&str> = plan.targets.iter().filter(|t| t.allowed).map(|t| t.node.as_str()).collect();
        assert_eq!(ok, vec!["workstation1"]);
    }

    #[test]
    fn lxc_needs_its_storages_on_target() {
        let config = json!({"rootfs":"local-lvm:vm-107-disk-0,size=12G","mp0":"docker-data:vm-107-disk-1,mp=/data","hostname":"npm"});
        let mut st = BTreeMap::new();
        st.insert("FwNode".to_string(), vec!["local-lvm".to_string()]);
        st.insert("workstation1".to_string(), vec!["local-lvm".to_string()]);
        st.insert("pve-minipc".to_string(), vec!["local-lvm".to_string(), "docker-data".to_string()]);
        let plan = lxc_plan(&config, true, "FwNode", &st);
        let ok: Vec<&str> = plan.targets.iter().filter(|t| t.allowed).map(|t| t.node.as_str()).collect();
        assert_eq!(ok, vec!["pve-minipc"]);
        assert!(plan.targets.iter().find(|t| t.node == "workstation1").unwrap().reasons[0].contains("docker-data"));
        assert!(plan.notes[0].contains("redémarré"));
    }
}
