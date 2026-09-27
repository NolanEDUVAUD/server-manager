/// Moteur d'alertes : règles sur le ping, les métriques et les échecs d'actions,
/// avec notification Windows + push (ntfy / Discord / Telegram).
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use uuid::Uuid;

use crate::{
    events::{now_ms, EventKind, EventLog},
    integrations::resolve,
    metrics::ServerMetrics,
    notify,
    storage::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum Condition {
    /// Serveur sans réponse au ping depuis au moins `minutes`
    Offline { minutes: u32 },
    CpuAbove { percent: f64, minutes: u32 },
    RamAbove { percent: f64, minutes: u32 },
    /// Un des disques dépasse le seuil
    DiskAbove { percent: f64 },
    TempAbove { celsius: f64, minutes: u32 },
    /// Une action (WoL, arrêt, conteneur, tâche planifiée…) a échoué
    ActionFailed,
    /// Une sonde de service (HTTP / TCP / TLS) échoue depuis au moins `minutes`
    ProbeDown { minutes: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "id")]
pub enum AlertTarget {
    All,
    Server(String),
    Group(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AlertRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub condition: Condition,
    pub target: AlertTarget,
    pub notify_desktop: bool,
    pub notify_push: bool,
    /// Délai minimal entre deux déclenchements pour un même serveur
    pub cooldown_minutes: u32,
}

/// Règles créées au premier lancement (modifiables / supprimables)
pub fn default_rules() -> Vec<AlertRule> {
    let rule = |name: &str, condition: Condition| AlertRule {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        enabled: true,
        condition,
        target: AlertTarget::All,
        notify_desktop: true,
        notify_push: true,
        cooldown_minutes: 30,
    };
    vec![
        rule("Serveur hors ligne", Condition::Offline { minutes: 3 }),
        rule("Disque presque plein", Condition::DiskAbove { percent: 90.0 }),
        rule("Surchauffe CPU", Condition::TempAbove { celsius: 85.0, minutes: 2 }),
        rule("Action échouée", Condition::ActionFailed),
        rule("Service injoignable", Condition::ProbeDown { minutes: 2 }),
    ]
}

#[derive(Debug, PartialEq)]
pub enum Decision {
    None,
    Fire,
    Resolve,
}

/// État d'une règle pour un serveur donné
#[derive(Debug, Default, Clone)]
pub struct RuleState {
    bad_since: Option<i64>,
    firing: bool,
    last_fired: Option<i64>,
}

/// Cœur pur : une observation (condition vraie/fausse à `now`) fait évoluer l'état.
/// On ne déclenche qu'après `sustain_ms` de condition continue, une seule fois par
/// incident, et pas avant la fin du délai `cooldown_ms` depuis le dernier déclenchement.
pub fn step(state: &mut RuleState, bad: bool, now: i64, sustain_ms: i64, cooldown_ms: i64) -> Decision {
    if !bad {
        state.bad_since = None;
        if state.firing {
            state.firing = false;
            return Decision::Resolve;
        }
        return Decision::None;
    }
    let since = *state.bad_since.get_or_insert(now);
    let sustained = now - since >= sustain_ms;
    let cooled = state.last_fired.map_or(true, |t| now - t >= cooldown_ms);
    if !state.firing && sustained && cooled {
        state.firing = true;
        state.last_fired = Some(now);
        return Decision::Fire;
    }
    Decision::None
}

/// Fonction pure de « gating » : la règle doit-elle être dispatchée (notification bureau,
/// push, entrée d'historique) au vu des réglages courants ? Centralise toutes les raisons
/// de ne rien envoyer, pour qu'aucun futur point d'appel ne puisse en oublier une :
/// - module « Alertes » masqué de la barre latérale (Paramètres → Général) ;
/// - interrupteur global « Alertes activées » désactivé (Paramètres → Alertes) ;
/// - la règle elle-même désactivée.
pub fn should_dispatch(settings: &crate::models::AppSettings, rule: &AlertRule) -> bool {
    if settings.general.hidden_modules.iter().any(|m| m == "alerts") {
        return false;
    }
    if !settings.general.alerts_enabled {
        return false;
    }
    rule.enabled
}

/// La règle s'applique-t-elle à ce serveur ?
pub fn targets(rule: &AlertRule, server_id: &str, groups: &[crate::models::Group]) -> bool {
    match &rule.target {
        AlertTarget::All => true,
        AlertTarget::Server(id) => id == server_id,
        AlertTarget::Group(gid) => groups.iter().any(|g| &g.id == gid && g.server_ids.iter().any(|s| s == server_id)),
    }
}

/// Évalue une condition de métrique : (mauvais ?, durée requise, description)
pub fn metric_check(condition: &Condition, m: &ServerMetrics) -> Option<(bool, u32, String)> {
    match condition {
        Condition::CpuAbove { percent, minutes } => {
            Some((m.cpu_percent > *percent, *minutes, format!("CPU à {:.0} % (seuil {:.0} %)", m.cpu_percent, percent)))
        }
        Condition::RamAbove { percent, minutes } => {
            let used = if m.mem_total_bytes > 0 { m.mem_used_bytes as f64 * 100.0 / m.mem_total_bytes as f64 } else { 0.0 };
            Some((used > *percent, *minutes, format!("RAM à {:.0} % (seuil {:.0} %)", used, percent)))
        }
        Condition::DiskAbove { percent } => {
            let worst = m
                .disks
                .iter()
                .filter(|d| d.total_bytes > 0)
                .map(|d| (d.used_bytes as f64 * 100.0 / d.total_bytes as f64, d.mount.clone()))
                .fold(None::<(f64, String)>, |acc, x| match acc {
                    Some(a) if a.0 >= x.0 => Some(a),
                    _ => Some(x),
                });
            let (pct, mount) = worst.unwrap_or((0.0, String::new()));
            Some((pct > *percent, 0, format!("Disque {} à {:.0} % (seuil {:.0} %)", mount, pct, percent)))
        }
        Condition::TempAbove { celsius, minutes } => {
            let t = m.cpu_temp_celsius?;
            Some((t > *celsius, *minutes, format!("CPU à {:.0} °C (seuil {:.0} °C)", t, celsius)))
        }
        _ => None,
    }
}

// ── Moteur (état partagé + envoi) ─────────────────────────────────────────
pub struct AlertEngine {
    app: AppHandle,
    states: Mutex<HashMap<(String, String), RuleState>>,
}

impl AlertEngine {
    pub fn new(app: &AppHandle) -> Self {
        AlertEngine { app: app.clone(), states: Mutex::new(HashMap::new()) }
    }

    /// Règles actives qui visent ce serveur, avec son nom
    fn rules_for(&self, server_id: &str) -> (String, Vec<AlertRule>) {
        let state = self.app.state::<AppState>();
        let Ok(data) = state.data.lock() else { return (String::new(), vec![]) };
        let name = data.servers.iter().find(|s| s.id == server_id).map(|s| s.name.clone()).unwrap_or_default();
        let rules = data
            .alert_rules
            .iter()
            .filter(|r| should_dispatch(&data.settings, r) && targets(r, server_id, &data.groups))
            .cloned()
            .collect();
        (name, rules)
    }

    fn step_rule(&self, rule: &AlertRule, key: &str, bad: bool, sustain_min: u32) -> Decision {
        let Ok(mut states) = self.states.lock() else { return Decision::None };
        let st = states.entry((rule.id.clone(), key.to_string())).or_default();
        step(st, bad, now_ms(), i64::from(sustain_min) * 60_000, i64::from(rule.cooldown_minutes) * 60_000)
    }

    /// Oublie l'état de suivi (bad_since / firing / cooldown) d'une règle.
    /// À appeler quand une règle est désactivée, modifiée ou supprimée, sinon un état
    /// périmé peut déclencher un « Résolu » fantôme (ou un déclenchement immédiat)
    /// dès qu'on la réévalue, sans lien avec la situation réelle du moment.
    pub fn clear_rule(&self, rule_id: &str) {
        if let Ok(mut states) = self.states.lock() {
            states.retain(|(id, _), _| id != rule_id);
        }
    }

    pub fn on_ping(&self, server_id: &str, online: bool) {
        let (name, rules) = self.rules_for(server_id);
        for rule in rules {
            if let Condition::Offline { minutes } = rule.condition {
                match self.step_rule(&rule, server_id, !online, minutes) {
                    Decision::Fire => self.dispatch(&rule, Some(server_id), &name, &format!("Ne répond plus au ping depuis {} min", minutes), true),
                    Decision::Resolve => self.dispatch(&rule, Some(server_id), &name, "De nouveau joignable", false),
                    Decision::None => {}
                }
            }
        }
    }

    pub fn on_metrics(&self, server_id: &str, metrics: &ServerMetrics) {
        let (name, rules) = self.rules_for(server_id);
        for rule in rules {
            let Some((bad, minutes, detail)) = metric_check(&rule.condition, metrics) else { continue };
            match self.step_rule(&rule, server_id, bad, minutes) {
                Decision::Fire => self.dispatch(&rule, Some(server_id), &name, &detail, true),
                Decision::Resolve => self.dispatch(&rule, Some(server_id), &name, &format!("Revenu à la normale — {}", detail), false),
                Decision::None => {}
            }
        }
    }

    /// Échec d'une action (appelé par l'historique pour chaque événement Failure)
    pub fn on_failure(&self, server_id: Option<&str>, target: &str, message: &str) {
        let key = server_id.unwrap_or(target);
        let rules: Vec<AlertRule> = match server_id {
            Some(id) => self.rules_for(id).1,
            None => self
                .app
                .state::<AppState>()
                .data
                .lock()
                .map(|d| d.alert_rules.iter().filter(|r| should_dispatch(&d.settings, r) && r.target == AlertTarget::All).cloned().collect())
                .unwrap_or_default(),
        };
        for rule in rules.iter().filter(|r| r.condition == Condition::ActionFailed) {
            // Événement ponctuel : déclenchement immédiat puis réarmement (cooldown respecté)
            if self.step_rule(rule, key, true, 0) == Decision::Fire {
                self.dispatch(rule, server_id, target, message, true);
            }
            self.step_rule(rule, key, false, 0);
        }
    }

    /// Sonde de service : `key` identifie la sonde
    pub fn on_probe(&self, probe_key: &str, target: &str, server_id: Option<&str>, ok: bool, detail: &str) {
        let rules: Vec<AlertRule> = {
            let state = self.app.state::<AppState>();
            let Ok(data) = state.data.lock() else { return };
            data.alert_rules
                .iter()
                .filter(|r| should_dispatch(&data.settings, r) && matches!(r.condition, Condition::ProbeDown { .. }))
                .filter(|r| server_id.map_or(r.target == AlertTarget::All, |id| targets(r, id, &data.groups)))
                .cloned()
                .collect()
        };
        for rule in rules {
            let Condition::ProbeDown { minutes } = rule.condition else { continue };
            match self.step_rule(&rule, probe_key, !ok, minutes) {
                Decision::Fire => self.dispatch(&rule, server_id, target, detail, true),
                Decision::Resolve => self.dispatch(&rule, server_id, target, "Service rétabli", false),
                Decision::None => {}
            }
        }
    }

    fn dispatch(&self, rule: &AlertRule, server_id: Option<&str>, target: &str, detail: &str, critical: bool) {
        // Filet de sécurité final : même si un appelant amont a mal filtré, `should_dispatch`
        // revérifie ici le module « Alertes » masqué, l'interrupteur global et la règle
        // elle-même — plus aucune alerte, ni historique, ni notification bureau, ni push.
        let dispatchable = self
            .app
            .state::<AppState>()
            .data
            .lock()
            .map(|d| should_dispatch(&d.settings, rule))
            .unwrap_or(false);
        if !dispatchable {
            return;
        }
        let title = if critical {
            format!("{} — {}", rule.name, target)
        } else {
            format!("Rétabli — {} ({})", target, rule.name)
        };
        log::warn!("Alerte : {} : {}", title, detail);
        self.app
            .state::<EventLog>()
            .record(EventKind::Alert, server_id, target, format!("{} : {}", if critical { rule.name.as_str() } else { "Rétabli" }, detail));

        let desktop_on = self
            .app
            .state::<AppState>()
            .data
            .lock()
            .map(|d| d.settings.general.notifications)
            .unwrap_or(true);
        if rule.notify_desktop && desktop_on {
            let _ = self.app.notification().builder().title(&title).body(detail).show();
        }
        if rule.notify_push {
            send_push(&self.app, title, detail.to_string(), critical);
        }
    }
}

/// Envoie sur tous les canaux push configurés et actifs (en tâche de fond)
pub fn send_push(app: &AppHandle, title: String, message: String, critical: bool) {
    let channels: Vec<_> = {
        let state = app.state::<AppState>();
        let Ok(data) = state.data.lock() else { return };
        notify::PUSH_KINDS
            .iter()
            .filter_map(|k| match resolve(&data, *k) {
                Ok(channel) => Some(channel),
                // Verrouillée : le secret du canal (jeton, webhook) n'est pas déchiffrable
                Err(e) if e == crate::crypto::LOCKED_MESSAGE => {
                    log::info!("Notification {:?} non envoyée : application verrouillée", k);
                    None
                }
                Err(_) => None,
            })
            .collect()
    };
    tauri::async_runtime::spawn(async move {
        for channel in channels {
            if let Err(e) = notify::send(&channel, &title, &message, critical).await {
                log::warn!("Notification push échouée : {}", e);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;

    #[test]
    fn fires_once_after_sustain_then_resolves() {
        let mut st = RuleState::default();
        assert_eq!(step(&mut st, true, 0, 3 * MIN, 30 * MIN), Decision::None);
        assert_eq!(step(&mut st, true, 2 * MIN, 3 * MIN, 30 * MIN), Decision::None);
        assert_eq!(step(&mut st, true, 3 * MIN, 3 * MIN, 30 * MIN), Decision::Fire);
        // Toujours en panne : pas de nouvelle alerte
        assert_eq!(step(&mut st, true, 10 * MIN, 3 * MIN, 30 * MIN), Decision::None);
        assert_eq!(step(&mut st, false, 11 * MIN, 3 * MIN, 30 * MIN), Decision::Resolve);
        assert_eq!(step(&mut st, false, 12 * MIN, 3 * MIN, 30 * MIN), Decision::None);
    }

    #[test]
    fn short_glitch_does_not_fire() {
        let mut st = RuleState::default();
        step(&mut st, true, 0, 3 * MIN, 0);
        assert_eq!(step(&mut st, false, MIN, 3 * MIN, 0), Decision::None);
        // Le compteur repart de zéro
        assert_eq!(step(&mut st, true, 2 * MIN, 3 * MIN, 0), Decision::None);
        assert_eq!(step(&mut st, true, 4 * MIN, 3 * MIN, 0), Decision::None);
        assert_eq!(step(&mut st, true, 5 * MIN, 3 * MIN, 0), Decision::Fire);
    }

    #[test]
    fn cooldown_prevents_flapping_spam() {
        let mut st = RuleState::default();
        assert_eq!(step(&mut st, true, 0, 0, 30 * MIN), Decision::Fire);
        assert_eq!(step(&mut st, false, MIN, 0, 30 * MIN), Decision::Resolve);
        assert_eq!(step(&mut st, true, 2 * MIN, 0, 30 * MIN), Decision::None);
        assert_eq!(step(&mut st, true, 31 * MIN, 0, 30 * MIN), Decision::Fire);
    }

    fn metrics(cpu: f64, used: u64, temp: Option<f64>) -> ServerMetrics {
        ServerMetrics {
            cpu_percent: cpu,
            mem_total_bytes: 100,
            mem_used_bytes: 50,
            uptime_secs: 0,
            load_avg: [0.0; 3],
            disks: vec![
                crate::metrics::DiskUsage { name: "a".into(), mount: "/".into(), fs_type: "ext4".into(), total_bytes: 100, used_bytes: 20 },
                crate::metrics::DiskUsage { name: "b".into(), mount: "/data".into(), fs_type: "xfs".into(), total_bytes: 100, used_bytes: used },
            ],
            temperatures: vec![],
            cpu_temp_celsius: temp,
        }
    }

    #[test]
    fn metric_checks() {
        let (bad, _, detail) = metric_check(&Condition::DiskAbove { percent: 90.0 }, &metrics(10.0, 95, None)).unwrap();
        assert!(bad);
        assert!(detail.contains("/data"));
        assert!(!metric_check(&Condition::CpuAbove { percent: 80.0, minutes: 1 }, &metrics(10.0, 0, None)).unwrap().0);
        // Pas de sonde de température : la règle ne s'applique pas
        assert!(metric_check(&Condition::TempAbove { celsius: 80.0, minutes: 1 }, &metrics(0.0, 0, None)).is_none());
        assert!(metric_check(&Condition::ActionFailed, &metrics(0.0, 0, None)).is_none());
    }

    #[test]
    fn clear_rule_forgets_firing_state_to_avoid_ghost_resolve() {
        // Reproduit le bug : une règle en cours de déclenchement est désactivée/modifiée,
        // puis réactivée alors que la condition est redevenue bonne. Sans purge de l'état,
        // `step` renvoie Resolve (car firing==true côté état périmé) alors qu'aucune alerte
        // n'a été relancée entre-temps : c'est une notification fantôme.
        let mut states: HashMap<(String, String), RuleState> = HashMap::new();
        let key = ("rule-1".to_string(), "server-1".to_string());
        let st = states.entry(key.clone()).or_default();
        assert_eq!(step(st, true, 0, 0, 0), Decision::Fire);
        assert!(states.get(&key).unwrap().firing);

        // Désactivation / modification de la règle → on purge son état (équivalent de clear_rule)
        states.retain(|(id, _), _| id != "rule-1");
        assert!(states.get(&key).is_none());

        // Réévaluation après réactivation, condition redevenue bonne : plus d'état périmé,
        // donc pas de Resolve fantôme.
        let st = states.entry(key.clone()).or_default();
        assert_eq!(step(st, false, 10 * MIN, 0, 0), Decision::None);
    }

    fn settings_with(alerts_enabled: bool, hidden_modules: Vec<String>) -> crate::models::AppSettings {
        let mut s = crate::models::AppSettings::default();
        s.general.alerts_enabled = alerts_enabled;
        s.general.hidden_modules = hidden_modules;
        s
    }

    #[test]
    fn should_dispatch_gating() {
        let mut rule = default_rules().remove(0);
        let settings = settings_with(true, vec![]);

        // Cas nominal : alertes globales actives, module visible, règle activée
        assert!(should_dispatch(&settings, &rule));

        // Règle désactivée individuellement : jamais dispatchée, même si tout le reste est actif
        rule.enabled = false;
        assert!(!should_dispatch(&settings, &rule));
        rule.enabled = true;

        // Interrupteur global désactivé (Paramètres → Alertes) : plus aucune règle, même activée
        let settings_off = settings_with(false, vec![]);
        assert!(!should_dispatch(&settings_off, &rule));

        // Module « Alertes » masqué de la barre latérale : plus aucune règle non plus
        let settings_hidden = settings_with(true, vec!["alerts".to_string()]);
        assert!(!should_dispatch(&settings_hidden, &rule));

        // Un autre module masqué ne doit rien changer
        let settings_other_hidden = settings_with(true, vec!["docker".to_string()]);
        assert!(should_dispatch(&settings_other_hidden, &rule));
    }

    #[test]
    fn targeting() {
        let g = crate::models::Group { id: "g".into(), name: "G".into(), server_ids: vec!["s1".into()], icon: None };
        let mut rule = default_rules().remove(0);
        assert!(targets(&rule, "s9", &[]));
        rule.target = AlertTarget::Group("g".into());
        assert!(targets(&rule, "s1", &[g.clone()]));
        assert!(!targets(&rule, "s2", &[g]));
    }
}
