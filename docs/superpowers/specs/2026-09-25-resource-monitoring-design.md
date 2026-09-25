# Monitoring des ressources — Design

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
Page « Ressources » intégrée à l'app : CPU, RAM, disques, uptime et charge de **tous** les serveurs
(pas seulement Proxmox), en temps réel, avec un mini-historique de 30 min. Aucun agent à installer :
collecte via le SSH déjà configuré pour l'arrêt à distance. L'utilisateur veut un outil tout-en-un.

## Hors périmètre
Historique persistant sur disque, alertes, Windows/ESXi (réponse « non supporté »).

## Backend (Rust)
- `src/metrics.rs` : modèle `ServerMetrics` / `DiskUsage` + parseur **pur** `parse_metrics(&str)`.
- Une seule commande SSH par collecte (`METRICS_COMMAND`) :
  `head -1 /proc/stat; sleep 1; head -1 /proc/stat`, puis sections séparées par des marqueurs
  (`/proc/meminfo`, `/proc/uptime`, `/proc/loadavg`, `df -P -k -T`), terminée par `true` pour que
  les erreurs partielles de `df` n'invalident pas la collecte.
- CPU % = delta (total − idle − iowait) / delta total entre les deux lectures de `/proc/stat`.
- RAM utilisée = `MemTotal − MemAvailable`.
- Disques : seuls les FS réels (ext2/3/4, xfs, btrfs, zfs, f2fs). Les datasets ZFS sont regroupés
  par pool (utilisé = Σ utilisé, total = utilisé + disponible du pool). Les autres FS sont
  dédupliqués par périphérique. Le disque contenant `/` passe en premier, puis tri par taille.
- `commands/metrics.rs` : `get_server_metrics(server_id)`, timeout = min(ssh_timeout, 10 s).
  Réutilise `execute_ssh` (rendu `pub(crate)`).
- Paramètres réseau : `metrics_enabled` (défaut `true`) et `metrics_interval_secs` (défaut 15),
  avec `#[serde(default)]` pour rester compatible avec les fichiers existants.

## Frontend
- Store : `metrics`, `metricsErrors` et `metricsHistory` (120 points par serveur, en mémoire),
  plus l'action `fetchMetrics(id)`. Un helper pur `appendSample` borne l'historique.
- Hook `useMetrics` monté dans `AppContent` : à chaque intervalle, collecte en parallèle les
  serveurs en ligne et compatibles, sans chevauchement pour un même serveur.
- Page `/resources` (« Ressources » dans la barre latérale) : grille de `ResourceCard` avec des
  jauges CPU/RAM/disques, l'uptime, le load average, et des sparklines CPU et RAM (`Sparkline`,
  en SVG maison, sans dépendance). Un état hors ligne, en erreur ou non supporté s'affiche dans
  la carte concernée.
- Paramètres : activation et intervalle de la collecte.

## Tests
- Rust : parseur (CPU, RAM, uptime, load, df ext4 et ZFS façon TrueNAS, dédup, pseudo-FS ignorés,
  sortie invalide).
- Vitest : `appendSample` (ajout et limite), rendu de `Sparkline`.
- Vérification réelle : lancement de l'app sur les serveurs du homelab.
