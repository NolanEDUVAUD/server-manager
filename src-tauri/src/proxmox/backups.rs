/// Sauvegardes Proxmox : jobs vzdump, couverture des invités, archives, tâches récentes
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, HashSet};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupJob {
    pub id: String,
    pub enabled: bool,
    pub schedule: String,
    /// Planification lisible (« le 1 du mois à 15:00 »)
    pub schedule_text: String,
    pub storage: String,
    pub storage_available: bool,
    pub next_run: Option<i64>,
    /// Invités couverts (« all » = tous)
    pub all_guests: bool,
    pub vmids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GuestBackup {
    pub vmid: u32,
    pub name: String,
    pub node: String,
    pub kind: String,
    pub covered: bool,
    /// Date de la plus récente archive trouvée (secondes)
    pub last_backup: Option<i64>,
    pub last_backup_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupTask {
    pub node: String,
    pub vmid: Option<String>,
    pub start: i64,
    pub end: Option<i64>,
    pub status: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupReport {
    pub jobs: Vec<BackupJob>,
    pub guests: Vec<GuestBackup>,
    pub tasks: Vec<BackupTask>,
    /// Stockages de sauvegarde disponibles, par nœud (pour « Sauvegarder maintenant »)
    pub backup_storages: BTreeMap<String, Vec<String>>,
    /// Stockages de sauvegarde dont les archives n'ont pas pu être lues
    pub unreadable_storages: Vec<String>,
    pub warnings: Vec<String>,
}

/// Planification systemd de Proxmox → texte lisible (cas courants, sinon brut)
pub fn humanize_schedule(schedule: &str) -> String {
    let s = schedule.trim();
    let days = [("mon", "lundi"), ("tue", "mardi"), ("wed", "mercredi"), ("thu", "jeudi"), ("fri", "vendredi"), ("sat", "samedi"), ("sun", "dimanche")];
    let parts: Vec<&str> = s.split_whitespace().collect();
    let time = parts.last().copied().filter(|t| t.contains(':'));
    match (parts.as_slice(), time) {
        ([t], Some(_)) => format!("tous les jours à {}", t),
        ([d, t], Some(_)) if d.starts_with("*-*-") => format!("le {} du mois à {}", d.trim_start_matches("*-*-").trim_start_matches('0'), t),
        ([d, t], Some(_)) if *d == "mon..fri" => format!("en semaine à {}", t),
        ([d, t], Some(_)) if *d == "sat,sun" || *d == "sat..sun" => format!("le week-end à {}", t),
        ([d, t], Some(_)) => {
            let names: Vec<String> = d
                .split(',')
                .map(|x| days.iter().find(|(k, _)| *k == x).map(|(_, v)| v.to_string()).unwrap_or_else(|| x.to_string()))
                .collect();
            format!("{} à {}", names.join(", "), t)
        }
        _ if s == "daily" => "tous les jours à 00:00".into(),
        _ if s == "weekly" => "chaque lundi à 00:00".into(),
        _ if s == "monthly" => "le 1 du mois à 00:00".into(),
        _ => s.to_string(),
    }
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).map(|x| match x { Value::String(s) => s.clone(), other => other.to_string() }).unwrap_or_default()
}

pub struct Inputs<'a> {
    pub jobs: &'a Value,
    pub not_backed_up: &'a Value,
    pub tasks: &'a Value,
    pub resources: &'a Value,
    /// Archives trouvées (réponses brutes de /nodes/{n}/storage/{s}/content?content=backup)
    pub archives: &'a [Value],
    pub unreadable_storages: Vec<String>,
}

pub fn analyze(inp: Inputs) -> BackupReport {
    let res = inp.resources.as_array().cloned().unwrap_or_default();

    // Stockages de sauvegarde disponibles par nœud
    let mut backup_storages: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut available_anywhere: HashSet<String> = HashSet::new();
    for r in res.iter().filter(|r| s(r, "type") == "storage") {
        let name = s(r, "storage");
        if s(r, "status") == "available" {
            available_anywhere.insert(name.clone());
            if s(r, "content").split(',').any(|c| c == "backup") {
                backup_storages.entry(s(r, "node")).or_default().push(name);
            }
        }
    }

    let guests_raw: Vec<&Value> = res.iter().filter(|r| matches!(s(r, "type").as_str(), "qemu" | "lxc")).collect();
    let existing: HashSet<u32> = guests_raw.iter().filter_map(|g| g["vmid"].as_u64().map(|v| v as u32)).collect();
    let not_backed: HashSet<u32> = inp
        .not_backed_up
        .as_array()
        .map(|a| a.iter().filter_map(|g| g["vmid"].as_u64().map(|v| v as u32)).collect())
        .unwrap_or_default();

    let jobs: Vec<BackupJob> = inp
        .jobs
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|j| s(j, "type") == "vzdump" || j.get("type").is_none())
        .map(|j| {
            let vmid_field = s(j, "vmid");
            let all_guests = j.get("all").and_then(Value::as_u64) == Some(1) || vmid_field.is_empty();
            let storage = s(j, "storage");
            BackupJob {
                id: s(j, "id"),
                enabled: j.get("enabled").and_then(Value::as_u64).unwrap_or(1) == 1,
                schedule_text: humanize_schedule(&s(j, "schedule")),
                schedule: s(j, "schedule"),
                storage_available: available_anywhere.contains(&storage),
                storage,
                next_run: j.get("next-run").and_then(Value::as_i64),
                all_guests,
                vmids: vmid_field.split(',').filter_map(|v| v.trim().parse().ok()).collect(),
            }
        })
        .collect();

    // Dernière archive par invité
    let mut last: BTreeMap<u32, (i64, u64)> = BTreeMap::new();
    for list in inp.archives {
        for a in list.as_array().cloned().unwrap_or_default() {
            let (Some(vmid), Some(ctime)) = (a["vmid"].as_u64(), a["ctime"].as_i64()) else { continue };
            let entry = last.entry(vmid as u32).or_insert((0, 0));
            if ctime > entry.0 {
                *entry = (ctime, a["size"].as_u64().unwrap_or(0));
            }
        }
    }

    let mut guests: Vec<GuestBackup> = guests_raw
        .iter()
        .filter_map(|g| {
            let vmid = g["vmid"].as_u64()? as u32;
            Some(GuestBackup {
                vmid,
                name: s(g, "name"),
                node: s(g, "node"),
                kind: s(g, "type"),
                covered: !not_backed.contains(&vmid),
                last_backup: last.get(&vmid).map(|x| x.0),
                last_backup_size: last.get(&vmid).map(|x| x.1),
            })
        })
        .collect();
    guests.sort_by_key(|g| g.vmid);

    let mut tasks: Vec<BackupTask> = inp
        .tasks
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|t| s(t, "type") == "vzdump")
        .map(|t| {
            let status = s(t, "status");
            BackupTask {
                node: s(t, "node"),
                vmid: t.get("id").and_then(Value::as_str).filter(|x| !x.is_empty()).map(str::to_string),
                start: t["starttime"].as_i64().unwrap_or(0),
                end: t["endtime"].as_i64(),
                ok: status == "OK",
                status: if status.is_empty() { "en cours".into() } else { status },
            }
        })
        .collect();
    tasks.sort_by(|a, b| b.start.cmp(&a.start));

    // ── Avertissements ────────────────────────────────────────────────────
    let mut warnings = Vec::new();
    if jobs.iter().all(|j| !j.enabled) {
        warnings.push("Aucun job de sauvegarde actif".into());
    }
    for j in jobs.iter().filter(|j| j.enabled && !j.storage_available) {
        warnings.push(format!("Le job {} ({}) écrit sur {} qui est indisponible : la prochaine sauvegarde échouera", j.id, j.schedule_text, j.storage));
    }
    for j in &jobs {
        let ghosts: Vec<String> = j.vmids.iter().filter(|v| !existing.contains(v)).map(u32::to_string).collect();
        if !ghosts.is_empty() {
            warnings.push(format!("Le job {} référence des invités inexistants : {}", j.id, ghosts.join(", ")));
        }
    }
    let uncovered: Vec<String> = guests.iter().filter(|g| !g.covered).map(|g| format!("{} ({})", g.name, g.vmid)).collect();
    if !uncovered.is_empty() {
        warnings.push(format!("{} invité(s) sans aucune sauvegarde planifiée : {}", uncovered.len(), uncovered.join(", ")));
    }
    for t in tasks.iter().filter(|t| !t.ok && t.status != "en cours").take(3) {
        warnings.push(format!("Sauvegarde en échec sur {} : {}", t.node, t.status));
    }

    BackupReport { jobs, guests, tasks, backup_storages, unreadable_storages: inp.unreadable_storages, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn schedules_are_humanized() {
        assert_eq!(humanize_schedule("*-*-01 15:00"), "le 1 du mois à 15:00");
        assert_eq!(humanize_schedule("21:00"), "tous les jours à 21:00");
        assert_eq!(humanize_schedule("sun 01:00"), "dimanche à 01:00");
        assert_eq!(humanize_schedule("mon,wed,fri 02:30"), "lundi, mercredi, vendredi à 02:30");
        assert_eq!(humanize_schedule("mon..fri 21:00"), "en semaine à 21:00");
        assert_eq!(humanize_schedule("*/2:00"), "tous les jours à */2:00");
        assert_eq!(humanize_schedule("weird thing here"), "weird thing here");
    }

    /// Données réelles du cluster (2026-09-25), réduites
    fn report() -> BackupReport {
        let jobs = json!([{"enabled":1,"id":"backup-e2106ada-f511","mode":"snapshot","next-run":1790859600,"schedule":"*-*-01 15:00","storage":"Proxmox_Backup","type":"vzdump","vmid":"201,107,108,114"}]);
        let not_backed = json!([{"name":"DC2","type":"qemu","vmid":100},{"name":"LAN-VM","type":"qemu","vmid":102}]);
        let resources = json!([
            {"type":"qemu","vmid":100,"name":"DC2","node":"workstation1"},
            {"type":"qemu","vmid":102,"name":"LAN-VM","node":"pve-minipc"},
            {"type":"lxc","vmid":107,"name":"npm-lxc2","node":"FwNode"},
            {"type":"lxc","vmid":108,"name":"zabbix-homelab","node":"workstation2"},
            {"type":"qemu","vmid":201,"name":"docker-host","node":"pve-minipc"},
            {"type":"storage","storage":"Proxmox_Backup","node":"workstation2","status":"unknown","content":"backup"},
            {"type":"storage","storage":"local","node":"workstation2","status":"available","content":"vztmpl,backup,iso"},
            {"type":"storage","storage":"local-lvm","node":"workstation2","status":"available","content":"images,rootdir"}
        ]);
        let archives = vec![json!([{"ctime":1780677424i64,"size":358577878u64,"vmid":108,"volid":"local:backup/vzdump-lxc-108.tar.zst"}])];
        analyze(Inputs {
            jobs: &jobs,
            not_backed_up: &not_backed,
            tasks: &json!([{"type":"vzdump","node":"workstation2","starttime":10,"endtime":20,"status":"job errors","id":""}]),
            resources: &resources,
            archives: &archives,
            unreadable_storages: vec!["Proxmox_Backup".into()],
        })
    }

    #[test]
    fn job_on_unavailable_storage_is_flagged() {
        let r = report();
        assert_eq!(r.jobs.len(), 1);
        assert!(!r.jobs[0].storage_available);
        assert_eq!(r.jobs[0].schedule_text, "le 1 du mois à 15:00");
        assert!(r.warnings.iter().any(|w| w.contains("Proxmox_Backup") && w.contains("échouera")));
    }

    #[test]
    fn ghost_vmids_and_uncovered_guests() {
        let r = report();
        assert!(r.warnings.iter().any(|w| w.contains("inexistants : 114")));
        assert!(r.warnings.iter().any(|w| w.contains("2 invité(s)") && w.contains("DC2 (100)")));
        assert!(!r.guests.iter().find(|g| g.vmid == 100).unwrap().covered);
        assert!(r.guests.iter().find(|g| g.vmid == 201).unwrap().covered);
    }

    #[test]
    fn last_archive_storages_and_failed_tasks() {
        let r = report();
        let zbx = r.guests.iter().find(|g| g.vmid == 108).unwrap();
        assert_eq!(zbx.last_backup, Some(1780677424));
        assert_eq!(r.backup_storages.get("workstation2"), Some(&vec!["local".to_string()]));
        assert!(!r.tasks[0].ok);
        assert!(r.warnings.iter().any(|w| w.contains("job errors")));
    }
}
