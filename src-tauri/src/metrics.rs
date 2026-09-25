/// Monitoring des ressources — modèle + parseur de la sortie SSH
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiskUsage {
    pub name: String,
    pub mount: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TempSensor {
    pub chip: String,
    pub label: String,
    pub celsius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ServerMetrics {
    pub cpu_percent: f64,
    pub mem_total_bytes: u64,
    pub mem_used_bytes: u64,
    pub uptime_secs: u64,
    pub load_avg: [f64; 3],
    pub disks: Vec<DiskUsage>,
    pub temperatures: Vec<TempSensor>,
    /// Sonde la plus chaude du processeur (coretemp / k10temp…), si le serveur en expose une
    pub cpu_temp_celsius: Option<f64>,
}

/// Commande unique exécutée par SSH à chaque collecte. Les deux lectures de
/// /proc/stat à 1 s d'intervalle permettent de calculer le CPU sans garder
/// d'état entre deux collectes. `true` final : un `df` partiellement en échec
/// (montage réseau injoignable…) ne doit pas faire échouer toute la collecte.
pub const METRICS_COMMAND: &str = "export LC_ALL=C; head -1 /proc/stat; sleep 1; head -1 /proc/stat; \
echo '--MEM--'; cat /proc/meminfo; echo '--UP--'; cat /proc/uptime; \
echo '--LOAD--'; cat /proc/loadavg; echo '--DF--'; df -P -k -T 2>/dev/null; echo '--TEMP--'; for f in /sys/class/hwmon/hwmon*/temp*_input; do [ -r \"$f\" ] || continue; d=${f%/*}; echo \"$(cat $d/name 2>/dev/null)|$(cat ${f%_input}_label 2>/dev/null)|$(cat $f 2>/dev/null)\"; done; true";

/// Puces de température du processeur (Intel, AMD, Raspberry Pi…)
const CPU_TEMP_CHIPS: &[&str] = &["coretemp", "k10temp", "zenpower", "cpu_thermal"];

/// Systèmes de fichiers « réels » affichés ; tout le reste (tmpfs, overlay,
/// vfat de l'EFI, squashfs des snaps…) est ignoré.
const REAL_FS: &[&str] = &["ext2", "ext3", "ext4", "xfs", "btrfs", "zfs", "f2fs"];

pub fn parse_metrics(output: &str) -> Result<ServerMetrics, String> {
    let head = section(output, None, "--MEM--")?;
    let cpu_percent = parse_cpu(head)?;
    let (mem_total_bytes, mem_used_bytes) = parse_mem(section(output, Some("--MEM--"), "--UP--")?)?;
    let uptime_secs = parse_uptime(section(output, Some("--UP--"), "--LOAD--")?)?;
    let load_avg = parse_load(section(output, Some("--LOAD--"), "--DF--")?)?;
    // La section des températures est absente sur les anciennes sorties : elle est facultative
    let tail = section(output, Some("--DF--"), "")?;
    let (df_text, temp_text) = tail.split_once("--TEMP--").unwrap_or((tail, ""));
    let disks = parse_df(df_text);
    let temperatures = parse_temps(temp_text);
    let cpu_temp_celsius = cpu_temperature(&temperatures);

    Ok(ServerMetrics {
        cpu_percent,
        mem_total_bytes,
        mem_used_bytes,
        uptime_secs,
        load_avg,
        disks,
        temperatures,
        cpu_temp_celsius,
    })
}

/// Lignes `puce|libellé|millidegrés` produites par la boucle sur /sys/class/hwmon.
fn parse_temps(text: &str) -> Vec<TempSensor> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.trim().splitn(3, '|');
            let chip = parts.next()?.trim();
            let label = parts.next()?.trim();
            let milli: f64 = parts.next()?.trim().parse().ok()?;
            let celsius = milli / 1000.0;
            // 0 °C ou valeurs aberrantes : capteur non câblé. Aucun composant ne survit
            // à 125 °C (arrêt thermique vers 100-105 °C) ; dell_smm renvoie par exemple
            // 126 °C pour une sonde absente
            if chip.is_empty() || celsius <= 0.0 || celsius >= 125.0 {
                return None;
            }
            Some(TempSensor {
                chip: chip.to_string(),
                label: if label.is_empty() { chip.to_string() } else { label.to_string() },
                celsius,
            })
        })
        .collect()
}

