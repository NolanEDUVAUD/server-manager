/// Docker — liste des conteneurs d'un hôte via SSH (docker ps + docker stats)
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Marqueur renvoyé quand la commande `docker` n'existe pas sur l'hôte
pub const NO_DOCKER: &str = "__NO_DOCKER__";

/// Une seule connexion SSH : présence de docker, tous les conteneurs, puis
/// l'utilisation instantanée des ressources (conteneurs démarrés uniquement).
pub const LIST_COMMAND: &str = "command -v docker >/dev/null 2>&1 || { echo __NO_DOCKER__; exit 0; }; \
docker ps -a --no-trunc --format '{{json .}}'; echo '--STATS--'; \
docker stats --no-stream --format '{{json .}}' 2>/dev/null; true";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Container {
    pub id: String,
    pub name: String,
    pub image: String,
    /// running, exited, paused, restarting, created, dead
    pub state: String,
    /// Texte lisible de docker (« Up 3 hours », « Exited (0) 2 days ago »)
    pub status: String,
    pub ports: String,
    pub cpu_percent: Option<f64>,
    pub mem_percent: Option<f64>,
    /// « 12.3MiB / 1.9GiB »
    pub mem_usage: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DockerHost {
    pub available: bool,
    pub containers: Vec<Container>,
}

/// Sous-ensemble de `docker ps --format '{{json .}}'`
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsLine {
    #[serde(rename = "ID")]
    id: String,
    names: String,
    image: String,
    #[serde(default)]
    state: String,
    status: String,
    #[serde(default)]
    ports: String,
}

/// Sous-ensemble de `docker stats --format '{{json .}}'`
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct StatsLine {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "CPUPerc")]
    cpu_perc: String,
    mem_usage: String,
    mem_perc: String,
}

fn percent(value: &str) -> Option<f64> {
    value.trim().trim_end_matches('%').parse().ok()
}

/// Anciennes versions de docker : pas de champ State, on le déduit du Status
fn state_from_status(status: &str) -> String {
    let s = status.to_lowercase();
    if s.starts_with("up") {
        if s.contains("(paused)") { "paused" } else { "running" }
    } else if s.starts_with("restarting") {
        "restarting"
    } else if s.starts_with("created") {
        "created"
    } else {
        "exited"
    }
    .to_string()
}

/// Image référencée par empreinte (« sha256:1ea34eafe5dc6910… ») : on garde 12 caractères
fn short_image(image: &str) -> String {
    match image.strip_prefix("sha256:") {
        Some(hash) => format!("sha256:{}", &hash[..hash.len().min(12)]),
        None => image.to_string(),
    }
}

/// « 0.0.0.0:53->53/tcp, [::]:53->53/tcp » → « 53->53/tcp » : l'écoute IPv4 et IPv6
/// d'un même port n'apparaît qu'une fois, et l'adresse « toutes interfaces » est omise.
fn compact_ports(ports: &str) -> String {
    let mut seen: Vec<String> = Vec::new();
    for part in ports.split(", ").map(str::trim).filter(|p| !p.is_empty()) {
        let p = part
            .strip_prefix("0.0.0.0:")
            .or_else(|| part.strip_prefix("[::]:"))
            .or_else(|| part.strip_prefix(":::"))
            .unwrap_or(part)
            .to_string();
        if !seen.contains(&p) {
            seen.push(p);
        }
    }
    seen.join(", ")
}

pub fn parse_list(output: &str) -> Result<DockerHost, String> {
    if output.contains(NO_DOCKER) {
        return Ok(DockerHost { available: false, containers: Vec::new() });
    }
    let (ps_text, stats_text) = output
        .split_once("--STATS--")
        .ok_or_else(|| format!("Sortie docker inattendue : {}", output.lines().next().unwrap_or("")))?;

    // Les stats utilisent l'ID court (12 caractères) : on les indexe ainsi
    let stats: HashMap<String, StatsLine> = stats_text
        .lines()
        .filter_map(|l| serde_json::from_str::<StatsLine>(l.trim()).ok())
        .map(|s| (s.id.chars().take(12).collect(), s))
        .collect();

    let mut containers = Vec::new();
    for line in ps_text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let Ok(ps) = serde_json::from_str::<PsLine>(line) else {
            // Message d'erreur de docker (ex. permission refusée sur le socket)
            return Err(line.to_string());
        };
        let short: String = ps.id.chars().take(12).collect();
        let st = stats.get(&short);
        containers.push(Container {
            state: if ps.state.is_empty() { state_from_status(&ps.status) } else { ps.state.clone() },
            id: short,
            name: ps.names,
            image: short_image(&ps.image),
            status: ps.status,
            ports: compact_ports(&ps.ports),
            cpu_percent: st.and_then(|s| percent(&s.cpu_perc)),
            mem_percent: st.and_then(|s| percent(&s.mem_perc)),
            mem_usage: st.map(|s| s.mem_usage.clone()),
        });
    }
    // Démarrés d'abord, puis par nom
    containers.sort_by(|a, b| (a.state != "running", &a.name).cmp(&(b.state != "running", &b.name)));
    Ok(DockerHost { available: true, containers })
}

