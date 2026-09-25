/// Tâches en lot : un script exécuté sur plusieurs serveurs (parallèle ou séquentiel),
/// et playbooks Ansible lancés depuis un hôte Ansible (mode --check par défaut).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use crate::{commands::ssh::execute_ssh_interactive, cron::shell_quote};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
pub enum BatchMode {
    #[default]
    Parallel,
    Sequential,
}

/// Tâche enregistrée (bibliothèque de l'utilisateur)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BatchTask {
    pub id: String,
    pub name: String,
    pub script: String,
    /// Serveurs visés par défaut (modifiables au lancement)
    #[serde(default)]
    pub server_ids: Vec<String>,
    #[serde(default)]
    pub mode: BatchMode,
    #[serde(default)]
    pub stop_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct AnsibleConfig {
    /// Serveur de l'app qui porte Ansible (ex. le CT 112)
    pub server_id: String,
    /// Dossier des playbooks sur cet hôte
    pub dir: String,
}

#[derive(Clone)]
pub struct SshTarget {
    pub server_id: String,
    pub name: String,
    pub ip: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum Update {
    Started { run_id: String, server_id: String },
    Output { run_id: String, server_id: String, chunk: String },
    Finished { run_id: String, server_id: String, ok: bool, detail: String, duration_ms: u64 },
    Skipped { run_id: String, server_id: String, reason: String },
    Done { run_id: String, ok_count: usize, failed_count: usize },
}

/// Script multi-ligne exécuté par bash, protégé contre l'interprétation par le shell distant
pub fn wrap_script(script: &str) -> String {
    format!("bash -c {}", shell_quote(script.trim()))
}

/// Commande ansible-playbook ; `--check --diff` en simulation (par défaut dans l'UI)
pub fn playbook_command(dir: &str, playbook: &str, check: bool, limit: Option<&str>) -> Result<String, String> {
    if playbook.trim().is_empty() || !(playbook.ends_with(".yml") || playbook.ends_with(".yaml")) {
        return Err("Choisis un playbook .yml".into());
    }
    let mut cmd = format!("cd {} && ansible-playbook {}", shell_quote(dir), shell_quote(playbook));
    if check {
        cmd.push_str(" --check --diff");
    }
    if let Some(l) = limit.map(str::trim).filter(|l| !l.is_empty()) {
        cmd.push_str(&format!(" --limit {}", shell_quote(l)));
    }
    // Pas de couleurs ANSI : sortie lisible dans l'app
    Ok(format!("ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 {}", cmd))
}

pub fn list_playbooks_command(dir: &str) -> String {
    format!(
        "find {} -maxdepth 2 -type f \\( -name '*.yml' -o -name '*.yaml' \\) ! -path '*/group_vars/*' ! -path '*/host_vars/*' ! -path '*/roles/*' 2>/dev/null | sort",
        shell_quote(dir)
    )
}

pub type Emit = Arc<dyn Fn(Update) + Send + Sync>;

/// Entrées clavier des exécutions en cours, par (exécution, serveur) : permet de
/// répondre aux questions posées pendant une tâche (ex. fichier de configuration dpkg).
#[derive(Default, Clone)]
pub struct BatchInputs {
    senders: Arc<Mutex<HashMap<String, UnboundedSender<Vec<u8>>>>>,
}

impl BatchInputs {
    fn key(run_id: &str, server_id: &str) -> String {
        format!("{}:{}", run_id, server_id)
    }

    fn insert(&self, run_id: &str, server_id: &str, tx: UnboundedSender<Vec<u8>>) {
        if let Ok(mut m) = self.senders.lock() {
            m.insert(Self::key(run_id, server_id), tx);
        }
    }

    fn remove(&self, run_id: &str, server_id: &str) {
        if let Ok(mut m) = self.senders.lock() {
            m.remove(&Self::key(run_id, server_id));
        }
    }