pub fn cpu_temperature(sensors: &[TempSensor]) -> Option<f64> {
    sensors
        .iter()
        .filter(|t| CPU_TEMP_CHIPS.contains(&t.chip.as_str()))
        .map(|t| t.celsius)
        .fold(None, |max, c| Some(max.map_or(c, |m: f64| m.max(c))))
}

/// Extrait le texte entre deux marqueurs (`end` vide = jusqu'à la fin).
fn section<'a>(output: &'a str, start: Option<&str>, end: &str) -> Result<&'a str, String> {
    let from = match start {
        Some(marker) => {
            output.find(marker).ok_or_else(|| format!("Sortie invalide : marqueur {} absent", marker))?
                + marker.len()
        }
        None => 0,
    };
    let rest = &output[from..];
    if end.is_empty() {
        return Ok(rest);
    }
    let to = rest.find(end).ok_or_else(|| format!("Sortie invalide : marqueur {} absent", end))?;
    Ok(&rest[..to])
}

/// Renvoie (total, idle) d'une ligne `cpu  user nice system idle iowait irq softirq steal …`.
fn cpu_counters(line: &str) -> Result<(u64, u64), String> {
    let values: Vec<u64> = line
        .split_whitespace()
        .skip(1)
        .take(8) // guest/guest_nice sont déjà inclus dans user/nice
        .map(|v| v.parse::<u64>().map_err(|_| format!("Ligne /proc/stat invalide : {}", line)))
        .collect::<Result<_, _>>()?;
    if values.len() < 5 {
        return Err(format!("Ligne /proc/stat incomplète : {}", line));
    }
    let idle = values[3] + values[4];
    Ok((values.iter().sum(), idle))
}

fn parse_cpu(text: &str) -> Result<f64, String> {
    let lines: Vec<&str> = text.lines().filter(|l| l.starts_with("cpu ")).collect();
    if lines.len() < 2 {
        return Err("Sortie invalide : deux lectures de /proc/stat attendues".into());
    }
    let (t1, i1) = cpu_counters(lines[0])?;
    let (t2, i2) = cpu_counters(lines[1])?;
    let total = t2.saturating_sub(t1);
    if total == 0 {
        return Ok(0.0);
    }
    let busy = total.saturating_sub(i2.saturating_sub(i1));
    Ok(busy as f64 * 100.0 / total as f64)
}

fn parse_mem(text: &str) -> Result<(u64, u64), String> {
    let field = |name: &str| -> Option<u64> {
        text.lines()
            .find(|l| l.starts_with(name))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse::<u64>().ok())
    };
    let total = field("MemTotal:").ok_or("Sortie invalide : MemTotal absent")?;
    // MemAvailable existe depuis Linux 3.14 ; repli sur MemFree sinon
    let available = field("MemAvailable:")
        .or_else(|| field("MemFree:"))
        .ok_or("Sortie invalide : MemAvailable absent")?;
    Ok((total * 1024, total.saturating_sub(available) * 1024))
}

fn parse_uptime(text: &str) -> Result<u64, String> {
    text.split_whitespace()
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .map(|secs| secs as u64)
        .ok_or_else(|| "Sortie invalide : /proc/uptime illisible".into())
}

fn parse_load(text: &str) -> Result<[f64; 3], String> {
    let values: Vec<f64> = text.split_whitespace().take(3).filter_map(|v| v.parse().ok()).collect();
    match values.as_slice() {
        [a, b, c] => Ok([*a, *b, *c]),
        _ => Err("Sortie invalide : /proc/loadavg illisible".into()),
    }
}

