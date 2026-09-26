/// Lot intelligent (F2) : détection de l'OS d'une cible par SSH, résolution d'actions portables
/// (« mettre à jour les paquets », « installer X »…) et de variables de gabarit (`{{pkg_update}}`)
/// vers la commande propre à chaque famille d'OS.
///
/// Module volontairement pur (aucun I/O, aucun `russh`) : la détection se limite à construire la
/// commande à exécuter et à interpréter sa sortie ; l'exécution SSH proprement dite vit dans
/// `commands::batch` (`execute_ssh`), qui alimente le cache et les gabarits d'ici.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

// ── Détection ────────────────────────────────────────────────────────────

/// Famille de gestionnaire de paquets (et donc des commandes à utiliser)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum PkgFamily {
    Apt,
    Dnf,
    Yum,
    Zypper,
    Pacman,
    Apk,
    Brew,
    Winget,
    Choco,
    /// Détecté mais aucun gestionnaire connu (ex. BSD, distribution obscure)
    Unknown,
}

impl PkgFamily {
    /// Nom court utilisé dans les blocs conditionnels des gabarits (`{{#if debian}}…{{/if}}`)
    pub fn template_name(self) -> &'static str {
        match self {
            PkgFamily::Apt => "debian",
            PkgFamily::Dnf | PkgFamily::Yum => "redhat",
            PkgFamily::Zypper => "suse",
            PkgFamily::Pacman => "arch",
            PkgFamily::Apk => "alpine",
            PkgFamily::Brew => "mac",
            PkgFamily::Winget | PkgFamily::Choco => "windows",
            PkgFamily::Unknown => "unknown",
        }
    }
}

/// Système d'initialisation, pour choisir entre `systemctl` et `rc-service`/`service`
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum InitSystem {
    Systemd,
    OpenRc,
    /// `service` générique (SysV init, ou inconnu mais POSIX)
    Service,
    /// `brew services` (macOS/Homebrew)
    BrewServices,
    Windows,
}

/// OS détecté sur une cible, à partir de `/etc/os-release`, `uname -s` ou de l'équivalent Windows
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DetectedOs {
    /// `ID` d'/etc/os-release (« debian », « ubuntu », « alpine »…), ou « windows » / une valeur
    /// dérivée d'`uname -s` (« darwin », « freebsd »…) sur les autres OS
    pub id: String,
    /// `ID_LIKE`, si présent (ex. « ubuntu » a `ID_LIKE=debian`)
    pub id_like: Vec<String>,
    pub version_id: Option<String>,
    /// Nom lisible affiché dans l'interface (« Debian 12 », « Windows Server 2022»…)
    pub pretty_name: String,
    pub family: PkgFamily,
    pub init: InitSystem,
}

/// Ligne `clé=valeur` d'/etc/os-release, guillemets éventuels retirés
fn os_release_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|l| {
        let l = l.trim();
        let rest = l.strip_prefix(key)?.strip_prefix('=')?;
        Some(rest.trim_matches('"'))
    })
}

/// Ligne `Clé:\tvaleur` de `sw_vers` (macOS), format différent de celui d'/etc/os-release
fn sw_vers_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|l| l.trim().strip_prefix(key)?.strip_prefix(':').map(str::trim))
}

/// Famille de paquets à partir d'`ID`/`ID_LIKE` (ordre : ID d'abord, puis chaque terme d'ID_LIKE)
fn family_from_ids(id: &str, id_like: &[String]) -> PkgFamily {
    let candidates = std::iter::once(id).chain(id_like.iter().map(String::as_str));
    for c in candidates {
        let family = match c {
            "debian" | "ubuntu" | "raspbian" | "linuxmint" | "pop" => Some(PkgFamily::Apt),
            "fedora" | "rhel" | "centos" | "rocky" | "almalinux" | "amzn" => Some(PkgFamily::Dnf),
            "opensuse" | "opensuse-leap" | "opensuse-tumbleweed" | "sles" | "suse" => Some(PkgFamily::Zypper),
            "arch" | "manjaro" | "endeavouros" => Some(PkgFamily::Pacman),
            "alpine" => Some(PkgFamily::Apk),
            _ => None,
        };
        if let Some(f) = family {
            return f;
        }
    }
    PkgFamily::Unknown
}

