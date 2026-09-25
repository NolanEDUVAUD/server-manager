/// Centre de mises à jour : paquets en attente (apt), redémarrage requis, conteneurs
/// Docker tournant sur une image dépassée. Lecture seule : rien n'est installé.
use serde::Serialize;

/// Une seule connexion SSH par serveur. `apt list` lit le cache local (aucun apt update).
pub const SCAN_COMMAND: &str = "export LC_ALL=C; \
echo '--APT--'; apt list --upgradable 2>/dev/null | tail -n +2; \
echo '--REBOOT--'; [ -f /var/run/reboot-required ] && echo yes || echo no; \
echo '--KERNEL--'; uname -r; \
echo '--LISTS--'; stat -c %Y /var/lib/apt/lists 2>/dev/null || echo 0; \
echo '--NOW--'; date +%s; \
echo '--DOCKER--'; command -v docker >/dev/null 2>&1 && for c in $(docker ps -q); do \
docker inspect -f '{{.Name}}|{{.Config.Image}}|{{.Image}}' $c; done; true";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Package {
    pub name: String,
    pub new_version: String,
    pub old_version: String,
    pub security: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StaleContainer {
    pub name: String,
    pub image: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateReport {
    pub apt_available: bool,
    pub packages: Vec<Package>,
    pub security_count: usize,
    pub reboot_required: bool,
    pub kernel: String,
    /// Âge de la liste des paquets (jours) : au-delà, « à jour » ne veut plus dire grand-chose
    pub lists_age_days: Option<u64>,
    /// Conteneurs dont l'image a été mise à jour localement sans recréation du conteneur
    pub stale_containers: Vec<StaleContainer>,
}

fn section<'a>(out: &'a str, name: &str) -> &'a str {
    let marker = format!("--{}--", name);
    let Some(start) = out.find(&marker) else { return "" };
    let rest = &out[start + marker.len()..];
    let end = rest.find("\n--").map(|i| i + 1).unwrap_or(rest.len());
    &rest[..end]
}

/// « nginx/stable-security 1.22.1-9+deb12u2 amd64 [upgradable from: 1.22.1-9+deb12u1] »
fn parse_package(line: &str) -> Option<Package> {
    let (name_suite, rest) = line.split_once(' ')?;
    let (name, suite) = name_suite.split_once('/')?;
    let new_version = rest.split_whitespace().next()?.to_string();
    let old_version = rest
        .split("upgradable from: ")
        .nth(1)
        .map(|s| s.trim_end_matches(']').trim().to_string())
        .unwrap_or_default();
    Some(Package { name: name.into(), new_version, old_version, security: suite.contains("security") })
}

/// Référence d'image avec un tag explicite ou implicite (:latest)
fn with_tag(image: &str) -> String {
    let last = image.rsplit('/').next().unwrap_or(image);
    if last.contains(':') || image.contains('@') { image.to_string() } else { format!("{}:latest", image) }
}

pub fn parse_scan(out: &str, current_image_ids: &[(String, String)]) -> UpdateReport {
    let apt_text = section(out, "APT");
    let packages: Vec<Package> = apt_text.lines().map(str::trim).filter(|l| !l.is_empty()).filter_map(parse_package).collect();
    let lists = section(out, "LISTS").trim().parse::<u64>().unwrap_or(0);
    let now = section(out, "NOW").trim().parse::<u64>().unwrap_or(0);
    let stale_containers = section(out, "DOCKER")
        .lines()
        .filter_map(|l| {
            let mut p = l.trim().splitn(3, '|');
            let (name, image, running_id) = (p.next()?, p.next()?, p.next()?);
            // Identifiant actuel du tag (fourni par une 2e lecture) ≠ image du conteneur
            let tag_id = current_image_ids.iter().find(|(r, _)| *r == with_tag(image)).map(|(_, id)| id.as_str())?;
            (tag_id != running_id).then(|| StaleContainer { name: name.trim_start_matches('/').into(), image: image.into() })
        })
        .collect();
    UpdateReport {
        apt_available: out.contains("--APT--") && lists > 0,
        security_count: packages.iter().filter(|p| p.security).count(),
        packages,
        reboot_required: section(out, "REBOOT").trim() == "yes",
        kernel: section(out, "KERNEL").trim().to_string(),
        lists_age_days: (lists > 0 && now >= lists).then(|| (now - lists) / 86_400),
        stale_containers,
    }
}

/// Images référencées par les conteneurs (pour demander leur identifiant actuel)
pub fn referenced_images(out: &str) -> Vec<String> {
    let mut v: Vec<String> = section(out, "DOCKER")
        .lines()
        .filter_map(|l| l.trim().split('|').nth(1).map(with_tag))
        .collect();
    v.sort();
    v.dedup();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUT: &str = "--APT--
nginx/stable-security 1.22.1-9+deb12u2 amd64 [upgradable from: 1.22.1-9+deb12u1]
curl/stable 7.88.1-10+deb12u8 amd64 [upgradable from: 7.88.1-10+deb12u7]
--REBOOT--
yes
--KERNEL--
6.8.12-4-pve
--LISTS--
1790000000
--NOW--
1790345600
--DOCKER--
/adguardhome|adguard/adguardhome|sha256:1ea34eafe5dc
/mosquitto|eclipse-mosquitto:2|sha256:aaaa
/n8n|n8nio/n8n:latest|sha256:882b126a8ddd
";

    #[test]
    fn packages_security_reboot_kernel() {
        let r = parse_scan(OUT, &[]);
        assert_eq!(r.packages.len(), 2);
        assert_eq!(r.security_count, 1);
        assert_eq!(r.packages[0], Package { name: "nginx".into(), new_version: "1.22.1-9+deb12u2".into(), old_version: "1.22.1-9+deb12u1".into(), security: true });
        assert!(r.reboot_required);
        assert_eq!(r.kernel, "6.8.12-4-pve");
        assert_eq!(r.lists_age_days, Some(4));
    }

    #[test]
    fn stale_containers_compare_running_image_with_current_tag() {
        let ids = vec![
            ("adguard/adguardhome:latest".to_string(), "sha256:NEW".to_string()),
            ("eclipse-mosquitto:2".to_string(), "sha256:aaaa".to_string()),
        ];
        let r = parse_scan(OUT, &ids);
        // adguard : tag déplacé → obsolète ; mosquitto : à jour ; n8n : identifiant inconnu → ignoré
        assert_eq!(r.stale_containers, vec![StaleContainer { name: "adguardhome".into(), image: "adguard/adguardhome".into() }]);
        assert_eq!(referenced_images(OUT), vec!["adguard/adguardhome:latest", "eclipse-mosquitto:2", "n8nio/n8n:latest"]);
    }

    #[test]
    fn no_apt_no_docker() {
        let r = parse_scan("--APT--\n--REBOOT--\nno\n--KERNEL--\nx\n--LISTS--\n0\n--NOW--\n5\n--DOCKER--\n", &[]);
        assert!(!r.apt_available);
        assert!(r.packages.is_empty() && r.stale_containers.is_empty() && !r.reboot_required);
        assert_eq!(r.lists_age_days, None);
    }
}