/// Analyse `df -P -k -T`. Les datasets ZFS partagent l'espace libre de leur pool :
/// on les regroupe par pool (utilisé = somme, total = utilisé + libre du pool).
/// Les autres FS sont dédupliqués par périphérique (montages bind).
fn parse_df(text: &str) -> Vec<DiskUsage> {
    struct Entry {
        name: String,
        mount: String,
        fs_type: String,
        used_kb: u64,
        avail_kb: u64,
        size_kb: u64,
        has_root: bool,
    }
    let mut groups: Vec<Entry> = Vec::new();

    for line in text.lines().skip_while(|l| !l.starts_with("Filesystem")).skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        // Filesystem Type Taille Utilisé Dispo Capacité Point-de-montage (qui peut contenir des espaces)
        if cols.len() < 7 || !REAL_FS.contains(&cols[1]) {
            continue;
        }
        let (Ok(size), Ok(used), Ok(avail)) =
            (cols[2].parse::<u64>(), cols[3].parse::<u64>(), cols[4].parse::<u64>())
        else {
            continue;
        };
        let mount = cols[6..].join(" ");
        let is_zfs = cols[1] == "zfs";
        let key = if is_zfs { cols[0].split('/').next().unwrap_or(cols[0]) } else { cols[0] };

        match groups.iter_mut().find(|g| g.name == key) {
            Some(g) => {
                if is_zfs {
                    g.used_kb += used;
                    g.avail_kb = g.avail_kb.max(avail);
                }
                if mount.len() < g.mount.len() {
                    g.mount = mount.clone();
                }
                g.has_root |= mount == "/";
            }
            None => groups.push(Entry {
                name: key.to_string(),
                has_root: mount == "/",
                mount,
                fs_type: cols[1].to_string(),
                used_kb: used,
                avail_kb: avail,
                size_kb: size,
            }),
        }
    }

    let mut disks: Vec<(bool, DiskUsage)> = groups
        .into_iter()
        .map(|g| {
            let total_kb = if g.fs_type == "zfs" { g.used_kb + g.avail_kb } else { g.size_kb };
            (
                g.has_root,
                DiskUsage {
                    name: g.name,
                    mount: g.mount,
                    fs_type: g.fs_type,
                    total_bytes: total_kb * 1024,
                    used_bytes: g.used_kb * 1024,
                },
            )
        })
        .collect();
    // Disque système d'abord, puis du plus grand au plus petit
    disks.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_bytes.cmp(&a.1.total_bytes)));
    disks.into_iter().map(|(_, d)| d).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXT4_OUTPUT: &str = "cpu  1000 0 500 8000 500 0 0 0 0 0
cpu  1300 0 600 8550 550 0 0 0 0 0
--MEM--
MemTotal:       16000000 kB
MemFree:         2000000 kB
MemAvailable:   12000000 kB
Buffers:          100000 kB
--UP--
93784.52 180000.10
--LOAD--
0.52 0.61 0.70 2/345 12345
--DF--
Filesystem           Type     1024-blocks      Used Available Capacity Mounted on
udev                 devtmpfs     8123456         0   8123456       0% /dev
tmpfs                tmpfs        1630000      1500   1628500       1% /run
/dev/mapper/pve-root ext4       100000000  40000000  60000000      40% /
/dev/mapper/pve-root ext4       100000000  40000000  60000000      40% /var/lib/bind
/dev/sdb1            xfs        900000000 100000000 800000000      12% /mnt/data
/dev/sda2            vfat          523248      5000    518248       1% /boot/efi
overlay              overlay    100000000  40000000  60000000      40% /var/lib/docker/overlay2/abc/merged
--TEMP--
coretemp|Package id 0|52000
coretemp|Core 0|49000
coretemp|Core 1|55500
nvme|Composite|41850
acpitz||27800
acpitz||0
dell_smm|Other|126000
";

    const ZFS_OUTPUT: &str = "cpu  100 0 100 800 0 0 0 0 0 0