fn init_for(family: PkgFamily) -> InitSystem {
    match family {
        PkgFamily::Apk => InitSystem::OpenRc,
        PkgFamily::Brew => InitSystem::BrewServices,
        PkgFamily::Winget | PkgFamily::Choco => InitSystem::Windows,
        PkgFamily::Apt | PkgFamily::Dnf | PkgFamily::Yum | PkgFamily::Zypper | PkgFamily::Pacman => InitSystem::Systemd,
        PkgFamily::Unknown => InitSystem::Service,
    }
}

/// Commande à exécuter par SSH pour détecter un OS de type Unix (Linux ou macOS) : le contenu
/// d'/etc/os-release s'il existe, sinon `uname -s` (et `sw_vers` en plus, sur macOS)
pub fn posix_probe_command() -> &'static str {
    "cat /etc/os-release 2>/dev/null || { uname -s; command -v sw_vers >/dev/null 2>&1 && sw_vers; }"
}

/// Commande à exécuter par SSH pour détecter la version de Windows (PowerShell, plus lisible ;
/// `cmd /c ver` sert de repli quand PowerShell n'est pas la commande par défaut du serveur SSH)
pub fn windows_probe_command() -> &'static str {
    "powershell -NoProfile -Command \"(Get-CimInstance Win32_OperatingSystem).Caption\" 2>nul || cmd /c ver"
}

/// Interprète la sortie d'`os_release_probe_command()` (Linux : os-release ; macOS/BSD : uname (+
/// sw_vers)). Ne renvoie `None` que sur une sortie vide (cible injoignable ou commande muette).
pub fn parse_posix_probe(output: &str) -> Option<DetectedOs> {
    let output = output.trim();
    if output.is_empty() {
        return None;
    }
    // /etc/os-release : présent sur toute distribution Linux moderne
    if output.contains("ID=") || output.contains("PRETTY_NAME=") {
        let id = os_release_value(output, "ID").unwrap_or("linux").to_lowercase();
        let id_like: Vec<String> = os_release_value(output, "ID_LIKE")
            .map(|v| v.split_whitespace().map(|s| s.to_lowercase()).collect())
            .unwrap_or_default();
        let version_id = os_release_value(output, "VERSION_ID").map(str::to_string);
        let pretty_name = os_release_value(output, "PRETTY_NAME")
            .map(str::to_string)
            .unwrap_or_else(|| id.clone());
        let family = family_from_ids(&id, &id_like);
        return Some(DetectedOs { id, id_like, version_id, pretty_name, family, init: init_for(family) });
    }
    // Pas d'os-release : `uname -s`, éventuellement suivi de la sortie de `sw_vers`
    let mut lines = output.lines();
    let kernel = lines.next().unwrap_or("").trim();
    let id = kernel.to_lowercase();
    if id == "darwin" {
        let rest = lines.collect::<Vec<_>>().join("\n");
        let version_id = sw_vers_value(&rest, "ProductVersion").map(str::to_string);
        let product = sw_vers_value(&rest, "ProductName").unwrap_or("macOS");
        let pretty_name = match &version_id {
            Some(v) => format!("{} {}", product, v),
            None => product.to_string(),
        };
        return Some(DetectedOs {
            id,
            id_like: Vec::new(),
            version_id,
            pretty_name,
            family: PkgFamily::Brew,
            init: InitSystem::BrewServices,
        });
    }
    if id.is_empty() {
        return None;
    }
    Some(DetectedOs {
        pretty_name: kernel.to_string(),
        id,
        id_like: Vec::new(),
        version_id: None,
        family: PkgFamily::Unknown,
        init: InitSystem::Service,
    })
}

/// Interprète la sortie d'`windows_probe_command()` : la légende WMI (« Microsoft Windows Server
/// 2022 Standard ») si PowerShell a répondu, sinon la ligne de `cmd /c ver`
/// (« Microsoft Windows [Version 10.0.20348.887] »)
pub fn parse_windows_probe(output: &str) -> Option<DetectedOs> {
    let line = output.lines().map(str::trim).find(|l| !l.is_empty())?;
    // `cmd /c ver` encadre le numéro de version entre crochets ; PowerShell renvoie du texte simple
    let version_id = line
        .rfind('[')
        .and_then(|start| line[start..].strip_prefix("[Version ").map(|s| s.trim_end_matches(']').to_string()));
    let pretty_name = if version_id.is_some() {
        // « Microsoft Windows [Version 10.0.20348.887] » → garder juste le nom, sans le numéro
        line.split('[').next().unwrap_or(line).trim().to_string()
    } else {
        line.to_string()
    };
    Some(DetectedOs {
        id: "windows".into(),
        id_like: Vec::new(),
        version_id,
        pretty_name,
        family: PkgFamily::Winget,
        init: InitSystem::Windows,
    })
}