    /// Transmet du texte au serveur ; erreur si la commande est déjà terminée
    pub fn send(&self, run_id: &str, server_id: &str, data: Vec<u8>) -> Result<(), String> {
        let m = self.senders.lock().map_err(|e| e.to_string())?;
        let tx = m.get(&Self::key(run_id, server_id)).ok_or("Cette exécution est terminée")?;
        tx.send(data).map_err(|_| "Cette exécution est terminée".to_string())
    }
}

async fn run_one(run_id: &str, t: &SshTarget, command: &str, emit: &Emit, inputs: &BatchInputs) -> bool {
    emit(Update::Started { run_id: run_id.into(), server_id: t.server_id.clone() });
    let start = Instant::now();
    let chunk_emit = emit.clone();
    let (rid, sid) = (run_id.to_string(), t.server_id.clone());
    let on_chunk = move |c: &str| chunk_emit(Update::Output { run_id: rid.clone(), server_id: sid.clone(), chunk: c.to_string() });
    let (tx, rx) = unbounded_channel();
    inputs.insert(run_id, &t.server_id, tx);
    let result = execute_ssh_interactive(&t.ip, t.port, &t.user, &t.password, command, 15, &on_chunk, rx).await;
    inputs.remove(run_id, &t.server_id);
    let (ok, detail) = match result {
        Ok(r) if r.success => (true, "OK".to_string()),
        Ok(r) => (false, r.error.unwrap_or_else(|| "échec".into())),
        Err(e) => (false, e),
    };
    emit(Update::Finished { run_id: run_id.into(), server_id: t.server_id.clone(), ok, detail, duration_ms: start.elapsed().as_millis() as u64 });
    ok
}

/// Exécute `command` sur les cibles. En séquentiel avec `stop_on_error`, les serveurs
/// restants après un échec sont marqués « non exécutés ».
pub async fn run(run_id: String, targets: Vec<SshTarget>, command: String, mode: BatchMode, stop_on_error: bool, emit: Emit, inputs: BatchInputs) {
    let mut results = Vec::new();
    match mode {
        BatchMode::Parallel => {
            results = futures::future::join_all(targets.iter().map(|t| run_one(&run_id, t, &command, &emit, &inputs))).await;
        }
        BatchMode::Sequential => {
            let mut stopped = false;
            for t in &targets {
                if stopped {
                    emit(Update::Skipped { run_id: run_id.clone(), server_id: t.server_id.clone(), reason: "arrêt après une erreur".into() });
                    continue;
                }
                let ok = run_one(&run_id, t, &command, &emit, &inputs).await;
                results.push(ok);
                stopped = stop_on_error && !ok;
            }
        }
    }
    let ok_count = results.iter().filter(|x| **x).count();
    emit(Update::Done { run_id, ok_count, failed_count: results.len() - ok_count });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn script_is_quoted_for_bash() {
        assert_eq!(wrap_script("echo 'a'\nuptime\n"), "bash -c 'echo '\\''a'\\''\nuptime'");
    }

    #[test]
    fn playbook_command_defaults_and_quoting() {
        assert_eq!(
            playbook_command("/root/playbooks", "update.yml", true, None).unwrap(),
            "ANSIBLE_FORCE_COLOR=0 ANSIBLE_NOCOLOR=1 cd '/root/playbooks' && ansible-playbook 'update.yml' --check --diff"
        );
        let real = playbook_command("/srv/ans", "site.yaml", false, Some("proxmox; rm -rf /")).unwrap();
        assert!(!real.contains("--check"));
        assert!(real.ends_with("--limit 'proxmox; rm -rf /'"), "{}", real);
        assert!(playbook_command("/x", "script.sh", true, None).is_err());
    }

    #[test]
    fn playbook_listing_excludes_vars_and_roles() {
        let c = list_playbooks_command("/etc/ansible");
        assert!(c.starts_with("find '/etc/ansible' -maxdepth 2"));
        assert!(c.contains("! -path '*/roles/*'"));
    }

    #[tokio::test]
    async fn sequential_stop_on_error_skips_remaining() {
        // Cibles injoignables (port fermé sur localhost) : échec immédiat, sans réseau réel
        let t = |id: &str| SshTarget { server_id: id.into(), name: id.into(), ip: "127.0.0.1".into(), port: 1, user: "x".into(), password: "x".into() };
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let l = log.clone();
        let emit: Emit = Arc::new(move |u| l.lock().unwrap().push(u));
        run("r".into(), vec![t("a"), t("b"), t("c")], "uptime".into(), BatchMode::Sequential, true, emit, BatchInputs::default()).await;
        let log = log.lock().unwrap();
        let skipped: Vec<&str> = log.iter().filter_map(|u| match u { Update::Skipped { server_id, .. } => Some(server_id.as_str()), _ => None }).collect();
        assert_eq!(skipped, vec!["b", "c"]);
        assert!(matches!(log.last(), Some(Update::Done { ok_count: 0, failed_count: 1, .. })));
    }

    #[test]
    fn input_reaches_only_running_target() {
        let inputs = BatchInputs::default();
        let (tx, mut rx) = unbounded_channel();
        inputs.insert("r", "a", tx);
        inputs.send("r", "a", b"N\n".to_vec()).unwrap();
        assert_eq!(rx.try_recv().unwrap(), b"N\n");
        assert!(inputs.send("r", "b", b"y".to_vec()).is_err());
        inputs.remove("r", "a");
        assert!(inputs.send("r", "a", b"y".to_vec()).is_err());
    }
}
