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
    /// Fabricant deviné à partir des 3 premiers octets de la MAC (OUI), absent
    /// des anciennes réponses de `network_scan` mises en cache côté front
    #[serde(default)]
    pub vendor: Option<String>,
    /// Type d'appareil deviné (routeur, switch, NAS…) — voir `DeviceKind`
    #[serde(default)]
    pub device_kind: Option<DeviceKind>,
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

// ── Fabricants (OUI) et type d'appareil devinés ─────────────────────────────
// Table volontairement réduite : juste de quoi reconnaître les marques réseau et
// objets connectés les plus courants d'un homelab (pas une base IEEE complète).
const VENDOR_OUIS: &[(&str, &str)] = &[
    ("50:C7:BF", "TP-Link"),
    ("EC:08:6B", "TP-Link"),
    ("C4:6E:1F", "TP-Link"),
    ("98:DA:C4", "TP-Link"),
    ("A0:40:A0", "Netgear"),
    ("44:94:FC", "Netgear"),
    ("20:E5:2A", "Netgear"),
    ("24:A4:3C", "Ubiquiti"),
    ("04:18:D6", "Ubiquiti"),
    ("F0:9F:C2", "Ubiquiti"),
    ("74:83:C2", "Ubiquiti"),
    ("4C:5E:0C", "MikroTik"),
    ("6C:3B:6B", "MikroTik"),
    ("D4:CA:6D", "MikroTik"),
    ("1C:7E:E5", "D-Link"),
    ("00:1B:11", "D-Link"),
    ("08:60:6E", "ASUS"),
    ("1C:87:2C", "ASUS"),
    ("AC:9E:17", "ASUS"),
    ("F0:18:98", "Apple"),
    ("A4:5E:60", "Apple"),
    ("3C:15:C2", "Apple"),
    ("88:66:5A", "Apple"),
    ("B8:27:EB", "Raspberry Pi"),
    ("DC:A6:32", "Raspberry Pi"),
    ("E4:5F:01", "Raspberry Pi"),
    ("00:11:32", "Synology"),
    ("24:5E:BE", "QNAP"),
    ("8C:79:F5", "Samsung"),
    ("E8:50:8B", "Samsung"),
    ("5C:AA:FD", "Sonos"),
    ("00:0E:58", "Sonos"),
    ("44:65:0D", "Amazon"),
    ("68:37:E9", "Amazon"),
    ("FC:65:DE", "Amazon"),
    ("54:60:09", "Google"),
    ("F4:F5:D8", "Google"),
    ("D8:6C:63", "Google"),
    ("3C:D9:2B", "HP"),
    ("70:5A:0F", "HP"),
    ("00:1E:8F", "Canon"),
    ("00:14:22", "Dell"),
    ("D4:AE:52", "Dell"),
    ("24:0A:C4", "Espressif"),
    ("30:AE:A4", "Espressif"),
    ("EC:FA:BC", "Espressif"),
    ("78:11:DC", "Xiaomi"),
    ("34:CE:00", "Xiaomi"),
];

/// Cherche le fabricant à partir des 3 premiers octets (OUI) d'une MAC.
/// Table non exhaustive : `None` ne veut pas dire « fabricant inconnu du marché »,
/// juste « absent de notre petite table ».
pub fn lookup_vendor(mac: &str) -> Option<&'static str> {
    let mac = mac.to_uppercase();
    let prefix = mac.get(0..8)?; // "XX:XX:XX"
    VENDOR_OUIS.iter().find(|(p, _)| *p == prefix).map(|(_, name)| *name)
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeviceKind {
    Router,
    Switch,
    AccessPoint,
    Server,
    Nas,
    Phone,
    Tv,
    Printer,
    Iot,
    Unknown,
}