// ── Cache en mémoire (TTL) ───────────────────────────────────────────────

/// OS détectés récemment, par serveur ; évite de sonder à nouveau chaque cible à chaque lot.
/// `Clone` bon marché (état partagé par `Arc`) : la même instance managée par Tauri peut être
/// déplacée dans une tâche `async` (ex. `smart_batch_run`) sans perdre les entrées déjà en cache.
#[derive(Clone)]
pub struct OsCache {
    ttl: Duration,
    entries: Arc<Mutex<HashMap<String, (Instant, DetectedOs)>>>,
}

impl OsCache {
    pub fn new(ttl: Duration) -> Self {
        OsCache { ttl, entries: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// OS en cache pour ce serveur, si détecté il y a moins de `ttl`
    pub fn get(&self, server_id: &str) -> Option<DetectedOs> {
        let entries = self.entries.lock().ok()?;
        let (at, os) = entries.get(server_id)?;
        if at.elapsed() < self.ttl {
            Some(os.clone())
        } else {
            None
        }
    }

    pub fn set(&self, server_id: &str, os: DetectedOs) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(server_id.to_string(), (Instant::now(), os));
        }
    }

    pub fn invalidate(&self, server_id: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(server_id);
        }
    }
}

impl Default for OsCache {
    /// 10 minutes : assez pour enchaîner plusieurs tâches sans re-sonder, assez court pour
    /// remarquer une mise à niveau d'OS entre deux lots
    fn default() -> Self {
        OsCache::new(Duration::from_secs(10 * 60))
    }
}

// ── Actions portables ────────────────────────────────────────────────────

/// Action de haut niveau, indépendante de l'OS ; `resolve_action` la traduit en commande concrète
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "name")]
pub enum SmartAction {
    UpdatePackages,
    UpgradeSystem,
    InstallPackage(String),
    RestartService(String),
    CleanPackageCache,
    RebootIfRequired,
}

/// Un nom de paquet/service ne doit jamais permettre d'injecter une autre commande : accepté tel
/// quel dans le shell distant (POSIX et PowerShell), sans guillemets à gérer.
fn validate_identifier<'a>(kind: &str, name: &'a str) -> Result<&'a str, String> {
    let name = name.trim();
    let valid = !name.is_empty()
        && name.len() <= 128
        && name.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | ':' | '@' | '/'));
    if valid {
        Ok(name)
    } else {
        Err(format!(
            "Nom de {} invalide : « {} » (lettres, chiffres, « . - _ + : @ / » uniquement)",
            kind, name
        ))
    }
}

/// Résout une action portable en commande shell (POSIX) ou PowerShell/cmd (Windows) pour l'OS
/// détecté. Erreur claire si la famille est inconnue : l'appelant doit alors ignorer la cible.
pub fn resolve_action(action: &SmartAction, os: &DetectedOs) -> Result<String, String> {
    if let SmartAction::InstallPackage(name) = action {
        validate_identifier("paquet", name)?;
    }
    if let SmartAction::RestartService(name) = action {
        validate_identifier("service", name)?;
    }
    match action {
        SmartAction::UpdatePackages => pkg_update(os.family),
        SmartAction::UpgradeSystem => pkg_upgrade(os.family),
        SmartAction::InstallPackage(name) => pkg_install(os.family, name),
        SmartAction::CleanPackageCache => pkg_clean(os.family),
        SmartAction::RebootIfRequired => reboot_if_required(os.family),
        SmartAction::RestartService(name) => service_restart(os.init, name),
    }
}

fn unknown_family(os_id: &str) -> String {
    format!(
        "OS non reconnu ({}) : aucun gestionnaire de paquets pris en charge n'a pu être déterminé — cible ignorée",
        os_id
    )
}

