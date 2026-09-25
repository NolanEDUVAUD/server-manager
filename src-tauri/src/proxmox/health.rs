/// Santé du cluster Proxmox : quorum, nœuds, stockages, HA, SMART des disques
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NodeHealth {
    pub name: String,
    pub online: bool,
    pub cpu_percent: f64,
    pub mem_percent: f64,
    pub disk_percent: f64,
    pub uptime_secs: u64,
}

/// Un stockage, regroupé par nom (un stockage partagé apparaît sur chaque nœud)
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StorageHealth {
    pub name: String,
    pub plugin: String,
    pub shared: bool,
    pub content: String,
    /// Nœuds où il est disponible / indisponible
    pub available_on: Vec<String>,
    pub unavailable_on: Vec<String>,
    /// Occupation (pour un stockage partagé : valeur vue par le premier nœud)
    pub used_percent: Option<f64>,
    pub total_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiskHealth {
    pub node: String,
    pub devpath: String,
    pub model: String,
    pub health: String,
    /// Durée de vie restante (%) si le disque la fournit de façon exploitable
    pub life_left_percent: Option<u64>,
    pub size_bytes: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ClusterHealth {
    pub name: String,
    pub quorate: bool,
    pub nodes: Vec<NodeHealth>,
    pub storages: Vec<StorageHealth>,
    pub disks: Vec<DiskHealth>,
    /// Statut HA lisible (quorum, maître…)
    pub ha: Vec<String>,
    /// Problèmes détectés, du plus grave au moins grave
    pub warnings: Vec<String>,
}

fn f(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn s(v: &Value, k: &str) -> String {
    v.get(k).map(|x| match x { Value::String(s) => s.clone(), other => other.to_string() }).unwrap_or_default()
}
fn pct(used: f64, total: f64) -> f64 {
    if total > 0.0 { used * 100.0 / total } else { 0.0 }
}

/// Construit l'état de santé à partir des réponses brutes de l'API
/// (/cluster/status, /cluster/resources, /cluster/ha/status/current, /nodes/{n}/disks/list).
pub fn build(status: &Value, resources: &Value, ha: &Value, disks_by_node: &[(String, Value)]) -> ClusterHealth {
    let status = status.as_array().cloned().unwrap_or_default();
    let cluster = status.iter().find(|x| s(x, "type") == "cluster");
    // Nœud isolé (pas de cluster) : considéré comme ayant son propre quorum
    let name = cluster.map(|c| s(c, "name")).unwrap_or_else(|| "Nœud autonome".into());
    let quorate = cluster.map_or(true, |c| f(c, "quorate") >= 1.0);

    let res = resources.as_array().cloned().unwrap_or_default();
    let mut nodes: Vec<NodeHealth> = res
        .iter()
        .filter(|r| s(r, "type") == "node")
        .map(|r| NodeHealth {
            name: s(r, "node"),
            online: s(r, "status") == "online",
            cpu_percent: f(r, "cpu") * 100.0,
            mem_percent: pct(f(r, "mem"), f(r, "maxmem")),
            disk_percent: pct(f(r, "disk"), f(r, "maxdisk")),
            uptime_secs: f(r, "uptime") as u64,
        })
        .collect();
    nodes.sort_by(|a, b| a.name.cmp(&b.name));

    let mut grouped: BTreeMap<String, StorageHealth> = BTreeMap::new();
    for r in res.iter().filter(|r| s(r, "type") == "storage") {
        let name = s(r, "storage").is_empty().then(|| s(r, "id").rsplit('/').next().unwrap_or("").to_string()).unwrap_or_else(|| s(r, "storage"));
        let entry = grouped.entry(name.clone()).or_insert_with(|| StorageHealth {
            name,
            plugin: s(r, "plugintype"),
            shared: f(r, "shared") >= 1.0,
            content: s(r, "content"),
            available_on: vec![],
            unavailable_on: vec![],
            used_percent: None,
            total_bytes: None,
        });
        if s(r, "status") == "available" {
            entry.available_on.push(s(r, "node"));
            if entry.used_percent.is_none() && f(r, "maxdisk") > 0.0 {
                entry.used_percent = Some(pct(f(r, "disk"), f(r, "maxdisk")));
                entry.total_bytes = Some(f(r, "maxdisk") as u64);
            }
        } else {
            entry.unavailable_on.push(s(r, "node"));
        }
    }
    let storages: Vec<StorageHealth> = grouped.into_values().collect();

    let ha: Vec<String> = ha
        .as_array()
        .map(|items| items.iter().map(|x| format!("{} : {}", s(x, "id"), s(x, "status"))).collect())
        .unwrap_or_default();

    let mut disks = Vec::new();
    for (node, list) in disks_by_node {
        for d in list.as_array().cloned().unwrap_or_default() {
            let wear = d.get("wearout").and_then(Value::as_u64);
            disks.push(DiskHealth {
                node: node.clone(),
                devpath: s(&d, "devpath"),
                model: s(&d, "model"),
                health: s(&d, "health"),
                // Certains SSD renvoient une valeur brute > 100 : inexploitable
                life_left_percent: wear.filter(|w| *w <= 100),
                size_bytes: f(&d, "size") as u64,
                kind: s(&d, "type"),
            });
        }
    }

    // ── Avertissements ────────────────────────────────────────────────────
    let mut warnings = Vec::new();
    if !quorate {
        warnings.push("Quorum PERDU : le cluster ne peut plus démarrer ni modifier de VM".into());
    }
    for n in nodes.iter().filter(|n| !n.online) {
        warnings.push(format!("Nœud {} hors ligne", n.name));
    }
    for d in disks.iter().filter(|d| !d.health.is_empty() && !matches!(d.health.as_str(), "PASSED" | "OK")) {
        warnings.push(format!("Disque {} de {} : SMART {}", d.devpath, d.node, d.health));
    }
    for st in storages.iter().filter(|st| !st.unavailable_on.is_empty()) {
        let what = if st.content.contains("backup") { " (sauvegardes impossibles)" } else { "" };
        warnings.push(format!("Stockage {} indisponible sur {}{}", st.name, st.unavailable_on.join(", "), what));
    }
    for st in storages.iter().filter(|st| st.used_percent.is_some_and(|p| p >= 85.0)) {
        warnings.push(format!("Stockage {} plein à {:.0} %", st.name, st.used_percent.unwrap_or(0.0)));
    }
    for d in disks.iter().filter(|d| d.life_left_percent.is_some_and(|l| l <= 10)) {
        warnings.push(format!("Disque {} de {} : {} % de durée de vie restante", d.devpath, d.node, d.life_left_percent.unwrap_or(0)));
    }

    ClusterHealth { name, quorate, nodes, storages, disks, ha, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Extraits des réponses réelles du cluster « Homelab-Lab » (2026-09-25)
    fn sample() -> ClusterHealth {
        let status = json!([
            {"id":"cluster","name":"Homelab-Lab","nodes":4,"quorate":1,"type":"cluster","version":7},
            {"id":"node/workstation2","ip":"192.168.50.56","name":"workstation2","online":1,"type":"node"}
        ]);
        let resources = json!([
            {"type":"node","id":"node/workstation2","node":"workstation2","status":"online","cpu":0.0103,"maxcpu":12,"mem":4482494464u64,"maxmem":67193556992u64,"disk":20678356992u64,"maxdisk":72594137088u64,"uptime":3054},
            {"type":"node","id":"node/FwNode","node":"FwNode","status":"online","cpu":0.03,"maxcpu":12,"mem":11410767872u64,"maxmem":16466276352u64,"disk":7817502720u64,"maxdisk":100861726720u64,"uptime":150111},
            {"type":"storage","id":"storage/workstation2/Proxmox_Backup","node":"workstation2","status":"unknown","shared":1,"plugintype":"cifs","content":"backup","storage":"Proxmox_Backup"},
            {"type":"storage","id":"storage/FwNode/Proxmox_Backup","node":"FwNode","status":"unknown","shared":1,"plugintype":"cifs","content":"backup","storage":"Proxmox_Backup"},
            {"type":"storage","id":"storage/workstation2/local-lvm","node":"workstation2","status":"available","disk":18620005692u64,"maxdisk":151259185152u64,"shared":0,"plugintype":"lvmthin","content":"rootdir,images","storage":"local-lvm"},
            {"type":"storage","id":"storage/FwNode/local-lvm","node":"FwNode","status":"available","disk":38236794440u64,"maxdisk":362777935872u64,"shared":0,"plugintype":"lvmthin","content":"rootdir,images","storage":"local-lvm"},
            {"type":"qemu","id":"qemu/102","node":"pve-minipc","status":"running"}
        ]);
        let ha = json!([{"id":"quorum","node":"pve-minipc","quorate":1,"status":"OK","type":"quorum"}]);
        let disks = vec![("pve-minipc".to_string(), json!([
            {"devpath":"/dev/nvme0n1","model":"PC SN530 NVMe WDC 256GB","health":"PASSED","wearout":74,"size":256060514304u64,"type":"nvme"},
            {"devpath":"/dev/sda","model":"SK_hynix_SC300","health":"PASSED","wearout":253,"size":256060514304u64,"type":"ssd"}
        ]))];
        build(&status, &resources, &ha, &disks)
    }

    #[test]
    fn cluster_nodes_and_quorum() {
        let h = sample();
        assert_eq!(h.name, "Homelab-Lab");
        assert!(h.quorate);
        assert_eq!(h.nodes.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), vec!["FwNode", "workstation2"]);
        assert!((h.nodes[1].mem_percent - 6.67).abs() < 0.1);
        assert_eq!(h.ha, vec!["quorum : OK"]);
    }

    #[test]
    fn shared_storage_is_grouped_and_outage_reported() {
        let h = sample();
        let backup = h.storages.iter().find(|s| s.name == "Proxmox_Backup").unwrap();
        assert!(backup.shared);
        assert_eq!(backup.unavailable_on, vec!["workstation2", "FwNode"]);
        assert!(h.warnings.iter().any(|w| w.contains("Proxmox_Backup") && w.contains("sauvegardes impossibles")));
        let lvm = h.storages.iter().find(|s| s.name == "local-lvm").unwrap();
        assert_eq!(lvm.available_on.len(), 2);
        assert!(lvm.used_percent.unwrap() > 12.0);
    }

    #[test]
    fn disks_keep_plausible_wearout_only() {
        let h = sample();
        assert_eq!(h.disks[0].life_left_percent, Some(74));
        assert_eq!(h.disks[1].life_left_percent, None);
        assert!(!h.warnings.iter().any(|w| w.contains("SMART")));
    }

    #[test]
    fn lost_quorum_and_failed_disk_are_warnings() {
        let status = json!([{"type":"cluster","name":"C","quorate":0}]);
        let disks = vec![("n1".to_string(), json!([{"devpath":"/dev/sdb","health":"FAILED","wearout":5}]))];
        let h = build(&status, &json!([]), &json!([]), &disks);
        assert!(!h.quorate);
        assert!(h.warnings[0].contains("Quorum"));
        assert!(h.warnings.iter().any(|w| w.contains("SMART FAILED")));
        assert!(h.warnings.iter().any(|w| w.contains("5 % de durée de vie")));
    }
}