/// Devine le type d'appareil à partir du fabricant (OUI) et/ou d'un nom (hôte
/// connu, profil DHCP…). Heuristique simple — jamais catégorique, juste indicative,
/// faute de vraie découverte L2 (SNMP/LLDP) sur un poste Windows sans droits admin.
pub fn guess_device_kind(vendor: Option<&str>, hostname: Option<&str>) -> DeviceKind {
    let hay = format!("{} {}", vendor.unwrap_or(""), hostname.unwrap_or(""))
        .to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| hay.contains(n));

    if has(&["box", "livebox", "freebox", "router", "routeur", "gateway", "passerelle", "bbox"]) {
        DeviceKind::Router
    } else if has(&["switch", "commutateur"]) {
        DeviceKind::Switch
    } else if has(&["unifi", "access point", "point d'accès", "point d'acces", " ap ", "-ap-", "-ap"]) {
        DeviceKind::AccessPoint
    } else if has(&["synology", "qnap", "truenas", " nas", "nas-", "nas "]) {
        DeviceKind::Nas
    } else if has(&["printer", "imprimante", "canon", "epson", "brother"]) {
        DeviceKind::Printer
    } else if has(&["chromecast", "roku", "appletv", "apple tv", " tv", "tv-", "smart-tv"]) {
        DeviceKind::Tv
    } else if has(&["iphone", "android", "smartphone", "galaxy", "pixel", "téléphone", "telephone"]) {
        DeviceKind::Phone
    } else if has(&["espressif", "xiaomi", "sonos", "nest", "echo", "tuya", "shelly", "tasmota", "esp32", "esp8266"]) {
        DeviceKind::Iot
    } else if has(&["server", "serveur", "proxmox", "esxi", "supermicro", "dell"]) {
        DeviceKind::Server
    } else {
        DeviceKind::Unknown
    }
}

// ── Passerelle et table de routage ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct RouteEntry {
    pub destination: String,
    /// Absent côté Linux (fondu dans la notation CIDR de `destination`)
    pub mask: Option<String>,
    /// `None` = route locale (« on-link » / « Sur liaison » selon la langue de Windows,
    /// ou `dev` sans `via` sous Linux) : ni l'un ni l'autre n'est comparé littéralement,
    /// seule la présence d'une IP de passerelle valide compte, pour rester indépendant
    /// de la langue de l'OS (cf. `parse_arp`).
    pub gateway: Option<String>,
    /// IP locale de l'interface (Windows) ou son nom (Linux, ex. `eth0`, `wg0`)
    pub interface: Option<String>,
    pub metric: Option<u32>,
}

/// Analyse la sortie de `route print -4` (Windows). Ne dépend d'aucun texte
/// localisé : une ligne de route a toujours 5 champs, dont les deux premiers sont
/// des adresses IPv4 valides (destination, masque) ; les lignes de titre ou
/// d'en-tête ne collent jamais à ce test et sont donc ignorées naturellement.
pub fn parse_route_print(output: &str) -> Vec<RouteEntry> {
    let mut routes = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() != 5 {
            continue;
        }
        if tokens[0].parse::<Ipv4Addr>().is_err() || tokens[1].parse::<Ipv4Addr>().is_err() {
            continue;
        }
        let gateway = tokens[2].parse::<Ipv4Addr>().ok().map(|a| a.to_string());
        routes.push(RouteEntry {
            destination: tokens[0].to_string(),
            mask: Some(tokens[1].to_string()),
            gateway,
            interface: Some(tokens[3].to_string()),
            metric: tokens[4].parse().ok(),
        });
    }
    routes
}

/// Analyse la sortie de `ip route` (Linux) — un routeur/box/serveur Linux du
/// homelab, ou repli quand l'app tourne hors Windows.
pub fn parse_ip_route(output: &str) -> Vec<RouteEntry> {
    let mut routes = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let Some(&first) = tokens.first() else { continue };
        let destination = if first == "default" { "0.0.0.0".to_string() } else { first.to_string() };
        let (mut gateway, mut interface, mut metric) = (None, None, None);
        let mut i = 1;
        while i + 1 < tokens.len() {
            match tokens[i] {
                "via" => gateway = Some(tokens[i + 1].to_string()),
                "dev" => interface = Some(tokens[i + 1].to_string()),
                "metric" => metric = tokens[i + 1].parse().ok(),
                _ => {}
            }
            i += 1;
        }
        routes.push(RouteEntry { destination, mask: None, gateway, interface, metric });
    }
    routes
}

/// Passerelle par défaut (route vers 0.0.0.0), tous OS confondus une fois parsée.
pub fn default_gateway(routes: &[RouteEntry]) -> Option<String> {
    routes.iter().find(|r| r.destination == "0.0.0.0").and_then(|r| r.gateway.clone())
}