cpu  100 0 100 900 0 0 0 0 0 0
--MEM--
MemTotal:       32000000 kB
MemAvailable:    8000000 kB
--UP--
60.00 100.00
--LOAD--
1.00 2.00 3.00 1/100 1
--DF--
Filesystem             Type     1024-blocks      Used  Available Capacity Mounted on
boot-pool/ROOT/24.10.2 zfs        200000000   3000000  197000000       2% /
boot-pool/ROOT/24.10.2/var zfs    197100000    100000  197000000       1% /var
tank                   zfs       1000000000       128 1000000000       1% /mnt/tank
tank/media             zfs       1500000000 500000000 1000000000      34% /mnt/tank/media
";

    #[test]
    fn cpu_percent_from_two_stat_samples() {
        let m = parse_metrics(EXT4_OUTPUT).unwrap();
        // delta total = 1000, delta idle+iowait = 600 → 40 % occupé
        assert!((m.cpu_percent - 40.0).abs() < 0.01, "cpu = {}", m.cpu_percent);
    }

    #[test]
    fn cpu_zero_when_fully_idle() {
        let m = parse_metrics(ZFS_OUTPUT).unwrap();
        assert!(m.cpu_percent.abs() < 0.01);
    }

    #[test]
    fn memory_uses_mem_available() {
        let m = parse_metrics(EXT4_OUTPUT).unwrap();
        assert_eq!(m.mem_total_bytes, 16_000_000 * 1024);
        assert_eq!(m.mem_used_bytes, 4_000_000 * 1024);
    }

    #[test]
    fn uptime_and_load() {
        let m = parse_metrics(EXT4_OUTPUT).unwrap();
        assert_eq!(m.uptime_secs, 93784);
        assert_eq!(m.load_avg, [0.52, 0.61, 0.70]);
    }

    #[test]
    fn disks_skip_pseudo_fs_and_dedupe_devices() {
        let m = parse_metrics(EXT4_OUTPUT).unwrap();
        let mounts: Vec<&str> = m.disks.iter().map(|d| d.mount.as_str()).collect();
        assert_eq!(mounts, vec!["/", "/mnt/data"]);
        assert_eq!(m.disks[0].total_bytes, 100_000_000 * 1024);
        assert_eq!(m.disks[0].used_bytes, 40_000_000 * 1024);
    }

    #[test]
    fn zfs_datasets_grouped_by_pool_root_first() {
        let m = parse_metrics(ZFS_OUTPUT).unwrap();
        let names: Vec<&str> = m.disks.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(names, vec!["boot-pool", "tank"]);
        let tank = &m.disks[1];
        assert_eq!(tank.mount, "/mnt/tank");
        assert_eq!(tank.used_bytes, (500_000_000 + 128) * 1024);
        assert_eq!(tank.total_bytes, (500_000_000 + 128 + 1_000_000_000) * 1024);
        assert_eq!(m.disks[0].mount, "/");
    }

    #[test]
    fn temperatures_parsed_and_cpu_temp_from_cpu_chip() {
        let m = parse_metrics(EXT4_OUTPUT).unwrap();
        // Température CPU = la plus chaude des sondes du processeur
        assert_eq!(m.cpu_temp_celsius, Some(55.5));
        let names: Vec<String> = m.temperatures.iter().map(|t| format!("{}/{}", t.chip, t.label)).collect();
        // Sonde à 0 °C ignorée (capteur absent), libellé vide remplacé par le nom de la puce
        assert_eq!(names, vec!["coretemp/Package id 0", "coretemp/Core 0", "coretemp/Core 1", "nvme/Composite", "acpitz/acpitz"]);
        assert_eq!(m.temperatures[3].celsius, 41.85);
    }

    #[test]
    fn no_temperature_section_means_no_sensors() {
        let m = parse_metrics(ZFS_OUTPUT).unwrap();
        assert!(m.temperatures.is_empty());
        assert_eq!(m.cpu_temp_celsius, None);
    }

    #[test]
    fn cpu_temp_absent_without_cpu_chip() {
        assert_eq!(cpu_temperature(&[TempSensor { chip: "nvme".into(), label: "Composite".into(), celsius: 40.0 }]), None);
    }

    #[test]
    fn garbage_output_is_an_error() {
        assert!(parse_metrics("bash: head: command not found").is_err());
    }
}