fn pkg_update(family: PkgFamily) -> Result<String, String> {
    Ok(match family {
        PkgFamily::Apt => "sudo apt-get update -y".into(),
        PkgFamily::Dnf => "sudo dnf makecache -y".into(),
        PkgFamily::Yum => "sudo yum makecache -y".into(),
        PkgFamily::Zypper => "sudo zypper --non-interactive refresh".into(),
        PkgFamily::Pacman => "sudo pacman -Sy --noconfirm".into(),
        PkgFamily::Apk => "sudo apk update".into(),
        PkgFamily::Brew => "brew update".into(),
        PkgFamily::Winget => "winget source update".into(),
        PkgFamily::Choco => "choco source list -r".into(),
        PkgFamily::Unknown => return Err(unknown_family(family.template_name())),
    })
}

fn pkg_upgrade(family: PkgFamily) -> Result<String, String> {
    Ok(match family {
        PkgFamily::Apt => "sudo apt-get update -y && sudo apt-get upgrade -y".into(),
        PkgFamily::Dnf => "sudo dnf upgrade -y".into(),
        PkgFamily::Yum => "sudo yum update -y".into(),
        PkgFamily::Zypper => "sudo zypper --non-interactive update".into(),
        PkgFamily::Pacman => "sudo pacman -Syu --noconfirm".into(),
        PkgFamily::Apk => "sudo apk upgrade".into(),
        PkgFamily::Brew => "brew upgrade".into(),
        PkgFamily::Winget => "winget upgrade --all --silent --accept-source-agreements --accept-package-agreements".into(),
        PkgFamily::Choco => "choco upgrade all -y".into(),
        PkgFamily::Unknown => return Err(unknown_family(family.template_name())),
    })
}

fn pkg_install(family: PkgFamily, name: &str) -> Result<String, String> {
    Ok(match family {
        PkgFamily::Apt => format!("sudo apt-get install -y {}", name),
        PkgFamily::Dnf => format!("sudo dnf install -y {}", name),
        PkgFamily::Yum => format!("sudo yum install -y {}", name),
        PkgFamily::Zypper => format!("sudo zypper --non-interactive install {}", name),
        PkgFamily::Pacman => format!("sudo pacman -S --noconfirm {}", name),
        PkgFamily::Apk => format!("sudo apk add {}", name),
        PkgFamily::Brew => format!("brew install {}", name),
        PkgFamily::Winget => format!("winget install --id {} --silent --accept-source-agreements --accept-package-agreements", name),
        PkgFamily::Choco => format!("choco install {} -y", name),
        PkgFamily::Unknown => return Err(unknown_family(family.template_name())),
    })
}

fn pkg_clean(family: PkgFamily) -> Result<String, String> {
    Ok(match family {
        PkgFamily::Apt => "sudo apt-get clean && sudo apt-get autoremove -y".into(),
        PkgFamily::Dnf => "sudo dnf clean all".into(),
        PkgFamily::Yum => "sudo yum clean all".into(),
        PkgFamily::Zypper => "sudo zypper clean --all".into(),
        PkgFamily::Pacman => "sudo pacman -Sc --noconfirm".into(),
        PkgFamily::Apk => "sudo apk cache clean".into(),
        PkgFamily::Brew => "brew cleanup".into(),
        PkgFamily::Winget => "winget source reset --force".into(),
        PkgFamily::Choco => "choco cache remove --all".into(),
        PkgFamily::Unknown => return Err(unknown_family(family.template_name())),
    })
}

fn reboot_if_required(family: PkgFamily) -> Result<String, String> {
    Ok(match family {
        PkgFamily::Apt => "[ -f /var/run/reboot-required ] && sudo reboot || echo 'Redémarrage non nécessaire'".into(),
        PkgFamily::Dnf | PkgFamily::Yum => {
            "if command -v needs-restarting >/dev/null 2>&1; then needs-restarting -r >/dev/null 2>&1 || sudo reboot; \
             else echo 'Vérification indisponible (needs-restarting absent) : redémarrage non lancé'; fi"
                .into()
        }
        PkgFamily::Winget | PkgFamily::Choco => {
            "powershell -NoProfile -Command \"if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired') { Restart-Computer -Force } else { Write-Output 'Redémarrage non nécessaire' }\"".into()
        }
        // Zypper/pacman/apk/mac n'ont pas d'équivalent fiable et sans risque à « reboot-required » :
        // mieux vaut prévenir que redémarrer une cible à tort.
        PkgFamily::Zypper | PkgFamily::Pacman | PkgFamily::Apk | PkgFamily::Brew => {
            "echo 'Vérification du redémarrage non prise en charge pour cette distribution : rien à faire'".into()
        }
        PkgFamily::Unknown => return Err(unknown_family(family.template_name())),
    })
}