/// Routes « supplémentaires » créées par autre chose que le réseau local principal :
/// routes statiques, interfaces VPN (WireGuard/Tailscale…). Heuristique : une route
/// locale (« on-link », donc sans IP de passerelle) qui n'est pas la route par
/// défaut et qui porte sur une interface différente de celle-ci — c'est-à-dire un
/// sous-réseau atteignable directement via une autre carte que la carte principale.
pub fn extra_subnets(routes: &[RouteEntry]) -> Vec<RouteEntry> {
    let default_iface = routes.iter().find(|r| r.destination == "0.0.0.0").and_then(|r| r.interface.clone());
    let Some(default_iface) = default_iface else { return Vec::new() };
    routes
        .iter()
        .filter(|r| r.destination != "0.0.0.0")
        .filter(|r| !r.destination.starts_with("127.") && r.destination != "255.255.255.255")
        .filter(|r| r.gateway.is_none())
        .filter(|r| r.interface.as_deref().is_some_and(|i| i != default_iface))
        .cloned()
        .collect()
}

// ── Wi-Fi (point d'accès de l'hôte) ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct WlanInfo {
    pub ssid: Option<String>,
    pub bssid: Option<String>,
    pub signal_percent: Option<u8>,
    pub channel: Option<u32>,
    /// Bande devinée à partir du canal (indicatif : les canaux Wi-Fi 6E 6 GHz
    /// réutilisent des numéros déjà pris par le 2,4/5 GHz, donc approximatif)
    pub band: Option<String>,
}

fn band_for_channel(channel: u32) -> String {
    match channel {
        1..=14 => "2.4 GHz",
        36..=177 => "5 GHz",
        _ => "6 GHz",
    }
    .to_string()
}

/// Analyse la sortie de `netsh wlan show interfaces` (Windows, quelle que soit la
/// langue : on ne teste pas les libellés eux-mêmes, seulement leur préfixe une fois
/// mis en minuscule côté clé — "SSID", "Signal", "Canal"/"Channel" restent stables
/// même localisés en pratique sur les builds Windows courants).
pub fn parse_netsh_wlan(output: &str) -> Option<WlanInfo> {
    let mut ssid = None;
    let mut bssid = None;
    let mut signal_percent = None;
    let mut channel = None;
    for line in output.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        let key = key.trim().to_lowercase();
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        if key == "ssid" && ssid.is_none() {
            ssid = Some(value.to_string());
        } else if key == "bssid" {
            bssid = Some(value.to_uppercase());
        } else if key.starts_with("signal") {
            signal_percent = value.trim_end_matches('%').trim().parse().ok();
        } else if key.starts_with("channel") || key.starts_with("canal") {
            channel = value.parse().ok();
        }
    }
    if ssid.is_none() && bssid.is_none() {
        return None;
    }
    Some(WlanInfo { ssid, bssid, signal_percent, band: channel.map(band_for_channel), channel })
}

/// Découpe une ligne `nmcli -t` en champs, en tenant compte de l'échappement des
/// `:` internes (ex. dans la BSSID) par un antislash.
fn split_nmcli_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
            }
            ':' => fields.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    fields.push(current);
    fields
}

/// Repli Linux : `nmcli -t -f active,ssid,bssid,signal,chan dev wifi`.
pub fn parse_nmcli_wifi(output: &str) -> Option<WlanInfo> {
    for line in output.lines() {
        let fields = split_nmcli_line(line);
        if fields.len() < 4 || fields[0] != "yes" {
            continue;
        }
        let ssid = (!fields[1].is_empty()).then(|| fields[1].clone());
        let bssid = (!fields[2].is_empty()).then(|| fields[2].to_uppercase());
        let signal_percent = fields[3].parse().ok();
        let channel = fields.get(4).and_then(|c| c.parse().ok());
        return Some(WlanInfo { ssid, bssid, signal_percent, band: channel.map(band_for_channel), channel });
    }
    None
}

// ── Traceroute « léger » vers la passerelle / Internet ──────────────────────

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct TracerouteHop {
    pub hop: u32,
    /// `None` = saut muet (timeout, `*`/pare-feu qui ne répond pas à l'ICMP)
    pub ip: Option<String>,
    pub rtt_ms: Option<u32>,
}

