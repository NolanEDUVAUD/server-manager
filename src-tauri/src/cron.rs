/// Cron — construction des lignes gérées par l'app et lecture des crontabs d'un serveur
use serde::Serialize;

use crate::scheduler::parse_time;

/// Étiquette ajoutée en fin de ligne pour reconnaître les tâches gérées par l'app
pub const TAG: &str = "# server-manager:";

/// Lit en une connexion : crontab de l'utilisateur SSH, /etc/crontab et /etc/cron.d/*
pub const LIST_COMMAND: &str = "echo '--USER--'; crontab -l 2>/dev/null; \
for f in /etc/crontab /etc/cron.d/*; do [ -f \"$f\" ] && echo \"--FILE-- $f\" && cat \"$f\"; done; true";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CronEntry {
    /// « crontab » (utilisateur SSH) ou chemin du fichier système
    pub source: String,
    /// « 0 23 * * 1-5 » ou « @reboot »
    pub schedule: String,
    /// Utilisateur d'exécution (fichiers système uniquement)
    pub user: Option<String>,
    pub command: String,
    /// Identifiant de la tâche de l'app si la ligne est étiquetée
    pub managed_id: Option<String>,
}

/// Jours de l'app (0 = lundi) → jours cron (0 = dimanche), triés et séparés par des virgules
pub fn cron_days(days: &[u8]) -> String {
    let mut converted: Vec<u8> = days.iter().filter(|d| **d <= 6).map(|d| (d + 1) % 7).collect();
    converted.sort_unstable();
    converted.dedup();
    if converted.len() == 7 {
        return "*".into();
    }
    converted.iter().map(u8::to_string).collect::<Vec<_>>().join(",")
}

/// Ligne crontab complète d'une tâche gérée
pub fn build_line(schedule_id: &str, time: &str, days: &[u8], command: &str) -> Result<String, String> {
    let t = parse_time(time).ok_or_else(|| format!("Heure invalide : {}", time))?;
    use chrono::Timelike;
    if command.contains('\n') || command.trim().is_empty() {
        return Err("Commande invalide pour cron".into());
    }
    Ok(format!("{} {} * * {} {} {}{}", t.minute(), t.hour(), cron_days(days), command.trim(), TAG, schedule_id))
}

/// Entoure une valeur d'apostrophes pour le shell (' → '\'')
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Commande shell qui remplace la ligne de la tâche (ou la retire si `line` est None).
/// Sécurités : on s'arrête si `crontab -l` échoue pour une autre raison que « pas de
/// crontab » (sinon on réinstallerait un crontab vide de tous les crons existants), et
/// le crontab actuel est sauvegardé dans ~/.crontab.server-manager.bak avant modification.
pub fn sync_command(schedule_id: &str, line: Option<&str>) -> String {
    let filter = format!("grep -vF {}", shell_quote(&format!("{}{}", TAG, schedule_id)));
    let add = line.map(|l| format!(r"; printf '%s\n' {}", shell_quote(l))).unwrap_or_default();
    // Chaînes brutes : `\n` doit arriver tel quel à printf, pas comme un saut de ligne Rust
    let read = r#"cur=$(crontab -l 2>&1); rc=$?; if [ $rc -ne 0 ]; then case "$cur" in *'no crontab'*) cur='';; *) echo "lecture du crontab impossible : $cur"; exit 1;; esac; fi"#;
    let backup = r#"printf '%s\n' "$cur" > ~/.crontab.server-manager.bak"#;
    format!(r#"{read}; {backup}; {{ [ -n "$cur" ] && printf '%s\n' "$cur" | {filter}{add}; }} | crontab -"#)
}

fn managed_id(command: &str) -> (String, Option<String>) {
    match command.rsplit_once(TAG) {
        Some((cmd, id)) => (cmd.trim().to_string(), Some(id.trim().to_string())),
        None => (command.trim().to_string(), None),
    }
}

/// Analyse une ligne de crontab ; None pour les commentaires, lignes vides et variables
fn parse_line(line: &str, source: &str, has_user: bool) -> Option<CronEntry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let first = line.split_whitespace().next()?;
    // Affectation de variable (SHELL=/bin/sh, PATH=…)
    if first.contains('=') && !first.starts_with('@') {
        return None;
    }
    let (schedule, rest) = if first.starts_with('@') {
        (first.to_string(), line[first.len()..].trim_start())
    } else {
        let mut idx = 0;
        let mut fields = Vec::new();
        for _ in 0..5 {
            let rest = &line[idx..];
            let start = rest.len() - rest.trim_start().len();
            let token = rest.trim_start().split_whitespace().next()?;
            fields.push(token);
            idx += start + token.len();
        }
        (fields.join(" "), line[idx..].trim_start())
    };
    let (user, command) = if has_user {
        let user = rest.split_whitespace().next()?;
        (Some(user.to_string()), rest[user.len()..].trim_start())
    } else {
        (None, rest)
    };
    if command.is_empty() {
        return None;
    }
    let (command, managed_id) = managed_id(command);
    Some(CronEntry { source: source.to_string(), schedule, user, command, managed_id })
}

