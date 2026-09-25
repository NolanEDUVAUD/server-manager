# Historique des événements — Design

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
Journal central de ce qui arrive au homelab : serveur perdu ou retrouvé au ping, Wake-on-LAN envoyé,
arrêt ou redémarrage demandé (réussi ou non), action sur une VM Proxmox. Plus, par serveur, le nombre de
coupures et le temps hors ligne sur 30 jours. Ce journal sert aussi de socle aux notifications futures
(Home Assistant).

## Backend
- `events.rs`
  - `Event { id, ts (ms), kind, server_id?, target, message }`, avec
    `kind ∈ {Offline, Online, Wake, Shutdown, Reboot, VmAction, Failure}`.
  - `EventStore` pur (testable) : `push` (plafonné à 5 000 événements, les plus anciens sont supprimés),
    `observe(server_id, online) -> Option<kind>`. La première observation d'un serveur ne produit aucun
    événement : on ne sait pas ce qui s'est passé avant le lancement de l'app.
  - `downtime_stats(events, now, window)` : par serveur, nombre de coupures et durée hors ligne dans la
    fenêtre. Un serveur toujours hors ligne compte jusqu'à `now`.
  - `EventLog` : `EventStore` sous Mutex, persisté dans `events.json` (à côté de `data.json`, pour ne pas
    alourdir la config). Chaque enregistrement émet l'événement Tauri `event-recorded`.
- Instrumentation : `ping_*` (transitions), `wake_on_lan` / `wake_group`, `ssh_shutdown` / `ssh_reboot` /
  `ssh_shutdown_group`, `proxmox_vm_action`.
- Commandes : `get_events()` (du plus récent au plus ancien), `get_event_stats(days)`, `clear_events()`.

## Frontend
- Store : `events` (chargés au démarrage), plus un écouteur `event-recorded` qui ajoute en tête de liste.
- Page « Historique » : une carte de synthèse par serveur (coupures et temps hors ligne sur 30 j,
  dernier événement), puis la liste filtrable par serveur et par type, et un bouton « Effacer » avec
  confirmation.

## Tests
- Rust : transitions, plafond, calcul des coupures (coupure en cours, coupure qui déborde de la fenêtre).
- Vitest : ajout d'un événement reçu en direct dans le store.