fn service_restart(init: InitSystem, name: &str) -> Result<String, String> {
    Ok(match init {
        InitSystem::Systemd => format!("sudo systemctl restart {}", name),
        InitSystem::OpenRc => format!("sudo rc-service {} restart", name),
        InitSystem::Service => format!("sudo service {} restart", name),
        InitSystem::BrewServices => format!("brew services restart {}", name),
        InitSystem::Windows => format!("powershell -NoProfile -Command \"Restart-Service -Name '{}' -Force\"", name),
    })
}

// ── Gabarits (variables + blocs conditionnels par famille d'OS) ──────────

/// Développe les variables `{{pkg_update}}`, `{{pkg_upgrade}}`, `{{pkg_install nom}}`,
/// `{{pkg_clean}}`, `{{service_restart nom}}`, `{{reboot_if_required}}`, `{{os_id}}` et
/// `{{os_version}}`, puis les blocs conditionnels `{{#if famille}}…{{/if}}` (ou
/// `{{#if !famille}}…{{/if}}` pour la négation), un seul niveau, sans imbrication.
/// Familles reconnues : `debian`, `redhat`, `suse`, `arch`, `alpine`, `mac`, `windows`.
pub fn expand_template(script: &str, os: &DetectedOs) -> Result<String, String> {
    let after_ifs = expand_conditionals(script, os)?;
    expand_variables(&after_ifs, os)
}

fn expand_conditionals(script: &str, os: &DetectedOs) -> Result<String, String> {
    let family = os.family.template_name();
    let mut out = String::with_capacity(script.len());
    let mut rest = script;
    loop {
        let Some(start) = rest.find("{{#if") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after_tag = &rest[start + "{{#if".len()..];
        let Some(cond_end) = after_tag.find("}}") else {
            return Err("Bloc « {{#if … » sans « }} » de fermeture".into());
        };
        let condition = after_tag[..cond_end].trim();
        let (negate, wanted) = condition.strip_prefix('!').map(|w| (true, w.trim())).unwrap_or((false, condition));
        if wanted.is_empty() {
            return Err("Bloc « {{#if}} » sans famille d'OS".into());
        }
        let body_start = &after_tag[cond_end + "}}".len()..];
        let Some(end) = body_start.find("{{/if}}") else {
            return Err(format!("Bloc « {{{{#if {}}}}} » sans « {{{{/if}}}} » de fermeture", condition));
        };
        let body = &body_start[..end];
        let matches = wanted.eq_ignore_ascii_case(family);
        if matches != negate {
            out.push_str(body);
        }
        rest = &body_start[end + "{{/if}}".len()..];
    }
    Ok(out)
}

/// Noms des variables de gabarit reconnues. Tout autre `{{…}}` est laissé tel quel :
/// beaucoup de commandes l'emploient pour leur propre usage (`docker ps --format
/// '{{.Names}}'`, Go templates, Ansible/Jinja…) et ne doivent pas être modifiées.
const TEMPLATE_VARIABLES: [&str; 8] =
    ["pkg_update", "pkg_upgrade", "pkg_install", "pkg_clean", "service_restart", "reboot_if_required", "os_id", "os_version"];

fn variable_name(expr: &str) -> &str {
    expr.trim().split(char::is_whitespace).next().unwrap_or_default()
}

/// Le script emploie-t-il une variable ou un bloc conditionnel de gabarit ? Sinon il
/// s'exécute tel quel, sans détection d'OS.
pub fn uses_template(script: &str) -> bool {
    if script.contains("{{#if") {
        return true;
    }
    let mut rest = script;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else { return false };
        if TEMPLATE_VARIABLES.contains(&variable_name(&after[..end])) {
            return true;
        }
        rest = &after[end + 2..];
    }
    false
}

fn expand_variables(script: &str, os: &DetectedOs) -> Result<String, String> {
    let mut out = String::with_capacity(script.len());
    let mut rest = script;
    loop {
        let Some(start) = rest.find("{{") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            // « {{ » sans fermeture : ce n'est pas une variable, on garde le texte
            out.push_str(&rest[start..]);
            break;
        };
        let raw = &after[..end];
        if TEMPLATE_VARIABLES.contains(&variable_name(raw)) {
            out.push_str(&resolve_variable(raw.trim(), os)?);
        } else {
            out.push_str(&rest[start..start + 2 + end + 2]);
        }
        rest = &after[end + 2..];
    }
    Ok(out)
}