pub fn parse_list(output: &str) -> Vec<CronEntry> {
    let mut entries = Vec::new();
    let mut source = String::from("crontab");
    let mut has_user = false;
    for line in output.lines() {
        if line.trim() == "--USER--" {
            source = "crontab".into();
            has_user = false;
        } else if let Some(path) = line.strip_prefix("--FILE-- ") {
            source = path.trim().to_string();
            has_user = true;
        } else if let Some(entry) = parse_line(line, &source, has_user) {
            entries.push(entry);
        }
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn days_are_converted_to_cron_numbering() {
        assert_eq!(cron_days(&[0, 1, 2, 3, 4]), "1,2,3,4,5");
        assert_eq!(cron_days(&[5, 6]), "0,6");
        assert_eq!(cron_days(&[0, 1, 2, 3, 4, 5, 6]), "*");
    }

    #[test]
    fn builds_tagged_line() {
        assert_eq!(
            build_line("abc", "23:05", &[0, 4], "shutdown -h now").unwrap(),
            "5 23 * * 1,5 shutdown -h now # server-manager:abc"
        );
        assert!(build_line("abc", "7h", &[0], "reboot").is_err());
        assert!(build_line("abc", "07:00", &[0], "reboot\nrm -rf /").is_err());
    }

    #[test]
    fn sync_command_quotes_the_line_and_guards_read_errors() {
        let cmd = sync_command("abc", Some("0 7 * * * echo 'hi' # server-manager:abc"));
        assert!(cmd.contains("grep -vF '# server-manager:abc'"));
        assert!(cmd.contains(r"printf '%s\n' '0 7 * * * echo '\''hi'\'' # server-manager:abc'"));
        assert!(cmd.contains("*'no crontab'*) cur=''"));
        assert!(cmd.contains("exit 1"));
        assert!(cmd.contains(".crontab.server-manager.bak"));
        assert!(!cmd.contains('\n'), "la commande doit tenir sur une ligne");
        assert!(!sync_command("abc", None).contains(r"printf '%s\n' '"));
    }

    #[test]
    fn parses_user_crontab_and_system_files() {
        let output = "--USER--
# commentaire
MAILTO=\"\"
0 23 * * 1-5 shutdown -h now # server-manager:abc
@reboot /usr/local/bin/start.sh
--FILE-- /etc/cron.d/zfsutils-linux
PATH=/usr/bin:/bin
24 0 8-14 * 0 root if [ -x /usr/lib/zfs-linux/scrub ]; then /usr/lib/zfs-linux/scrub; fi
";
        let entries = parse_list(output);
        assert_eq!(entries.len(), 3);

        assert_eq!(entries[0].schedule, "0 23 * * 1-5");
        assert_eq!(entries[0].command, "shutdown -h now");
        assert_eq!(entries[0].managed_id.as_deref(), Some("abc"));
        assert_eq!(entries[0].source, "crontab");

        assert_eq!(entries[1].schedule, "@reboot");
        assert_eq!(entries[1].command, "/usr/local/bin/start.sh");
        assert_eq!(entries[1].managed_id, None);

        assert_eq!(entries[2].source, "/etc/cron.d/zfsutils-linux");
        assert_eq!(entries[2].user.as_deref(), Some("root"));
        assert!(entries[2].command.starts_with("if [ -x"));
    }
}
