/// Découverte réseau : table ARP de Windows, balayage ping d'un /24, détection de MAC
use serde::Serialize;
use std::net::Ipv4Addr;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ArpEntry {
    pub ip: String,
    /// Format XX:XX:XX:XX:XX:XX (celui des serveurs de l'app)
    pub mac: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Device {
    pub ip: String,
    pub mac: Option<String>,
    /// Carte réseau virtuelle (VM, conteneur) : le Wake-on-LAN n'a pas de sens
    pub virtual_nic: Option<String>,
    /// Serveur de l'app déjà configuré à cette IP
    pub known_server: Option<String>,
}

/// Préfixes (OUI) de cartes réseau virtuelles connues
const VIRTUAL_OUIS: &[(&str, &str)] = &[
    ("BC:24:11", "VM Proxmox"),
    ("52:54:00", "VM QEMU/KVM"),
    ("00:50:56", "VM VMware"),
    ("00:0C:29", "VM VMware"),
    ("00:15:5D", "VM Hyper-V"),
    ("02:42:", "conteneur Docker"),
    ("08:00:27", "VM VirtualBox"),
];

pub fn virtual_nic(mac: &str) -> Option<&'static str> {
    VIRTUAL_OUIS.iter().find(|(p, _)| mac.starts_with(p)).map(|(_, label)| *label)
}

fn normalize_mac(raw: &str) -> Option<String> {
    let parts: Vec<&str> = raw.split(['-', ':']).collect();
    if parts.len() != 6 || !parts.iter().all(|p| p.len() == 2 && p.chars().all(|c| c.is_ascii_hexdigit())) {
        return None;
    }
    Some(parts.join(":").to_uppercase())
}

/// Analyse la sortie de `arp -a` (Windows, toutes langues) : on ne garde que les
/// entrées unicast (pas de diffusion ni de multicast).
pub fn parse_arp(output: &str) -> Vec<ArpEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        let mut tokens = line.split_whitespace();
        let (Some(ip), Some(mac)) = (tokens.next(), tokens.next()) else { continue };
        let (Ok(addr), Some(mac)) = (ip.parse::<Ipv4Addr>(), normalize_mac(mac)) else { continue };
        if addr.is_multicast() || addr.is_broadcast() || addr.octets()[3] == 255 || mac == "FF:FF:FF:FF:FF:FF" {
            continue;
        }
        if !entries.iter().any(|e: &ArpEntry| e.ip == ip) {
            entries.push(ArpEntry { ip: ip.to_string(), mac });
        }
    }
    entries
}

/// Adresses hôtes (.1 à .254) du /24 d'une IP privée ; None pour une IP publique
pub fn subnet_hosts(ip: &str) -> Option<Vec<String>> {
    let addr: Ipv4Addr = ip.parse().ok()?;
    if !addr.is_private() {
        return None;
    }
    let [a, b, c, _] = addr.octets();
    Some((1..=254).map(|d| format!("{}.{}.{}.{}", a, b, c, d)).collect())
}

/// Lit la table ARP de Windows
pub async fn read_arp() -> Result<Vec<ArpEntry>, String> {
    let mut cmd = tokio::process::Command::new("arp");
    cmd.arg("-a");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let out = cmd.output().await.map_err(|e| format!("arp -a : {}", e))?;
    Ok(parse_arp(&String::from_utf8_lossy(&out.stdout)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sortie réelle de `arp -a` sur le PC (2026-09-25), en-têtes localisés compris
    const ARP: &str = "Interface\u{ff} : 192.168.1.20 --- 0x17
  Adresse Internet      Adresse physique      Type
  192.168.1.1           02-00-00-00-00-10     dynamique
  192.168.1.2           02-00-00-00-00-04     dynamique
  192.168.1.53          02-00-00-00-00-01     dynamique
  192.168.1.54          bc-24-11-00-00-02     dynamique
  192.168.1.255         ff-ff-ff-ff-ff-ff     statique
  224.0.0.22            01-00-5e-00-00-16     statique
  255.255.255.255       ff-ff-ff-ff-ff-ff     statique
";

    #[test]
    fn parses_unicast_entries_only() {
        let e = parse_arp(ARP);
        assert_eq!(e.iter().map(|x| x.ip.as_str()).collect::<Vec<_>>(), vec!["192.168.1.1", "192.168.1.2", "192.168.1.53", "192.168.1.54"]);
        assert_eq!(e[2].mac, "02:00:00:00:00:01");
    }

    #[test]
    fn detects_virtual_nics() {
        assert_eq!(virtual_nic("BC:24:11:00:00:02"), Some("VM Proxmox"));
        assert_eq!(virtual_nic("02:00:00:00:00:01"), None);
    }

    #[test]
    fn subnet_of_private_ip() {
        let hosts = subnet_hosts("192.168.1.53").unwrap();
        assert_eq!(hosts.len(), 254);
        assert_eq!(hosts[0], "192.168.1.1");
        assert!(subnet_hosts("8.8.8.8").is_none());
        assert!(subnet_hosts("pas une ip").is_none());
    }
}