/// Un identifiant ou nom de conteneur ne peut contenir que ces caractères :
/// le vérifier empêche toute injection dans la commande shell construite.
pub fn validate_container_ref(value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if valid {
        Ok(())
    } else {
        Err(format!("Identifiant de conteneur invalide : {}", value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTPUT: &str = r#"{"Command":"\"/docker-entrypoint.…\"","ID":"a1b2c3d4e5f6a7b8c9d0","Image":"nginx:latest","Names":"web","Ports":"0.0.0.0:80->80/tcp","State":"running","Status":"Up 3 hours"}
{"Command":"\"/bin/sh\"","ID":"0f0e0d0c0b0a09080706","Image":"alpine","Names":"old-job","Ports":"","State":"exited","Status":"Exited (0) 2 days ago"}
{"ID":"ffeeddccbbaa99887766","Image":"redis:7","Names":"cache","Ports":"6379/tcp","Status":"Up 5 minutes (Paused)"}
--STATS--
{"BlockIO":"0B / 0B","CPUPerc":"1.25%","Container":"a1b2c3d4e5f6","ID":"a1b2c3d4e5f6","MemPerc":"0.62%","MemUsage":"12.3MiB / 1.9GiB","Name":"web","NetIO":"1kB / 0B","PIDs":"3"}
{"CPUPerc":"0.00%","ID":"ffeeddccbbaa","MemPerc":"0.10%","MemUsage":"2MiB / 1.9GiB"}
"#;

    #[test]
    fn parses_containers_with_stats_running_first() {
        let host = parse_list(OUTPUT).unwrap();
        assert!(host.available);
        let names: Vec<&str> = host.containers.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["web", "cache", "old-job"]);

        let web = &host.containers[0];
        assert_eq!(web.id, "a1b2c3d4e5f6");
        assert_eq!(web.cpu_percent, Some(1.25));
        assert_eq!(web.mem_usage.as_deref(), Some("12.3MiB / 1.9GiB"));
        assert_eq!(web.ports, "80->80/tcp");

        let old = &host.containers[2];
        assert_eq!(old.state, "exited");
        assert_eq!(old.cpu_percent, None);
    }

    #[test]
    fn state_deduced_when_missing() {
        let host = parse_list(OUTPUT).unwrap();
        let cache = host.containers.iter().find(|c| c.name == "cache").unwrap();
        assert_eq!(cache.state, "paused");
    }

    #[test]
    fn digests_are_shortened_and_ports_deduplicated() {
        assert_eq!(short_image("sha256:1ea34eafe5dc691007946e8eaab7bf46b0de9412"), "sha256:1ea34eafe5dc");
        assert_eq!(short_image("nginx:latest"), "nginx:latest");
        assert_eq!(
            compact_ports("0.0.0.0:53->53/tcp, [::]:53->53/tcp, 0.0.0.0:53->53/udp, [::]:53->53/udp, 443/udp, 127.0.0.1:8080->80/tcp"),
            "53->53/tcp, 53->53/udp, 443/udp, 127.0.0.1:8080->80/tcp"
        );
        assert_eq!(compact_ports(""), "");
    }

    #[test]
    fn docker_absent() {
        assert_eq!(parse_list("__NO_DOCKER__\n").unwrap(), DockerHost { available: false, containers: vec![] });
    }

    #[test]
    fn docker_error_is_reported() {
        let err = parse_list("permission denied while trying to connect to the Docker daemon socket\n--STATS--\n").unwrap_err();
        assert!(err.contains("permission denied"));
    }

    #[test]
    fn no_containers() {
        assert!(parse_list("--STATS--\n").unwrap().containers.is_empty());
    }

    #[test]
    fn container_ref_validation_blocks_injection() {
        assert!(validate_container_ref("a1b2c3d4e5f6").is_ok());
        assert!(validate_container_ref("my_app.web-1").is_ok());
        assert!(validate_container_ref("web; rm -rf /").is_err());
        assert!(validate_container_ref("$(reboot)").is_err());
        assert!(validate_container_ref("").is_err());
    }
}
