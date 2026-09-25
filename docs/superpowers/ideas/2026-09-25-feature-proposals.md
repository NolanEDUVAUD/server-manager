# Propositions de fonctionnalités — 2026-09-25

Produites par un agent d'exploration à partir du code et de l'inventaire du homelab. Rien n'est
engagé : c'est une liste de candidats. Déjà prévus séparément : tâches en lot / Ansible, TrueNAS,
Home Assistant, stats réseau OPNsense / MikroTik.

| # | Fonctionnalité | Comment (API / protocole) | Effort | Valeur |
|---|---|---|---|---|
| 1 | Santé du cluster Proxmox (quorum, HA, SMART des nœuds) | `/cluster/status`, `/cluster/ha/status/current`, `/cluster/resources`, `/nodes/{n}/disks/smart` | S-M | ★★★ |
| 2 | Tâches Proxmox et état des sauvegardes vzdump / PBS | `/cluster/tasks?type=vzdump`, `/cluster/backup`, `/cluster/backup-info/not-backed-up`, `POST /nodes/{n}/vzdump` | M | ★★★ |
| 3 | Zabbix : problèmes actifs et maintenance automatique avant un arrêt | JSON-RPC `problem.get`, `host.get`, `maintenance.create/delete`, `event.acknowledge` | M | ★★★ |
| 4 | Moteur d'alertes et notifications push | Règles sur les métriques existantes → toast Windows + ntfy / Discord / Telegram, branché sur l'historique | M | ★★★ |
| 5 | Nginx Proxy Manager : hôtes publiés, expiration des certificats | API REST non officielle `/api/tokens`, `/api/nginx/proxy-hosts`, `/api/nginx/certificates` | S-M | ★★ |
| 6 | Sondes HTTP / TCP / TLS (façon Uptime Kuma) | reqwest, `TcpStream::connect`, date d'expiration TLS | M | ★★★ |
| 7 | Visionneuse de logs Loki par serveur | `/loki/api/v1/query_range`, `/loki/api/v1/tail` (WebSocket) | M | ★★ |
| 8 | Résumé des scans Greenbone | GMP via `gvm-cli` en SSH sur le CT 101, XML | L | ★★ |
| 9 | Arrêt et démarrage ordonnés du lab complet | vzdump/shutdown des invités → nœuds → TrueNAS → FwNode ; WoL + attente au rallumage ; mode simulation ; attention au quorum | M | ★★★ |
| 10 | Centre de mises à jour (PVE, CT/VM, images Docker) | `/nodes/{n}/apt/update`, `apt list --upgradable`, digest Registry v2 | M | ★★ |
| 11 | Icône de zone de notification + actions rapides | Tauri `tray-icon` | S | ★★ |
| 12 | Découverte réseau et détection de la MAC | Balayage ping + table ARP (`arp -a` / `GetIpNetTable2`), `net0` des VM | S-M | ★★ |
| 13 | Migration de VM/CT et « vider un nœud » | `POST /nodes/{n}/{qemu,lxc}/{id}/migrate`, `/nodes/{n}/migrateall` | M | ★★ |
| 14 | Palette de commandes (Ctrl+K) et commandes SSH mémorisées | Frontend (`cmdk`), envoi au terminal actif | S | ★★ |

## Top 5 recommandé par l'agent
1. **Alertes et notifications (4)** : l'app collecte tout mais ne prévient personne.
2. **Sauvegardes Proxmox (2)** : détecter une sauvegarde ratée avant d'en avoir besoin.
3. **Zabbix (3)** : réutilise l'existant et supprime les fausses alertes lors des arrêts lancés par l'app.
4. **Santé du cluster (1)** : effort faible, information critique (quorum).
5. **Zone de notification (11)** : effort minimal, nécessaire aux alertes et au planificateur en mode app.

Prérequis commun aux items Proxmox : le jeton `root@pam!PVEviewer` n'a aujourd'hui **aucun** droit
sur les invités (0 VM visible). Voir le message affiché sur la page Proxmox.