/// Analyse la sortie de `tracert -d` (Windows) ou `traceroute -n` (Linux) : formats
/// proches (numéro de saut, temps(s) de trajet, adresse), suffisamment pour
/// distinguer un saut muet d'un saut atteint, sans dépendre de la langue de l'OS.
pub fn parse_tracert(output: &str) -> Vec<TracerouteHop> {
    let mut hops = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let Some(hop) = tokens.first().and_then(|t| t.parse::<u32>().ok()) else { continue };
        if tokens.len() < 2 {
            continue;
        }
        let rest = &tokens[1..];
        let ip = rest.iter().rev().find_map(|t| t.trim_matches(['(', ')']).parse::<Ipv4Addr>().ok()).map(|a| a.to_string());
        let rtt_ms = rest.iter().find_map(|t| t.trim_start_matches('<').trim_end_matches("ms").parse::<u32>().ok());
        hops.push(TracerouteHop { hop, ip, rtt_ms });
    }
    hops
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

    // ── Fabricant / type d'appareil ─────────────────────────────────────────

    #[test]
    fn looks_up_known_vendor_prefixes() {
        assert_eq!(lookup_vendor("24:A4:3C:11:22:33"), Some("Ubiquiti"));
        assert_eq!(lookup_vendor("b8:27:eb:aa:bb:cc"), Some("Raspberry Pi"));
        assert_eq!(lookup_vendor("00:00:00:00:00:00"), None);
    }

    #[test]
    fn guesses_device_kind_from_vendor_or_name() {
        assert_eq!(guess_device_kind(Some("MikroTik"), Some("Switch-Garage")), DeviceKind::Switch);
        assert_eq!(guess_device_kind(Some("Ubiquiti"), Some("UniFi-AP-Salon")), DeviceKind::AccessPoint);
        assert_eq!(guess_device_kind(None, Some("Livebox")), DeviceKind::Router);
        assert_eq!(guess_device_kind(Some("Synology"), None), DeviceKind::Nas);
        assert_eq!(guess_device_kind(Some("HP"), Some("Imprimante-Bureau")), DeviceKind::Printer);
        assert_eq!(guess_device_kind(Some("Espressif"), None), DeviceKind::Iot);
        assert_eq!(guess_device_kind(None, Some("iPhone de Léa")), DeviceKind::Phone);
        assert_eq!(guess_device_kind(Some("Dell"), Some("minipc")), DeviceKind::Server);
        assert_eq!(guess_device_kind(None, None), DeviceKind::Unknown);
    }

    // ── Table de routage ─────────────────────────────────────────────────────

    /// Sortie simplifiée de `route print -4` (Windows) : passerelle par défaut,
    /// réseau local, et une route supplémentaire vers un tunnel WireGuard.
    const ROUTE_PRINT: &str = "===========================================================================
Interface List
 12...00 15 5d 4a 6f 01 ......Carte réseau
===========================================================================

IPv4 Route Table
===========================================================================
Active Routes:
Network Destination        Netmask          Gateway       Interface  Metric
          0.0.0.0          0.0.0.0    192.168.1.1    192.168.1.20     25
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
     192.168.1.0    255.255.255.0         On-link      192.168.1.20    281
   192.168.1.20  255.255.255.255         On-link      192.168.1.20    281
       10.6.0.0        255.255.0.0         On-link          10.6.0.1     58
===========================================================================
Persistent Routes:
  Network Address          Netmask  Gateway Address  Metric
    0.0.0.0          0.0.0.0    192.168.1.1     1