fn resolve_variable(expr: &str, os: &DetectedOs) -> Result<String, String> {
    let mut parts = expr.splitn(2, char::is_whitespace);
    let name = parts.next().unwrap_or_default();
    let arg = parts.next().map(str::trim).unwrap_or_default();
    match name {
        "pkg_update" => pkg_update(os.family),
        "pkg_upgrade" => pkg_upgrade(os.family),
        "pkg_clean" => pkg_clean(os.family),
        "reboot_if_required" => reboot_if_required(os.family),
        "os_id" => Ok(os.id.clone()),
        "os_version" => Ok(os.version_id.clone().unwrap_or_default()),
        "pkg_install" => {
            if arg.is_empty() {
                return Err("« {{pkg_install }} » attend un nom de paquet : {{pkg_install nginx}}".into());
            }
            pkg_install(os.family, validate_identifier("paquet", arg)?)
        }
        "service_restart" => {
            if arg.is_empty() {
                return Err("« {{service_restart }} » attend un nom de service : {{service_restart nginx}}".into());
            }
            service_restart(os.init, validate_identifier("service", arg)?)
        }
        _ => Err(format!("Variable de gabarit inconnue : {{{{{}}}}}", expr)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn debian() -> DetectedOs {
        parse_posix_probe(
            "PRETTY_NAME=\"Debian GNU/Linux 12 (bookworm)\"\nID=debian\nVERSION_ID=\"12\"\n",
        )
        .unwrap()
    }

    fn ubuntu() -> DetectedOs {
        parse_posix_probe("PRETTY_NAME=\"Ubuntu 24.04.1 LTS\"\nID=ubuntu\nID_LIKE=debian\nVERSION_ID=\"24.04\"\n").unwrap()
    }

    fn alpine() -> DetectedOs {
        parse_posix_probe("PRETTY_NAME=\"Alpine Linux v3.20\"\nID=alpine\nVERSION_ID=3.20.3\n").unwrap()
    }

    fn windows_server() -> DetectedOs {
        parse_windows_probe("Microsoft Windows Server 2022 Standard\n").unwrap()
    }

    // ── Détection ──────────────────────────────────────────────────────

    #[test]
    fn parses_os_release_for_debian_family_distros() {
        let d = debian();
        assert_eq!((d.id.as_str(), d.version_id.as_deref(), d.pretty_name.as_str()), ("debian", Some("12"), "Debian GNU/Linux 12 (bookworm)"));
        assert_eq!(d.family, PkgFamily::Apt);
        assert_eq!(d.init, InitSystem::Systemd);

        let u = ubuntu();
        assert_eq!(u.family, PkgFamily::Apt);
        assert_eq!(u.pretty_name, "Ubuntu 24.04.1 LTS");
    }

    #[test]
    fn id_like_resolves_the_family_when_id_itself_is_unknown() {
        let os = parse_posix_probe("ID=pop\nID_LIKE=\"ubuntu debian\"\nPRETTY_NAME=\"Pop!_OS 22.04\"\n").unwrap();
        assert_eq!(os.family, PkgFamily::Apt);

        // ID inconnu et ID_LIKE absent : famille indéterminée, mais pas d'échec de lecture
        let os = parse_posix_probe("ID=guix\nPRETTY_NAME=\"Guix System\"\n").unwrap();
        assert_eq!(os.family, PkgFamily::Unknown);
    }

    #[test]
    fn each_family_is_detected_from_its_id() {
        let cases = [
            ("fedora", PkgFamily::Dnf),
            ("rhel", PkgFamily::Dnf),
            ("centos", PkgFamily::Dnf),
            ("rocky", PkgFamily::Dnf),
            ("almalinux", PkgFamily::Dnf),
            ("opensuse-leap", PkgFamily::Zypper),
            ("sles", PkgFamily::Zypper),
            ("arch", PkgFamily::Pacman),
            ("manjaro", PkgFamily::Pacman),
            ("alpine", PkgFamily::Apk),
        ];
        for (id, expected) in cases {
            let os = parse_posix_probe(&format!("ID={}\nPRETTY_NAME=\"x\"\n", id)).unwrap();
            assert_eq!(os.family, expected, "{}", id);
        }
        assert_eq!(alpine().init, InitSystem::OpenRc);
    }

    #[test]
    fn falls_back_to_uname_when_os_release_is_absent() {
        // BSD/Unix sans /etc/os-release : seul `uname -s` répond
        let os = parse_posix_probe("FreeBSD\n").unwrap();
        assert_eq!((os.id.as_str(), os.family), ("freebsd", PkgFamily::Unknown));

        // macOS : `uname -s` = Darwin, puis la sortie de `sw_vers`
        let os = parse_posix_probe("Darwin\nProductName:\tmacOS\nProductVersion:\t14.5\nBuildVersion:\t23F79\n").unwrap();
        assert_eq!((os.id.as_str(), os.pretty_name.as_str(), os.version_id.as_deref()), ("darwin", "macOS 14.5", Some("14.5")));
        assert_eq!(os.family, PkgFamily::Brew);

        // Darwin sans sw_vers disponible (rare, ex. shell minimal)
        let os = parse_posix_probe("Darwin\n").unwrap();
        assert_eq!(os.pretty_name, "macOS");
    }

    #[test]
    fn empty_probe_output_is_not_a_detected_os() {
        assert!(parse_posix_probe("").is_none());
        assert!(parse_posix_probe("   \n").is_none());
        assert!(parse_windows_probe("").is_none());
    }

    #[test]
    fn windows_probe_prefers_the_powershell_caption_over_cmd_ver() {
        let os = windows_server();
        assert_eq!((os.id.as_str(), os.pretty_name.as_str(), os.family, os.init), ("windows", "Microsoft Windows Server 2022 Standard", PkgFamily::Winget, InitSystem::Windows));

        // Repli `cmd /c ver` : le numéro de version est extrait, le nom recomposé
        let os = parse_windows_probe("\nMicrosoft Windows [Version 10.0.20348.887]\n\n").unwrap();
        assert_eq!((os.pretty_name.as_str(), os.version_id.as_deref()), ("Microsoft Windows", Some("10.0.20348.887")));
    }

    // ── Actions portables ──────────────────────────────────────────────

    #[test]
    fn every_known_family_resolves_every_action() {
        let families = [
            PkgFamily::Apt, PkgFamily::Dnf, PkgFamily::Yum, PkgFamily::Zypper, PkgFamily::Pacman,
            PkgFamily::Apk, PkgFamily::Brew, PkgFamily::Winget, PkgFamily::Choco,
        ];
        for family in families {
            let os = DetectedOs {
                id: "x".into(), id_like: vec![], version_id: None, pretty_name: "x".into(), family, init: init_for(family),
            };
            for action in [
                SmartAction::UpdatePackages,
                SmartAction::UpgradeSystem,
                SmartAction::InstallPackage("htop".into()),
                SmartAction::CleanPackageCache,
                SmartAction::RebootIfRequired,
                SmartAction::RestartService("nginx".into()),
            ] {
                assert!(resolve_action(&action, &os).is_ok(), "{:?} / {:?}", family, action);
            }
        }
    }

    #[test]
    fn unknown_os_gives_a_clear_error_instead_of_a_wrong_command() {
        let os = DetectedOs { id: "guix".into(), id_like: vec![], version_id: None, pretty_name: "Guix".into(), family: PkgFamily::Unknown, init: InitSystem::Service };
        let err = resolve_action(&SmartAction::UpgradeSystem, &os).unwrap_err();
        assert!(err.contains("non reconnu") && err.contains("ignorée"), "{}", err);
        // Un service peut toujours être redémarré (repli générique `service`), même OS inconnu
        assert!(resolve_action(&SmartAction::RestartService("x".into()), &os).is_ok());
    }

    #[test]
    fn package_and_service_names_are_validated() {
        let os = debian();
        assert!(resolve_action(&SmartAction::InstallPackage("nginx-extras".into()), &os).is_ok());
        for bad in ["", "  ", "nginx; rm -rf /", "$(whoami)", "-x", "a b"] {
            assert!(resolve_action(&SmartAction::InstallPackage(bad.into()), &os).is_err(), "{:?}", bad);
        }
    }

    #[test]
    fn service_restart_picks_systemctl_rc_service_or_service() {
        assert_eq!(resolve_action(&SmartAction::RestartService("nginx".into()), &debian()).unwrap(), "sudo systemctl restart nginx");
        assert_eq!(resolve_action(&SmartAction::RestartService("crond".into()), &alpine()).unwrap(), "sudo rc-service crond restart");
        let unknown = DetectedOs { id: "x".into(), id_like: vec![], version_id: None, pretty_name: "x".into(), family: PkgFamily::Unknown, init: InitSystem::Service };
        assert_eq!(resolve_action(&SmartAction::RestartService("cron".into()), &unknown).unwrap(), "sudo service cron restart");
        assert_eq!(
            resolve_action(&SmartAction::RestartService("Spooler".into()), &windows_server()).unwrap(),
            "powershell -NoProfile -Command \"Restart-Service -Name 'Spooler' -Force\""
        );
    }

    // ── Gabarits ───────────────────────────────────────────────────────

    #[test]
    fn expands_package_and_service_variables() {
        let script = "{{pkg_update}}\n{{pkg_install nginx}}\n{{service_restart nginx}}\nOS : {{os_id}} {{os_version}}";
        let out = expand_template(script, &debian()).unwrap();
        assert_eq!(
            out,
            "sudo apt-get update -y\nsudo apt-get install -y nginx\nsudo systemctl restart nginx\nOS : debian 12"
        );
    }

    #[test]
    fn foreign_double_braces_are_kept_verbatim() {
        let os = debian();
        // Syntaxes {{…}} d'autres outils : jamais modifiées, jamais en erreur
        let docker = "docker ps --format '{{.Names}} {{ .Status }}'";
        assert_eq!(expand_template(docker, &os).unwrap(), docker);
        assert_eq!(expand_template("{{pkg_frobnicate}}", &os).unwrap(), "{{pkg_frobnicate}}");
        assert_eq!(expand_template("echo {{ unterminated", &os).unwrap(), "echo {{ unterminated");
        // Mélange : seules les vraies variables sont remplacées
        assert_eq!(
            expand_template("{{pkg_update}} && docker ps --format '{{.ID}}'", &os).unwrap(),
            "sudo apt-get update -y && docker ps --format '{{.ID}}'"
        );
        // Une vraie variable mal employée reste une erreur claire
        assert!(expand_template("{{pkg_install}}", &os).unwrap_err().contains("nom de paquet"));
    }

    #[test]
    fn uses_template_detects_only_known_variables() {
        assert!(uses_template("{{pkg_update}}"));
        assert!(uses_template("{{ pkg_install nginx }}"));
        assert!(uses_template("{{#if debian}}x{{/if}}"));
        assert!(!uses_template("docker ps --format '{{.Names}}'"));
        assert!(!uses_template("uptime"));
        assert!(!uses_template("echo {{ oops"));
    }

    #[test]
    fn conditional_blocks_keep_only_the_matching_family() {
        let script = "{{#if debian}}apt path{{/if}}{{#if alpine}}apk path{{/if}}{{#if !debian}}not debian{{/if}}";
        assert_eq!(expand_template(script, &debian()).unwrap(), "apt path");
        assert_eq!(expand_template(script, &alpine()).unwrap(), "apk pathnot debian");
    }

    #[test]
    fn conditional_blocks_combine_with_variables() {
        let script = "{{#if windows}}{{service_restart Spooler}}{{/if}}{{#if !windows}}{{service_restart cron}}{{/if}}";
        assert_eq!(
            expand_template(script, &windows_server()).unwrap(),
            "powershell -NoProfile -Command \"Restart-Service -Name 'Spooler' -Force\""
        );
        assert_eq!(expand_template(script, &debian()).unwrap(), "sudo systemctl restart cron");
    }

    #[test]
    fn unterminated_conditional_is_a_clear_error() {
        assert!(expand_template("{{#if debian}}no closing tag", &debian()).unwrap_err().contains("fermeture"));
        assert!(expand_template("{{#if}}x{{/if}}", &debian()).unwrap_err().contains("famille"));
    }

    // ── Cache ────────────────────────────────────────────────────────────

    #[test]
    fn cache_expires_after_its_ttl() {
        let cache = OsCache::new(Duration::from_millis(20));
        cache.set("srv-1", debian());
        assert!(cache.get("srv-1").is_some());
        std::thread::sleep(Duration::from_millis(40));
        assert!(cache.get("srv-1").is_none());
        assert!(cache.get("srv-inconnu").is_none());
    }

    #[test]
    fn invalidate_forces_a_fresh_detection() {
        let cache = OsCache::default();
        cache.set("srv-1", debian());
        cache.invalidate("srv-1");
        assert!(cache.get("srv-1").is_none());
    }
}