";

    #[test]
    fn parses_route_print_regardless_of_locale() {
        let routes = parse_route_print(ROUTE_PRINT);
        // 5 routes actives (les en-têtes et le tableau des routes persistantes,
        // qui n'a que 4 colonnes, sont naturellement ignorés)
        assert_eq!(routes.len(), 5);
        assert_eq!(default_gateway(&routes).as_deref(), Some("192.168.1.1"));
        let onlink = routes.iter().find(|r| r.destination == "127.0.0.0").unwrap();
        assert!(onlink.gateway.is_none());
    }

    #[test]
    fn parses_ip_route_linux() {
        let out = "default via 192.168.1.1 dev eth0 proto dhcp metric 100\n\
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.20 metric 100\n\
10.6.0.0/16 dev wg0 proto kernel scope link src 10.6.0.1\n";
        let routes = parse_ip_route(out);
        assert_eq!(routes.len(), 3);
        assert_eq!(default_gateway(&routes).as_deref(), Some("192.168.1.1"));
        let vpn = routes.iter().find(|r| r.destination == "10.6.0.0/16").unwrap();
        assert_eq!(vpn.interface.as_deref(), Some("wg0"));
        assert!(vpn.gateway.is_none());
    }

    #[test]
    fn finds_extra_subnets_on_a_different_interface_than_the_default_route() {
        let routes = parse_route_print(ROUTE_PRINT);
        let extra = extra_subnets(&routes);
        assert_eq!(extra.iter().map(|r| r.destination.as_str()).collect::<Vec<_>>(), vec!["10.6.0.0"]);
    }

    #[test]
    fn no_extra_subnets_without_a_default_route() {
        assert!(extra_subnets(&[]).is_empty());
    }

    // ── Wi-Fi ────────────────────────────────────────────────────────────────

    const NETSH_WLAN: &str = "There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6 AX200 160MHz
    GUID                   : a1b2c3d4-0000-0000-0000-000000000000
    Physical address       : ac:de:48:00:11:22
    State                  : connected
    SSID                   : MonReseau
    BSSID                  : 00:11:22:33:44:55
    Network type           : Infrastructure
    Radio type             : 802.11ac
    Authentication         : WPA2-Personal
    Cipher                 : CCMP
    Connectivity mode      : Extended
    Channel                : 44
    Receive rate (Mbps)    : 866.7
    Transmit rate (Mbps)   : 866.7
    Signal                 : 78%
    Profile                : MonReseau
";

    #[test]
    fn parses_netsh_wlan_show_interfaces() {
        let wlan = parse_netsh_wlan(NETSH_WLAN).unwrap();
        assert_eq!(wlan.ssid.as_deref(), Some("MonReseau"));
        assert_eq!(wlan.bssid.as_deref(), Some("00:11:22:33:44:55"));
        assert_eq!(wlan.signal_percent, Some(78));
        assert_eq!(wlan.channel, Some(44));
        assert_eq!(wlan.band.as_deref(), Some("5 GHz"));
    }

    #[test]
    fn no_wlan_when_not_connected() {
        assert!(parse_netsh_wlan("There is 1 interface on the system:\n\n    Name : Wi-Fi\n    State : disconnected\n").is_none());
    }

    #[test]
    fn parses_nmcli_active_connection() {
        let out = "yes:MonReseau:00\\:11\\:22\\:33\\:44\\:55:78:44\nno:Voisin:AA\\:BB\\:CC\\:DD\\:EE\\:FF:20:6\n";
        let wlan = parse_nmcli_wifi(out).unwrap();
        assert_eq!(wlan.ssid.as_deref(), Some("MonReseau"));
        assert_eq!(wlan.bssid.as_deref(), Some("00:11:22:33:44:55"));
        assert_eq!(wlan.signal_percent, Some(78));
    }

    // ── Traceroute ───────────────────────────────────────────────────────────

    const TRACERT: &str = "
Détermination de l'itinéraire vers 1.1.1.1 avec un maximum de 5 sauts

  1     1 ms     1 ms     1 ms  192.168.1.1
  2     8 ms     7 ms     7 ms  10.6.0.1
  3     *        *        *     Délai d'attente de la demande dépassé.
  4    15 ms    14 ms    13 ms  1.1.1.1

Itinéraire déterminé.
";

    #[test]
    fn parses_tracert_hops_including_timeouts() {
        let hops = parse_tracert(TRACERT);
        assert_eq!(hops.len(), 4);
        assert_eq!(hops[0].hop, 1);
        assert_eq!(hops[0].ip.as_deref(), Some("192.168.1.1"));
        assert_eq!(hops[0].rtt_ms, Some(1));
        assert_eq!(hops[2].hop, 3);
        assert!(hops[2].ip.is_none());
        assert!(hops[2].rtt_ms.is_none());
        assert_eq!(hops[3].ip.as_deref(), Some("1.1.1.1"));
    }
}
