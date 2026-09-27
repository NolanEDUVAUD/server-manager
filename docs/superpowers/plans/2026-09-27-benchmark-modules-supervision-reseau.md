# Benchmark et plan d'intégration native — Supervision, serveurs et réseau

> Périmètre : Dashboard, Serveurs & Groupes (inventaire, tags, favoris),
> Arrêt/démarrage (Wake-on-LAN, arrêt, *Lab Power* ordonné), Ressources
> (métriques temps réel), Historique, Alertes, Réseau (scan, graphe,
> topologie). La Console SSH/SFTP a été traitée séparément dans
> `docs/superpowers/plans/2026-09-27-benchmark-integration-native.md`
> (voir en particulier son item **M1**, sur les sondes de service, repris et
> corrigé ici — voir §0.6). Comparaison avec les outils de supervision
> homelab (Uptime Kuma, Netdata, Zabbix, PRTG, Beszel, Gatus,
> Healthchecks.io, Grafana, Checkmk, UptimeRobot), de scan/inventaire réseau
> (Advanced IP Scanner, Angry IP Scanner, Fing, Nmap/Zenmap, NetBox,
> LibreNMS, Lansweeper) et de gestion d'alimentation (outils WoL, NUT/
> apcupsd/PowerChute, Proxmox HA). Toute fonctionnalité de l'app actuelle
> citée ci-dessous a été vérifiée dans le code (branche `Test-Neoofix`,
> v0.5.0), pas supposée — voir §5 pour le détail des fichiers lus.

---

## 0. Inventaire actuel (par module, ce que l'app fait vraiment, avec fichiers)

### 0.1 Dashboard (`src/pages/Dashboard.tsx`)

C'est la page d'accueil : grille de `ServerCard`, favoris triés en premier
(`sortFavoritesFirst`), trois compteurs (total / en ligne / hors ligne),
bouton *Actualiser* qui relance `pingAll`, et les mêmes formulaires
d'ajout/édition/suppression que la page Serveurs. Aucun widget
configurable, aucune réorganisation par glisser-déposer, aucune donnée de
supervision (sondes, alertes récentes, résumé du labo) : c'est un résumé de
l'inventaire, pas un vrai tableau de bord de supervision.

**Remarque de nommage** : il existe aussi une page `Dashboards.tsx`
(pluriel), qui n'a rien à voir avec l'accueil — c'est le conteneur d'onglets
web embarqués (webviews Proxmox/interfaces tierces, `dashboard_state.rs`),
hors du périmètre de ce document (probablement du ressort du module « web »
couvert par l'autre analyse).

### 0.2 Serveurs & Groupes (`src/pages/Servers.tsx`, `src/pages/Groups.tsx`, `src-tauri/src/organisation.rs`, `src-tauri/src/models.rs`)

- **Serveurs** : liste groupée par dossier (`groupByFolder`), recherche et
  filtres (`FilterBar` / `filterItems` / `serverFilterable` — nom, IP, OS,
  notes, tag, **champ personnalisé**), favoris (`FavoriteButton`), tags
  (`TagList`/`TagChip`), champs personnalisés libres non chiffrés
  (`CustomField` dans `organisation.rs`), icônes (bibliothèque Lucide ou
  image importée). Actions par serveur : WoL, arrêt, redémarrage (avec
  confirmation reprenant la commande exacte configurée), déploiement de clé
  SSH (`DeployKeyDialog`), édition/suppression.
- **Authentification** : mot de passe **ou** clé, hôte de rebond
  (`jump_host_id`) à un niveau — déjà noté dans le document Console.
- **Groupes** (`Groups.tsx`) : ensemble de `server_ids`, actions groupées
  (ping, WoL, arrêt), affichage dépliable des serveurs membres avec statut.
  Pas d'imbrication de groupes, pas de dépendances de démarrage entre
  serveurs d'un même groupe.
- **Organisation** (`organisation.rs`) : `Tag`, `Folder`, `CustomField`
  génériques, réutilisés par Serveurs **et** par les sondes (`Probe`, voir
  §0.6) — `OrganisationManager.tsx` gère les deux dans la même interface.
  Import/fusion résiliente (`merge_definitions`, `import_id`) déjà pensée
  pour un import de configuration (utilisée par l'export/import chiffré
  `.spmbackup`), mais **pas de CSV** ni d'aucun format tiers.
- **Pas de** : import CSV d'inventaire, export de la liste des serveurs
  seule (l'export existant est la sauvegarde chiffrée complète de l'app),
  dépendances de démarrage explicites entre serveurs.

### 0.3 Arrêt/démarrage — WoL, arrêt, *Lab Power* (`src/pages/LabPower.tsx`, `src-tauri/src/lab_power.rs`, `src-tauri/src/scheduler.rs`, `src-tauri/src/tray.rs`)

- **Actions unitaires** (page Serveurs/Groupes) : WoL (`wakeServer`/
  `wakeGroup`), arrêt et redémarrage par commande SSH configurable,
  confirmation avant toute action destructrice.
- **Lab Power** (`lab_power.rs`, 299 lignes, très testé) : calcule un plan
  **avant** toute exécution (mode simulation, `lab_power_plan`), avec un
  ordre de rôles déjà assez sophistiqué :
  - à l'arrêt : serveurs hors cluster → VM/CT (sauf pare-feu) → stockage
    (TrueNAS) → nœuds Proxmox → invités pare-feu (OPNsense/pfSense détectés
    par nom) → nœud du pare-feu **en dernier** ;
  - au démarrage : ordre inverse, chaque réveil WoL attend la réponse au
    ping avant l'étape suivante ;
  - détecte qu'un « serveur » de l'app est en fait une VM Proxmox
    (rapprochement de nom normalisé) et le traite comme un invité, pas
    comme une machine à réveiller en SSH ;
  - avertit sur les MAC manquantes (avec mention spéciale si c'est le nœud
    du pare-feu), la perte de quorum, l'absence de pare-feu détecté.
  - Exécution (`lab_power_execute`) protégée par une **phrase de
    confirmation exacte** (vérifiée aussi côté backend), progression en
    direct par étape (`lab-power-progress`), annulable après l'étape en
    cours.
  - **Aucun outil du comparatif ne fait ça** (voir §1.4) : c'est un vrai
    différenciateur, pas un gadget — confirmé en relisant `lab_power.rs`
    en détail pour ce document (pas seulement mentionné en passant comme
    dans le document Console).
- **Planificateur** (`scheduler.rs`, module voisin — UI dans `Scheduler.tsx`,
  hors périmètre de cette analyse mais pertinent ici) : tâches WoL/arrêt/
  redémarrage récurrentes par **jour de semaine + heure locale**, ciblant un
  serveur ou un groupe, mode « App » (tourne tant que l'app est ouverte) ou
  « Cron » (crontab distante par SSH) — **sauf pour le réveil**, qui ne peut
  jamais être un cron distant (`validate` refuse explicitely un WoL en mode
  Cron : « le serveur est éteint à ce moment-là »). **Le WoL programmé
  existe donc déjà**, contrairement à ce qu'on pourrait supposer en ne
  regardant que `LabPower.tsx` — à ne pas re-proposer comme nouveauté.
- **Zone de notification** (`tray.rs`) : réveil rapide d'un groupe depuis le
  menu du tray, sans ouvrir la fenêtre ; pas d'arrêt depuis le tray
  (volontaire : un menu de zone de notification ne permet pas de
  confirmation).
- **Pas de** : intégration onduleur (UPS/NUT) pour déclencher l'arrêt du
  labo sur coupure secteur, dépendances de démarrage *explicites* entre
  serveurs arbitraires (seulement les rôles Proxmox/stockage/pare-feu
  déduits automatiquement).

### 0.4 Ressources (`src/pages/Resources.tsx`, `src-tauri/src/metrics.rs`, `src-tauri/src/monitor.rs`)

- Collecte par **une seule commande SSH** combinée (`METRICS_COMMAND`) :
  deux lectures de `/proc/stat` à 1 s d'intervalle (CPU sans état conservé
  entre passages), mémoire, uptime, `load average`, `df -P -k -T` (disques
  réels seulement — `ext*/xfs/btrfs/zfs/f2fs`, tmpfs/overlay/vfat exclus),
  températures via `/sys/class/hwmon` (reconnaît coretemp/k10temp/
  zenpower/cpu_thermal comme sonde CPU).
- Boucle de fond indépendante de la fenêtre (`monitor.rs`) — **tourne même
  fenêtre masquée**, ce qui est explicitement documenté comme nécessaire
  car une webview masquée dans le tray ralentit les timers JS. Candidats à
  la collecte : en ligne, OS compatible (**exclut Windows et ESXi** — pas
  d'agent, pas de collecte WMI/PowerShell), pas déjà en cours de collecte.
- Historique en mémoire (`metricsHistory` du store) affiché en mini-graphes
  (`ResourceCard`), et persistant en SQLite pour les statistiques
  d'événements (voir Historique). Intervalle configurable (Paramètres →
  Réseau).
- **Pas de** : métriques réseau (débit d'interface), état SMART des
  disques, agent Windows (donc aucune métrique pour les machines Windows du
  labo), export CSV des séries de métriques.

### 0.5 Historique (`src/pages/History.tsx`, `db.rs`, `events.rs` référencés)

- Journal d'événements typés (`EventKind` : Offline/Online/Wake/Shutdown/
  Reboot/VmAction/Container/Alert/Failure), groupés par jour, filtrables
  par serveur et par type, purge manuelle.
- Statistiques 30 jours par serveur : nombre de coupures, durée hors ligne
  cumulée (`get_event_stats`), et **disponibilité en pourcentage** calculée
  sur l'historique de ping réel (`get_server_uptime` — table dédiée aux
  pings, pas seulement aux événements), affichée avec un arrondi à 99,95 %
  plutôt que 100 % pour ne pas masquer une coupure courte (`formatPercent`,
  testé).
- **Pas de** : export du journal ou des statistiques (CSV/PDF), rapport de
  disponibilité imprimable/partageable façon SLA, rétention configurable
  au-delà de la fenêtre de 30 jours déjà câblée dans l'UI (le backend
  semble stocker plus, seule la vue par défaut est bornée à 30 j — à
  vérifier avant de coder un export).

### 0.6 Alertes (`src/pages/Alerts.tsx`, `src-tauri/src/alerts.rs`, `src-tauri/src/probes.rs`)

**Moteur de règles** (`alerts.rs`, 476 lignes, très testé) : conditions
`Offline`, `CpuAbove`, `RamAbove`, `DiskAbove`, `TempAbove`,
`ActionFailed`, `ProbeDown`, ciblage `All`/`Server`/`Group`, **hystérésis
réelle** (`step()` : ne déclenche qu'après `sustain_ms` de condition
continue, une seule fois par incident, purge d'état à la désactivation
d'une règle pour éviter un « Résolu » fantôme — bug explicitement corrigé
et testé), cooldown anti-spam, interrupteur global, notification bureau +
push (ntfy/Discord/Telegram via `integrations.rs`), historique des
alertes, bouton de test des canaux.

**Sondes de service** (`probes.rs`, 615 lignes, très testé) —
**découverte majeure de cette analyse** : le document Console listait déjà
un item **M1 « Monitoring HTTP/TCP/DNS (extension des sondes) »** avec la
mention *« à confirmer contre `probes.rs`/`probes_cmd.rs` existants »*.
Cette confirmation a été faite ici en lisant le fichier en entier : le
moteur est **beaucoup plus avancé** que ce que supposait l'estimation
initiale (M, 3-4 jours) :

- **HTTP(S)** avec code attendu, mot-clé dans le corps, **et lecture d'un
  chemin JSON** (`json_path` façon `data.nodes.0.state`) avec valeur
  attendue optionnelle — plus riche que le mot-clé simple d'Uptime Kuma ;
- **Authentification** Basic / Bearer / en-tête personnalisé, secret
  chiffré (AES-256-GCM) et marqué `sensitive` pour ne jamais apparaître
  dans les logs, redirections HTTP refusées (un en-tête d'auth ne doit pas
  fuiter vers un autre hôte) ;
- **TCP** (connexion simple, latence) ;
- **Expiration de certificat TLS** (`TlsExpiry`) avec seuil d'alerte en
  jours, y compris sur un certificat auto-signé/expiré (le but est de lire
  la date, pas de valider la chaîne) ;
- **Disponibilité 24 h** calculée depuis l'historique SQLite
  (`probe_uptime`), restauration des derniers résultats connus au
  démarrage ;
- **Verrouillage géré proprement** : une sonde avec secret est suspendue
  tant que l'app est verrouillée (pas de fausse alerte « secret illisible »
  à chaque tour), les sondes sans secret continuent ;
- Intégré au moteur d'alertes (`AlertEngine::on_probe`, condition
  `ProbeDown`) et à l'organisation (tags/dossiers/favoris, comme les
  serveurs).

**Mais — bug/lacune produit le plus significatif trouvé dans ce périmètre**
: **il n'existe aucune page pour créer, modifier ou consulter une sonde**.
Les commandes Tauri `get_probes`, `save_probe`, `delete_probe`,
`run_probe_now` sont bien enregistrées dans `lib.rs` et le type `Probe` est
exporté, mais dans tout `src/`, la seule référence côté frontend est un
appel `invoke<Probe[]>("get_probes")` dans `OrganisationManager.tsx` — et
seulement pour permettre d'assigner un tag/dossier/favori à une sonde déjà
existante (créée comment ? il n'y a pas de formulaire). Autrement dit : un
moteur de supervision quasi complet, testé, sécurisé, comparable à la
partie « HTTP/TCP/TLS » d'Uptime Kuma, existe et tourne côté Rust, mais
**personne ne peut s'en servir depuis l'interface**. C'est la priorité la
plus rentable de tout ce document (voir A1, §2 et §3).

### 0.7 Réseau (`src/pages/Network.tsx`, `src/components/NetworkGraph.tsx`, `src-tauri/src/discovery.rs`)

- **Scan** (`network_scan`) : table ARP Windows + balayage ping d'un /24
  (`subnet_hosts`), avec en plus (tout dans `discovery.rs`, 601 lignes,
  très testé) :
  - **détection de cartes virtuelles** par OUI (Proxmox `BC:24:11`, QEMU/
    KVM, VMware, Hyper-V, Docker, VirtualBox) — un WoL n'a pas de sens sur
    ces adresses, l'app le sait ;
  - **fabricant deviné par OUI** (~46 préfixes : TP-Link, Netgear,
    Ubiquiti, MikroTik, Synology, QNAP, Raspberry Pi, Apple, Amazon,
    Google, Espressif, Xiaomi…) — table volontairement réduite, assumée
    non exhaustive ;
  - **type d'appareil deviné** (routeur/switch/point d'accès/NAS/
    imprimante/TV/téléphone/IoT/serveur) à partir du fabricant et/ou d'un
    nom d'hôte, heuristique par mots-clés multilingues (FR/EN) ;
  - **suggestion automatique de MAC** pour un serveur déjà configuré sans
    MAC, si le scan en trouve une (bandeau « Compléter les MAC »).
- **Vue graphe** (`NetworkGraph.tsx`, 565 lignes) façon Obsidian :
  disposition par simulation de forces (`utils/forceLayout.ts`), zoom/pan,
  glisser un nœud, nœuds virtuels ajoutables à la main (switch/point
  d'accès non détectables automatiquement, ex. un switch non manageable),
  **rattachement d'un nœud à un parent personnalisable** (persistant, store
  dédié `useNetworkTopologyStore`), panneau de détails (IP/MAC/fabricant/
  type/latence/dernière vue/chemin jusqu'à la passerelle).
  Enrichissement **best-effort**, jamais bloquant si indisponible :
  - table de routage (`route print`/`ip route`, parsée indépendamment de la
    langue de l'OS) → passerelle par défaut, **détection de sous-réseaux
    additionnels** (VPN WireGuard/Tailscale : route on-link sur une
    interface différente de la route par défaut) ;
  - informations Wi-Fi de l'hôte (`netsh wlan`/`nmcli`) : SSID, BSSID,
    signal, canal, bande devinée ;
  - **traceroute léger** vers Internet, pour afficher le nombre de sauts.
- **Pas de** : rafraîchissement périodique automatique du scan (bouton
  manuel uniquement — donc pas de détection d'un nouvel appareil sans
  action de l'utilisateur), scan de ports, vue d'occupation d'un
  sous-réseau (IPAM), export de l'inventaire réseau, SNMP/LLDP/CDP (cohérent
  avec le choix de rester « sans agent, sans droits admin »).

---

## 1. Benchmark des solutions existantes

### Modèles de prix

> Prix relevés en ligne le 27/09/2026 (collecte automatisée par un autre
> agent, recoupée ici) : indicatifs, à revérifier avant toute communication
> publique. Les tableaux ci-dessous reprennent, en les triant par module,
> les produits déjà documentés dans `bench2/supervision-alertes.md` et
> `bench2/reseau-alimentation.md`, avec quelques entrées écartées quand
> jugées peu fiables (voir notes).

| Produit | Modèle | Prix indicatif |
|---|---|---|
| Uptime Kuma | Open source (MIT) | Gratuit (auto-hébergé, coût VPS ~5-20 USD/mois) |
| Netdata | Freemium | Community gratuite ≤5 nœuds, Homelab 90 USD/an illimité, Business 4,50 USD/nœud/mois |
| Zabbix | Open source (GPL) + support | Cœur gratuit ; support 50-750 USD/mois |
| PRTG Network Monitor | Freemium | Free 100 capteurs ; 179 à 1492 USD/mois selon palier |
| Beszel | Open source (MIT) | Gratuit |
| Gatus | Open source + SaaS | Auto-hébergé gratuit ; SaaS 10-500 USD/mois |
| Healthchecks.io | Freemium + open source (BSD) | Free 20 checks ; 17-20 USD/mois pour 100 checks ; auto-hébergeable |
| Grafana | Open source + Cloud | OSS gratuit ; Cloud Pro à l'usage + 19 USD/mois ; Enterprise 25000+ USD/an |
| Checkmk | Open source (GPL) + Enterprise | Raw gratuit ; Enterprise 2100 €/an ; Cloud 300 USD/mois |
| UptimeRobot | Freemium (SaaS) | Free 50 moniteurs ; 13-98 USD/mois selon palier |
| Advanced IP Scanner | Gratuit (Windows) | Gratuit |
| Angry IP Scanner | Open source (GPL v2) | Gratuit |
| Fing | Freemium | Free ; 4,99-16,99 €/mois selon palier |
| Nmap / Zenmap | Open source (GPL v2) | Gratuit |
| NetBox | Open source (Apache 2.0) | Gratuit (auto-hébergé) |
| LibreNMS | Open source (GPL) | Gratuit (auto-hébergé) |
| Lansweeper | Freemium | Free 100 assets ; 219-399 €/mois |
| WoL (Depicus / NirSoft WakeMeOnLan) | Gratuit | Gratuit |
| NUT / apcupsd | Open source | Gratuit |
| PowerChute Network Shutdown (APC) | Commercial | Tarif non communiqué (licence APC) |
| Proxmox HA | Inclus dans Proxmox VE (gratuit) | Gratuit |
| **Server Power Manager** | Application native locale | — (hors périmètre) |

> Note : les tableaux comparatifs ci-dessous ne reprennent que les colonnes
> pertinentes par module, pour rester lisibles — un produit generalist comme
> PRTG ou Zabbix apparaît donc dans plusieurs sous-sections.

### 1.1 Réseau — scan, inventaire réseau, topologie

| Fonctionnalité | Advanced IP Scanner | Angry IP Scanner | Fing | Nmap/Zenmap | NetBox | LibreNMS | Lansweeper | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|---|
| Découverte ARP/ping d'un sous-réseau | ✅ | ✅ | ✅ | ✅ | ➖ (manuel/API) | ✅ (SNMP) | ✅ (agentless) | ✅ |
| Fabricant deviné (OUI) | ✅ | ➖ (via NetBIOS) | ✅ | ❌ | ➖ | ✅ (via SNMP) | ✅ | ✅ **table dédiée ~46 préfixes** |
| Type d'appareil deviné automatiquement | ❌ | ❌ | ✅ | ➖ (OS fingerprint) | ❌ (déclaratif) | ➖ | ✅ | ✅ **heuristique FR/EN** |
| Détection VM/conteneur (OUI virtualisation) | ❌ | ❌ | ➖ | ❌ | ❌ | ❌ | ➖ | ✅ **Proxmox/KVM/VMware/Hyper-V/Docker/VirtualBox** |
| Graphique de topologie | ❌ | ❌ | ➖ (Agent) | ❌ | ✅ (déclaratif) | ✅ (SNMP/LLDP/CDP auto) | 💰 (palier Pro) | ✅ **auto, disposition par simulation de forces, sans agent ni SNMP** |
| Rattachement manuel d'un appareil à un parent | ❌ | ❌ | ❌ | ❌ | ✅ | ➖ | ❌ | ✅ **persistant par nœud** |
| Détection de sous-réseaux VPN additionnels | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **absent chez tous les concurrents étudiés** |
| Info Wi-Fi de l'hôte (SSID/signal/canal) | ❌ | ❌ | ➖ (scan réseaux voisins) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Traceroute intégré | ❌ | ❌ | ❌ | ➖ (script NSE) | ❌ | ❌ | ❌ | ✅ **léger, jusqu'à Internet** |
| SNMP/LLDP/CDP (matériel manageable) | ❌ | ❌ | ❌ | ➖ (script NSE) | ➖ (déclaratif) | ✅ **natif** | ❌ | ❌ (assumé : pas d'agent, pas de droits admin réseau) |
| Scan de ports | ❌ | ✅ | ❌ | ✅ **avancé** | ❌ | ❌ | ❌ | ❌ |
| Nouvel appareil détecté → alerte | ❌ | ❌ | 💰 (Premium) | ❌ | ❌ | ➖ | ❌ | ❌ |
| Export de l'inventaire réseau | ❌ | ✅ (CSV/TXT/XML) | ➖ | ✅ (XML/HTML) | ✅ (API) | ✅ | ✅ | ❌ |
| Rafraîchissement automatique périodique | ❌ | ➖ | ✅ (Agent 24/7) | ❌ | — | ✅ | ✅ | ❌ **bouton manuel uniquement** |

### 1.2 Alimentation — Wake-on-LAN, arrêt, ordonnancement, UPS

| Fonctionnalité | WoL (Depicus/NirSoft) | Advanced IP Scanner | NUT / apcupsd | PowerChute | Proxmox HA | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|
| Wake-on-LAN individuel | ✅ | ✅ | — | — | ❌ | ✅ |
| Wake-on-LAN groupé | ➖ (liste) | ❌ | — | — | ❌ | ✅ (par groupe + tray) |
| Arrêt distant simple | ❌ | ✅ (RDP/Radmin) | — | — | ➖ | ✅ (SSH, commande configurable) |
| **Ordre d'arrêt/démarrage multi-rôles (stockage, cluster, pare-feu, invités)** | ❌ | ❌ | ➖ (scripts `upsmon`) | ➖ | ✅ (HA Groups, cluster Proxmox) | ✅ **calculé automatiquement + avertissements, simulation avant exécution** |
| Détection automatique du rôle pare-feu/routeur | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **par nom (OPNsense/pfSense…)** |
| Confirmation forte avant arrêt massif | ❌ | ❌ | ❌ | ❌ | ➖ | ✅ **phrase exacte vérifiée aussi côté serveur** |
| Planification récurrente (jour/heure) | ❌ (Tâches planifiées Windows externes) | ❌ | ➖ (scripts) | ✅ | ❌ | ✅ **jour de semaine + heure, App ou Cron (sauf réveil)** |
| Intégration onduleur (UPS) déclenchant l'arrêt | ❌ | ❌ | ✅ **natif** | ✅ **natif (APC)** | ➖ (scripts) | ❌ |
| Réveil programmé au-delà d'un simple minuteur | ❌ | ❌ | — | — | ❌ | ✅ (via Planificateur, hors WoL en mode cron distant) |

### 1.3 Serveurs & Groupes — inventaire, tags, reconnaissance

| Fonctionnalité | Fing | NetBox | LibreNMS | Lansweeper | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| Inventaire structuré (dossiers, tags, favoris) | ➖ (cloud) | ✅✅ (complet, IPAM) | ➖ (groupes SNMP) | ✅✅ | ✅ (dossiers + tags + favoris + champs personnalisés) |
| Champs personnalisés | ➖ | ✅ | ➖ | ✅ | ✅ |
| Groupes d'action (WoL/arrêt groupé) | ❌ | ❌ | ❌ | ➖ (scripts) | ✅ |
| Import CSV / format tiers | ➖ | ➖ (API) | ➖ | ✅ | ❌ |
| Export de l'inventaire | ➖ | ✅ (API) | ✅ | ✅ | ❌ (seulement dans la sauvegarde chiffrée complète) |
| Reconnaissance automatique de type d'appareil | ✅ | ❌ (déclaratif) | ➖ (SNMP) | ✅✅ (multi-protocole) | ✅ (heuristique OUI/nom, sans agent) |
| Dépendances de démarrage explicites entre serveurs | ❌ | ❌ | ❌ | ❌ | ➖ (déduites par rôle Proxmox seulement, pas configurables librement) |

### 1.4 Ressources & Historique — métriques et disponibilité

| Fonctionnalité | Netdata | Beszel | Grafana | Zabbix | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| CPU/RAM/disque en temps réel | ✅ (agent push, 1 s) | ✅ (agent push) | ➖ (source externe) | ✅ | ✅ (SSH, intervalle configurable) |
| Température CPU | ✅ | ✅ | ➖ | ✅ | ✅ |
| Débit réseau (interfaces) | ✅ | ✅ | ➖ | ✅ | ❌ |
| État SMART des disques | ➖ | ❌ | ➖ | ➖ (plugin) | ❌ |
| Historique de métriques persistant | ✅ (tiered downsampling) | ✅ (basique) | ✅ (source externe) | ✅ | ✅ (SQLite) |
| Sans agent à installer sur les cibles | ❌ (agent requis) | ❌ (agent requis) | ❌ | ➖ (agentless possible) | ✅ **SSH seul, aucun agent** |
| Fonctionne sur Windows | ✅ (agent Windows) | ✅ (agent Windows) | — | ✅ (agent Windows) | ❌ **exclu par conception (`monitor.rs`)** |
| Statistiques de disponibilité (%) | ➖ | ❌ | ➖ | ✅ (SLA) | ✅ (calcul réel sur historique de ping, arrondi non trompeur) |
| Export de l'historique/rapport | ➖ | ❌ | ✅ (dashboards) | ✅ (rapports SLA) | ❌ |

### 1.5 Alertes & supervision de services

| Fonctionnalité | Uptime Kuma | Zabbix | PRTG | Gatus | Healthchecks.io | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|
| Sonde HTTP (code + mot-clé) | ✅ | ✅ | ✅ | ✅ | ➖ (push seulement) | ✅ |
| Sonde HTTP avec assertion sur un champ JSON | ❌ | ➖ (item preprocessing) | ➖ | ✅ (JSONPath) | ❌ | ✅ **`json_path`/`json_expect`** |
| Authentification de sonde (Basic/Bearer/en-tête) | ➖ | ✅ | ✅ | ➖ | — | ✅ **secret chiffré, en-tête marqué sensible** |
| Sonde TCP | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Sonde DNS | ✅ | ✅ | ➖ | ✅ | ❌ | ❌ |
| Expiration de certificat TLS | ✅ | ➖ (item externe) | ➖ | ✅ | ❌ | ✅ **avec seuil en jours configurable** |
| Monitoring *push* (heartbeat / dead man's switch) | ✅ | ➖ | ❌ | ❌ | ✅✅ (spécialiste) | ❌ |
| Hystérésis (délai avant déclenchement) | ➖ | ✅ | ✅ | ➖ | ➖ (fenêtre/grâce) | ✅ **testée explicitement, avec purge d'état à la modification d'une règle** |
| Cooldown anti-spam | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ |
| Dépendances (un parent en panne masque ses enfants) | ❌ | ✅ **best du comparatif** | ❌ | ❌ | ❌ | ❌ |
| Fenêtres de maintenance | ✅ | ✅ | 💰 (add-on) | ❌ | 💰 | ❌ |
| Escalade / répétition d'alerte non résolue | ❌ | ✅ | ✅ | ❌ | 💰 | ❌ |
| Canaux (bureau, ntfy, Discord, Telegram…) | ✅✅ (90+) | ✅ | ✅ | ✅ (12 protocoles) | ✅ (25+) | ✅ (Windows, ntfy, Discord, Telegram) |
| Page de statut publique | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Interface de gestion des sondes** | ✅ | ✅ | ✅ | ✅ (fichier config) | ✅ | ❌ **moteur backend complet, aucune page (voir §0.6)** |

---

## 2. Analyse de faisabilité native

Barème identique au document Console : **valeur utilisateur** 1-5, **effort**
S (< 1 jour) / M (2-5 jours) / L (1-3 semaines) / XL (> 3 semaines).

### 2.1 Alertes / supervision de services

| Fonctionnalité | Valeur | Effort | Solution technique (stack SPM) | Risques | Verdict |
|---|---|---|---|---|---|
| **A1 — Page « Services » (gestion des sondes)** | 5 | M | Le backend est **entièrement prêt** (`get_probes`, `save_probe`, `delete_probe`, `run_probe_now`, type `ProbeView` qui masque déjà le secret). Il « suffit » d'un formulaire React (choix du type Http/Tcp/TlsExpiry, champs conditionnels comme `RuleForm` dans `Alerts.tsx`) et d'une liste avec statut/latence/disponibilité 24 h, en reprenant le pattern de `Alerts.tsx` (déjà dans la base de code) | Aucun nouveau risque : la validation (`validate()`), le chiffrement du secret et le masquage frontend existent déjà et sont testés | ✅ Intégrer (Phase 1) — le plus gros gain valeur/effort de tout ce document |
| **A2 — Sonde DNS** | 3 | S/M | Nouveau variant `ProbeKind::Dns { host, record_type, expect }` ; résolution via `tokio::net::lookup_host` (déjà une dépendance async) ou `trust-dns-resolver` si un type d'enregistrement précis (TXT/MX) est demandé au-delà du A/AAAA basique | Aucun (sortant, lecture seule) | ✅ Intégrer (Phase 2) |
| **A3 — Monitoring *push* (heartbeat)** | 2 | M | Nécessiterait un petit serveur HTTP local recevant les pings (`axum`/`warp` embarqué sur un port local) — **change la posture « rien n'écoute »** de l'app (cf. §2.2 du document Console sur la page de statut publique, refusée pour la même raison) | Ouvrir un port local change le modèle de sécurité ; usage homelab marginal (l'app n'a pas de scripts hors d'elle à surveiller par push) | ❌ Hors périmètre — sauf demande explicite justifiant l'écart au modèle « appli cliente uniquement » |
| **A4 — Dépendances d'alerte (parent en panne masque les enfants)** | 4 | M | L'app a déjà la donnée : `jump_host_id` (hôte de rebond) et le rattachement de topologie réseau (`parentId` dans `useNetworkTopologyStore`). Ajouter un champ `depends_on: Option<String>` sur `AlertRule` ou raisonner directement sur `jump_host_id` du serveur ciblé : si le parent est `Offline`, ne pas dispatcher les règles des enfants (mais garder l'état enregistré pour un « Résolu » cohérent au retour) — s'inspire de la fonction pure `should_dispatch` déjà présente, à étendre avec un nouveau filtre | Un mauvais calcul de dépendance masquerait une vraie panne indépendante ; bien tester avec `clear_rule`/purge d'état comme le fait déjà `alerts.rs` pour éviter un « Résolu » fantôme | ✅ Intégrer (Phase 2) |
| **A5 — Fenêtres de maintenance** | 4 | M | Nouvelle structure `MaintenanceWindow { target, start, end, recurring? }` stockée dans `AppData` ; `should_dispatch` (déjà le point de passage obligé documenté pour toutes les raisons de ne pas notifier) gagne un nouveau filtre « fenêtre de maintenance active » — cohérent avec l'architecture existante qui centralise déjà ces raisons | Une fenêtre mal configurée masquerait une vraie panne ; toujours l'indiquer visuellement (bandeau) tant qu'une fenêtre est active | ✅ Intégrer (Phase 2) |
| **A6 — Escalade / répétition d'alerte non résolue** | 3 | M | Réutilise `RuleState` (déjà `bad_since`/`firing`/`last_fired`) : ajouter une répétition toutes les N minutes tant que `firing == true`, avec une seconde valeur `repeat_minutes` par règle (`#[serde(default)]`) | Sans plafond, un incident long spammerait — prévoir un nombre maximal de rappels ou un doublement du délai (façon backoff) | 🟡 Plus tard (Phase 3) — valeur réelle mais moins urgent que A1/A4/A5 |
| **A7 — Seuils par serveur (surcharge d'une règle globale)** | 4 | M | `AlertRule` cible déjà `All`/`Server`/`Group`, mais avec **un seul jeu de valeurs** de condition. Permettre une surcharge par serveur reviendrait à dupliquer explicitement une règle « All » vers un `Server` avec un seuil différent — déjà possible aujourd'hui via l'UI actuelle (créer une deuxième règle ciblée), donc plutôt un **problème de découvrabilité UX** qu'un vrai manque technique | Aucun changement de modèle nécessaire | 🟡 Plus tard (Phase 3, si le besoin de créer plusieurs règles pour un même serveur type continue d'embêter les utilisateurs) — pointer d'abord vers un raccourci UX « Dupliquer cette règle pour un seul serveur » (S, quasi gratuit) avant d'envisager un vrai modèle de surcharge |

### 2.2 Réseau

| Fonctionnalité | Valeur | Effort | Solution technique (stack SPM) | Risques | Verdict |
|---|---|---|---|---|---|
| **N1 — Scan périodique automatique** | 4 | M | Boucle de fond similaire à `monitor.rs` (ping/métriques), à intervalle configurable (Paramètres → Réseau), appelant la même logique que `network_scan` ; stocker le dernier scan pour permettre un diff (base de N2) | Un scan large et fréquent charge le réseau local ; intervalle minimum raisonnable (ex. 15 min) et désactivé par défaut | ✅ Intégrer (Phase 2) — prérequis de N2 |
| **N2 — Alerte « nouvel appareil détecté »** | 4 | M | Nouvelle condition `Condition::NewDevice` dans `alerts.rs`, déclenchée par le scan périodique (N1) qui compare la liste de MAC/IP au dernier scan connu et notifie via le moteur d'alertes déjà en place (mêmes canaux ntfy/Discord/Telegram/bureau) | Faux positifs sur un réseau très dynamique (DHCP à bail court, invités Wi-Fi) : présenter une option pour ignorer les cartes déjà vues par IP/vendor generic (téléphones) | ✅ Intégrer (Phase 2, après N1) |
| **N3 — Vue d'occupation de sous-réseau (mini-IPAM)** | 2 | M | Réutilise `subnet_hosts` et les résultats de scan pour afficher une grille d'occupation (libre/occupé/réservé) — pas un vrai IPAM (pas d'allocation, pas de VLAN), juste une vue de lecture | Donnée non fiable à 100 % (DHCP dynamique) : bien la présenter comme un instantané, pas une source de vérité | 🟡 Plus tard (Phase 3) — valeur modeste pour un homelab de taille réduite |
| **N4 — Scan de ports (opt-in, sur un appareil du graphe)** | 2 | L | `tokio::net::TcpStream::connect` sur une liste réduite de ports courants (22/80/443/3389/8006…), déclenché **manuellement** depuis le panneau de détails d'un nœud, jamais automatique | Un scan de ports, même limité, se rapproche d'un outil de reconnaissance réseau : à cantonner clairement au réseau local de l'utilisateur (déjà le cas, l'app ne route rien), avec un avertissement explicite avant le premier usage | 🟡 Plus tard (Phase 3) — utile mais sensible, décision produit à confirmer avant de coder |
| **N5 — Export de l'inventaire réseau (CSV)** | 3 | S | Sérialisation simple de `Vec<NetworkDevice>` en CSV côté frontend (ou une commande Rust `export_network_csv`) — aucune dépendance nouvelle | Aucun | ✅ Intégrer (Phase 1) |
| **N6 — SNMP/LLDP/CDP (topologie matérielle réelle)** | 2 | XL | Nécessiterait une bibliothèque SNMP complète (`snmp` crate ou équivalent), la gestion de communautés/creds par appareil, et surtout des équipements homelab qui l'exposent (rare chez les box/switches non manageables d'un particulier) — gros effort pour un public cible étroit | Complexité d'implémentation et de test disproportionnée face à l'usage réel visé (homelab, pas datacenter) | ❌ Hors périmètre — la détection heuristique actuelle (OUI + nom) couvre l'essentiel sans droits admin ni matériel manageable |

### 2.3 Alimentation (WoL, arrêt, *Lab Power*, UPS)

| Fonctionnalité | Valeur | Effort | Solution technique (stack SPM) | Risques | Verdict |
|---|---|---|---|---|---|
| **P1 — Intégration onduleur (UPS/NUT) déclenchant l'arrêt du labo** | 4 | L | Client `NUT` (protocole texte simple sur TCP, port 3493 par défaut — pas besoin d'une bibliothèque lourde, un client minimal suffit) interrogeant un serveur `upsd` déjà présent sur le réseau (NUT ou un onduleur APC exposant ce protocole) ; sur `ups.status` contenant `OB` (on battery) au-delà d'un délai configurable, déclenche automatiquement `lab_power_execute` en mode arrêt — **réutilise tel quel le plan déjà calculé et testé** de `lab_power.rs`, sans dupliquer sa logique d'ordre | Un arrêt automatique du labo est une action à haut risque si mal déclenché (faux positif de l'onduleur, ou coupure brève) : temporisation obligatoire (ex. 2 minutes sur batterie avant de lancer), confirmation désactivable seulement de façon explicite (pas de confirmation interactive possible puisque l'app doit agir seule), journalisation complète dans l'historique | ✅ Intégrer (Phase 2) — différenciateur fort, aucun concurrent étudié ne combine UPS + ordonnancement de rôles Proxmox/pare-feu |
| **P2 — Dépendances de démarrage personnalisées (au-delà des rôles Proxmox)** | 3 | L | `lab_power.rs` déduit déjà les rôles (nœud, stockage, pare-feu, invité) automatiquement ; ajouter des dépendances *arbitraires* (« Machine A avant Machine B ») demanderait un petit graphe de dépendances (tri topologique) fusionné avec les étapes déjà calculées — techniquement faisable mais le calcul de rôles actuel couvre déjà le cas réel du labo (cf. tests `lab_power.rs` sur le labo réel de l'utilisateur) | Une dépendance mal configurée (cycle) doit être détectée et rejetée à la validation, pas seulement au calcul du plan | 🟡 Plus tard (Phase 3) — à ne construire que si un labo hors-Proxmox avec dépendances non déductibles automatiquement se présente |
| **P3 — Notification avant un arrêt programmé (Planificateur)** | 3 | S | Le Planificateur (`scheduler.rs`, module voisin) exécute déjà des arrêts récurrents ; ajouter une notification bureau **N minutes avant** l'exécution (ex. « Arrêt programmé de Backup-Box dans 10 min ») donne une chance d'annuler manuellement — petit ajout dans la boucle déjà existante | Aucun | ✅ Intégrer (Phase 1) — petit effort, réduit le risque d'un arrêt programmé surprise pendant un usage actif |
| **P4 — Wake-on-LAN programmé en mode Cron distant** | 2 | XL | Explicitement bloqué aujourd'hui (`validate` refuse un WoL en Cron : « le serveur est éteint à ce moment-là ») et c'est **correct** : un cron distant ne peut pas tourner sur une machine éteinte. Le contourner demanderait un tiers toujours allumé (box/routeur) qui envoie le paquet magique à la place de l'app — hors du modèle actuel (app cliente uniquement, rien de tiers à déployer) | Aucune solution propre sans dépendance externe | ❌ Hors périmètre — le comportement actuel (WoL uniquement en mode App, donc l'app doit tourner) est le bon compromis, pas un bug |

### 2.4 Serveurs & Groupes, Dashboard, Ressources/Historique

| Fonctionnalité | Valeur | Effort | Solution technique (stack SPM) | Risques | Verdict |
|---|---|---|---|---|---|
| **S1 — Export CSV de l'inventaire des serveurs** | 3 | S | Commande Rust `export_servers_csv` (ou génération côté frontend depuis le store déjà chargé) — colonnes nom/IP/OS/tags/dossier/notes, **jamais** les identifiants SSH | Ne jamais inclure secrets/mots de passe dans l'export, même chiffrés (un CSV n'est pas un format de secret) | ✅ Intégrer (Phase 1) |
| **S2 — Import CSV avec correspondance de colonnes** | 3 | M | Réutilise `organisation.rs::merge_definitions`/`import_id` déjà pensés pour un import résilient (identifiants non fiables, doublons de noms) ; ajouter un écran de correspondance de colonnes (nom → colonne CSV) avant la validation, comme le fait tout import CSV usuel | Un CSV mal formé ne doit jamais écraser silencieusement l'inventaire existant : aperçu avant import, jamais d'écrasement automatique | ✅ Intégrer (Phase 2) |
| **S3 — Suggestion d'icône/tag depuis le type d'appareil détecté** | 2 | S | Quand un serveur est ajouté depuis la page Réseau (`onAddServer`), le device kind deviné par `discovery.rs` est déjà connu (`d.device_kind` côté frontend) — préremplir l'icône suggérée dans `ServerForm` plutôt que l'icône par défaut | Aucun (suggestion, jamais imposée) | ✅ Intégrer (Phase 1) — petit effort, cohérence avec un travail de détection déjà fait |
| **D1 — Widgets de tableau de bord (résumé sondes/alertes/labo)** | 4 | M | Étendre `Dashboard.tsx` avec 2-3 cartes supplémentaires : dernières alertes (déjà utilisées dans `Alerts.tsx`, réutilisable telle quelle), résumé des sondes (dépend de **A1**, sans quoi il n'y a rien à résumer), lien rapide vers *Lab Power*. Pas de nouvelle commande Rust : uniquement de la composition de données déjà exposées | Ne pas dupliquer un module entier sur l'accueil — rester des résumés avec lien « voir plus » | ✅ Intégrer (Phase 1, la partie sondes après A1) |
| **D2 — Réorganisation des cartes par glisser-déposer** | 2 | M | `@dnd-kit` (déjà listé comme bibliothèque autorisée dans les guides d'artefacts, à vérifier si déjà une dépendance du projet) ou une implémentation HTML5 drag-and-drop simple ; ordre persisté côté frontend (préférence par utilisateur, pas une donnée partagée) | Aucun | 🟡 Plus tard (Phase 3) — confort, pas un manque fonctionnel |
| **R1 — Export CSV du rapport de disponibilité (30 j)** | 3 | S | `get_event_stats`/`get_server_uptime` retournent déjà les données agrégées ; sérialisation CSV côté frontend, bouton à côté de *Effacer l'historique* dans `History.tsx` | Aucun | ✅ Intégrer (Phase 1) |
| **R2 — Débit réseau par interface** | 3 | L | Étendre `METRICS_COMMAND` avec une lecture de `/proc/net/dev` à deux instants (même principe que le CPU : deux lectures espacées d'1 s pour calculer un débit), nouveau champ `network: Vec<NetInterface>` sur `ServerMetrics` avec `#[serde(default)]` | Aucun risque particulier, léger surcoût de la commande SSH déjà exécutée périodiquement | 🟡 Plus tard (Phase 3) — utile mais pas la lacune la plus visible du module Ressources |
| **R3 — État SMART des disques** | 3 | L | Nécessite `smartctl` installé côté cible (pas garanti sur toutes les distributions, souvent nécessite les droits root/sudo pour lire les attributs SMART complets) — plus fragile que les lectures `/proc` et `/sys` actuelles qui ne demandent aucun privilège particulier | Une commande `sudo smartctl` échouerait silencieusement sur une cible sans configuration sudo NOPASSWD dédiée : documenter clairement le prérequis, dégrader proprement (case masquée) si absent | 🟡 Plus tard (Phase 3) — valeur réelle pour un NAS/stockage mais dépendance externe à gérer avec soin |

---

## 3. Plan d'action d'intégration native

### 3.1 Feuille de route

Préfixes : **D** (Dashboard), **S** (Serveurs/Groupes), **P** (Alimentation),
**R** (Ressources/Historique), **A** (Alertes), **N** (Réseau).

#### Phase 1 — Gains rapides, forte valeur

**A1 — Page « Services » (sondes de supervision)**
- Objectif : rendre utilisable le moteur de sondes déjà écrit et testé côté
  Rust (`probes.rs`), aujourd'hui invisible pour l'utilisateur.
- Spécification technique :
  - Nouvelle page `src/pages/Services.tsx` (ou `Probes.tsx`), ajoutée à
    `src/utils/modules.ts` (`defineModule("services", false)`, désactivable
    comme les autres modules non essentiels).
  - Liste des sondes : nom, type, statut (dernier résultat, coloré comme
    `StatusBadge`), disponibilité 24 h, latence, bouton *Tester maintenant*
    (`run_probe_now`).
  - Formulaire de sonde (`ProbeForm`, sur le modèle de `RuleForm` dans
    `Alerts.tsx`) : type (Http/Tcp/TlsExpiry) avec champs conditionnels,
    authentification (None/Basic/Bearer/Header) avec champ secret masqué
    (jamais préaffiché, comme `ssh_password` dans `ServerForm`), association
    optionnelle à un serveur (`server_id`), intervalle, tags/dossier/favori
    (réutilise `OrganisationManager`, déjà câblé pour les sondes).
  - Frontend : `invoke("save_probe", { probe, secret })`,
    `invoke("delete_probe", { id })`, écoute de l'événement `probe-result`
    déjà émis par `execute()` dans `probes.rs` pour mettre à jour la liste
    en direct sans repoll.
- Dépendances : aucune commande Rust nouvelle, tout existe déjà
  (`get_probes`, `save_probe`, `delete_probe`, `run_probe_now`).
- Critères d'acceptation : créer une sonde HTTP sur une URL de test locale
  affiche son statut en direct ; une sonde avec authentification ne
  réaffiche jamais le secret en clair après enregistrement (seulement un
  indicateur « secret défini ») ; supprimer une sonde arrête son suivi
  (`ProbeState::forget`, déjà existant) et retire ses entrées d'historique
  de l'UI.
- Tests : test de composant sur le formulaire (validation, champs
  conditionnels par type), test d'intégration légère avec `invoke` mocké
  pour la liste et le rafraîchissement sur `probe-result`.
- Estimation : M (3-4 jours, essentiellement du frontend).

**D1 — Widgets de tableau de bord (partie sondes après A1, partie alertes indépendante)**
- Objectif : faire du Dashboard un vrai résumé de supervision, pas
  seulement un résumé d'inventaire.
- Spécification : deux nouvelles cartes sous les trois compteurs
  existants — « Dernières alertes » (réutilise `events.filter(e => e.kind
  === "Alert").slice(0, 5)`, déjà le pattern de `Alerts.tsx`) et « Services »
  (compte de sondes en échec / disponibilité moyenne, nécessite A1) ; lien
  « Lab Power » si des serveurs hors ligne sont détectés parmi les
  favoris.
- Dépendances : A1 pour la carte Services (peut sortir sans, en Phase 1
  toujours, si A1 prend plus de temps que prévu — livrer la carte alertes
  seule).
- Critères d'acceptation : les cartes n'affichent rien (pas de card vide)
  si le module correspondant (`alerts`/`services`) est masqué dans les
  paramètres, cohérent avec le filtrage déjà fait pour `hidden_modules`
  ailleurs dans l'app (cf. `should_dispatch` dans `alerts.rs`).
- Estimation : S/M (2 jours, hors A1).

**N5 — Export CSV de l'inventaire réseau**
- Objectif : exploiter les résultats d'un scan hors de l'app (tableur,
  script).
- Spécification : bouton *Exporter* à côté de *Scanner* dans `Network.tsx`,
  génération CSV côté frontend (IP, MAC, fabricant, type, carte virtuelle,
  serveur connu).
- Estimation : S (0,5-1 jour).

**S1 — Export CSV de l'inventaire des serveurs**
- Objectif : partager/sauvegarder la liste des serveurs sans les secrets.
- Spécification : bouton dans `Servers.tsx`, colonnes nom/IP/OS/ssh_user/
  ssh_port/tags/dossier/notes/favori — jamais `ssh_password`/`ssh_key_id`.
- Critères d'acceptation : le fichier généré ne contient aucun secret même
  sous forme chiffrée (vérifié par un test qui échoue si une colonne
  sensible apparaît).
- Estimation : S (0,5-1 jour).

**S3 — Suggestion d'icône/tag depuis le type d'appareil détecté**
- Objectif : capitaliser sur la détection déjà faite par `discovery.rs`
  lors de l'ajout d'un serveur depuis la page Réseau.
- Spécification : dans `Network.tsx`, la prop `prefill` de `ServerForm`
  gagne un champ `suggestedIcon` dérivé de `d.device_kind` (ex. NAS →
  icône disque, routeur → icône réseau) — mapping simple, statique.
- Estimation : S (0,5 jour).

**R1 — Export CSV du rapport de disponibilité**
- Objectif : partager les statistiques de disponibilité 30 jours (ex. pour
  justifier un incident auprès d'un tiers hébergé chez soi).
- Spécification : bouton dans `History.tsx`, à côté d'*Effacer
  l'historique* ; colonnes serveur/coupures/durée hors ligne/disponibilité
  %, sur la fenêtre actuellement affichée (30 jours).
- Estimation : S (1 jour).

**P3 — Notification avant un arrêt programmé**
- Objectif : éviter la surprise d'un arrêt programmé pendant un usage
  actif de la machine.
- Spécification : dans la boucle du Planificateur (`scheduler.rs`),
  déclencher une notification bureau (`tauri_plugin_notification`, déjà
  utilisé partout dans l'app) N minutes avant l'exécution d'une tâche
  `Shutdown`/`Reboot` (pas `Wake`, qui n'a pas besoin d'avertissement) ;
  délai configurable dans le formulaire de planification existant.
- Estimation : S (1-2 jours).

#### Phase 2 — Fonctionnalités structurantes

**A4 — Dépendances d'alerte (parent en panne masque les enfants)**
- Objectif : ne pas recevoir 10 alertes « hors ligne » quand seul l'hôte de
  rebond ou le nœud Proxmox commun est en panne.
- Spécification technique :
  - Utiliser la donnée déjà présente : `jump_host_id` (rebond SSH) et, pour
    les VM/CT, le nœud Proxmox hébergeur (déjà connu de `lab_power.rs` via
    `pve_node`).
  - Dans `AlertEngine::on_ping`/`on_metrics`, avant `step_rule`, vérifier si
    le parent déduit du serveur est actuellement `Offline` selon l'état de
    ping partagé ; si oui, ne pas dispatcher (mais continuer à faire
    évoluer l'état interne de la règle pour éviter un déclenchement en
    rafale au retour du parent).
  - Un bandeau dans `Alerts.tsx` indique combien d'alertes sont actuellement
    « masquées par dépendance », pour ne jamais donner une fausse
    impression de silence total.
- Critères d'acceptation : un nœud Proxmox hors ligne ne génère qu'**une**
  alerte (le nœud lui-même), pas une par VM hébergée ; au retour du nœud,
  les VM réellement encore en panne redéclenchent normalement.
- Tests : reproduire le scénario du labo réel (`lab_power.rs` a déjà les
  données de topologie de test à réutiliser) avec panne du nœud puis retour
  partiel.
- Estimation : M (3-4 jours).

**A5 — Fenêtres de maintenance**
- Objectif : couper les alertes pendant une intervention prévue (mise à
  jour, redémarrage planifié) sans désactiver la règle globalement.
- Spécification : nouvelle collection `maintenance_windows` dans
  `AppData` (`target`, `starts_at`, `ends_at`, `#[serde(default)]` sur
  toute nouvelle lecture) ; extension de `should_dispatch` avec un
  paramètre optionnel « fenêtres actives » ; UI simple dans `Alerts.tsx`
  (« Mettre en maintenance… » avec sélecteur de durée rapide : 30 min, 1 h,
  4 h, jusqu'à une heure précise).
- Critères d'acceptation : pendant une fenêtre active, aucune alerte ciblant
  le serveur/groupe concerné n'est dispatchée (bureau, push, historique) ;
  un bandeau visible dans Alertes et sur le Dashboard indique la
  maintenance en cours ; la fenêtre expire automatiquement.
- Estimation : M (3 jours).

**N1 + N2 — Scan périodique automatique et alerte nouvel appareil**
- Objectif : être notifié quand un appareil inconnu rejoint le réseau,
  sans avoir à cliquer sur *Scanner*.
- Spécification technique :
  - `N1` : boucle de fond optionnelle (Paramètres → Réseau, désactivée par
    défaut), intervalle minimum 15 minutes, réutilise `network_scan`.
  - `N2` : nouvelle variante `Condition::NewDevice { known_only: bool }` ;
    à chaque scan périodique, comparer aux MAC déjà vues (nouvelle table
    SQLite `seen_devices` ou simple liste dans `AppData`) et dispatcher via
    `AlertEngine` comme toute autre condition.
- Critères d'acceptation : brancher un nouvel appareil (MAC jamais vue)
  déclenche une notification dans les N minutes de l'intervalle configuré ;
  un appareil déjà vu ne redéclenche jamais.
- Tests : test Rust sur la fonction de diff (ensemble de MAC avant/après).
- Estimation : M (4-5 jours pour les deux ensemble).

**P1 — Intégration onduleur (UPS/NUT)**
- Objectif : déclencher l'arrêt ordonné du labo sur coupure secteur
  prolongée, sans intervention humaine.
- Spécification technique :
  - Nouveau module `ups.rs` : client minimal du protocole NUT (texte,
    `LIST UPS`, `GET VAR <ups> ups.status`, `GET VAR <ups> battery.charge`)
    sur le serveur `upsd` déjà présent sur le réseau (pas de nouveau
    matériel requis si un onduleur NUT/APC existe déjà dans le labo,
    cohérent avec `bench2/reseau-alimentation.md` qui identifie NUT comme
    la solution UPS de référence gratuite).
  - Paramètres → Alimentation : hôte/port du serveur NUT, nom de
    l'onduleur, délai de temporisation avant déclenchement (par défaut
    2 minutes sur batterie), case à cocher explicite « Arrêt automatique du
    labo sur coupure secteur » (désactivée par défaut).
  - Sur déclenchement : appelle directement `lab_power_execute` en
    réutilisant le plan déjà calculable par `shutdown_plan` — **aucune
    nouvelle logique d'ordonnancement**, juste un nouveau déclencheur
    automatique de celle qui existe.
  - Historique : un événement dédié (`EventKind::Alert` ou un nouveau
    `EventKind::UpsEvent`) trace la détection de coupure et le
    déclenchement.
- Critères d'acceptation : simuler une coupure (via un serveur NUT de test)
  déclenche l'arrêt après le délai configuré, jamais avant ; désactivé par
  défaut, aucun changement de comportement sans activation explicite.
- Tests : client NUT testé contre un serveur NUT de test (comme
  `ssh_test_server` pour SSH) ou au minimum contre les réponses textuelles
  attendues du protocole (parsing pur, testable sans vrai serveur).
- Estimation : L (1-2 semaines).

**S2 — Import CSV d'inventaire**
- Objectif : importer un parc de serveurs existant (export d'un autre
  outil, tableau Excel).
- Spécification : écran en deux temps — sélection du fichier + aperçu des
  colonnes détectées, puis correspondance manuelle (nom, IP, OS, tags…) ;
  réutilise `merge_definitions`/`import_id` d'`organisation.rs` pour les
  tags/dossiers référencés par nom dans le CSV.
- Critères d'acceptation : un CSV incomplet ou mal formé n'importe rien
  silencieusement — erreurs listées ligne par ligne avant validation finale ;
  aucun écrasement d'un serveur existant sans confirmation explicite.
- Estimation : M (3-4 jours).

**A2 — Sonde DNS**
- Objectif : compléter les types de sonde avec la résolution DNS, seul
  protocole standard encore absent face au comparatif (§1.5).
- Spécification : `ProbeKind::Dns { host: String, expect_ip: Option<String> }`,
  résolution via `tokio::net::lookup_host` (déjà disponible, aucune
  dépendance supplémentaire pour un simple A/AAAA) ; comparaison optionnelle
  à une IP attendue.
- Dépendances : A1 (l'UI de sondes doit exister pour configurer ce
  nouveau type).
- Estimation : S/M (2 jours).

#### Phase 3 — Plus tard / décision produit

**N4 — Scan de ports opt-in** (L). Utile pour enrichir le panneau de
détails d'un appareil du graphe, mais assez proche d'un outil de
reconnaissance pour mériter une décision produit explicite avant codage.

**N3 — Vue d'occupation de sous-réseau (mini-IPAM)** (M). Valeur limitée
pour la taille typique d'un homelab ; à revisiter pour des sous-réseaux
plus grands.

**P2 — Dépendances de démarrage personnalisées** (L). Le calcul de rôles
actuel (Proxmox, stockage, pare-feu) couvre déjà le labo réel testé dans
`lab_power.rs` ; à construire seulement face à un labo hors-Proxmox avec
dépendances non déductibles automatiquement.

**A6 — Escalade / répétition d'alerte non résolue** (M). Reporté après
A4/A5, qui répondent à des frustrations plus immédiates (bruit en
cascade, silence pendant une intervention prévue).

**R2 — Débit réseau par interface** et **R3 — État SMART des disques**
(L chacun). Utiles pour un usage NAS/stockage poussé, mais R3 dépend d'un
utilitaire externe (`smartctl`, souvent `sudo`) qui fragiliserait la
collecte SSH actuelle, aujourd'hui sans privilège requis.

**D2 — Réorganisation du Dashboard par glisser-déposer** (M). Confort
plutôt que manque fonctionnel ; à ne prioriser que si D1 montre un besoin
réel une fois les nouvelles cartes en place.

---

### 3.2 Directives d'expérience utilisateur

**Dashboard**
- Les nouvelles cartes de supervision (D1) s'ajoutent **sous** les trois
  compteurs existants (total/en ligne/hors ligne), jamais à leur place :
  ces trois chiffres restent le premier repère visuel, cohérent avec
  l'usage actuel (« combien de mes serveurs tournent là, maintenant »).
- Une carte de résumé (alertes, services) reste cliquable dans son
  ensemble vers la page complète correspondante — pas de mini-actions
  directement sur le Dashboard (pas de bouton *Résoudre* une alerte depuis
  l'accueil), pour ne pas dupliquer les contrôles d'`Alerts.tsx`/`Services.tsx`.

**Services (nouvelle page, A1)**
- Reprend la disposition d'`Alerts.tsx` (liste + interrupteur d'activation
  par ligne + bouton modifier/supprimer) pour que l'utilisateur retrouve un
  pattern déjà connu, plutôt qu'une nouvelle grammaire visuelle.
- Le champ secret suit exactement les règles déjà appliquées à
  `ssh_password`/probes existantes : jamais préaffiché en clair, un
  indicateur « secret défini » à la place, un champ vide à la modification
  signifie « ne pas changer ».
- Le statut d'une sonde utilise les mêmes couleurs que `StatusBadge`
  (vert/rouge/gris) pour rester cohérent avec le reste de l'app plutôt que
  d'introduire une nouvelle palette de statuts.

**Alertes — dépendances et maintenance (A4, A5)**
- Une alerte masquée par dépendance (A4) n'est **jamais silencieuse sans
  trace** : un compteur visible (« 3 alertes masquées — nœud Proxmox hors
  ligne ») évite de croire à tort que tout va bien.
- Une fenêtre de maintenance active (A5) s'affiche en bandeau **sur la
  page Alertes et sur le Dashboard**, avec la cible et le temps restant —
  jamais seulement dans un journal qu'il faut aller consulter.
- Ni l'un ni l'autre ne modifie l'historique : l'événement réel (serveur
  hors ligne) continue d'être journalisé dans Historique, seule la
  *notification* est retenue — la donnée n'est jamais perdue, seul le bruit
  l'est.

**Réseau — nouvel appareil (N1/N2)**
- Le scan périodique reste **désactivé par défaut** (contrairement au ping/
  aux métriques qui tournent déjà en fond) : un scan réseau régulier est
  plus intrusif qu'un ping ciblé sur les serveurs déjà connus de
  l'utilisateur, et le homelab n'a pas forcément besoin de cette
  surveillance élargie par défaut.
- Une alerte « nouvel appareil » propose un accès direct au bouton *Ajouter
  comme serveur* déjà existant dans `Network.tsx`, pour transformer la
  notification en action utile en un clic plutôt qu'en simple information.

**Alimentation — UPS (P1)**
- La case « Arrêt automatique du labo sur coupure secteur » est
  **désactivée par défaut**, dans son propre encart avec un avertissement
  explicite (« l'app doit rester ouverte pour surveiller l'onduleur et
  déclencher l'arrêt »), cohérent avec le ton déjà utilisé pour la phrase
  de confirmation de *Lab Power*.
- Le délai de temporisation (par défaut 2 minutes) est visible et
  modifiable directement à côté de la case, pas caché dans un sous-menu.

**Cohérence générale**
- Toute nouvelle donnée optionnelle sur un modèle existant (`AlertRule`,
  `Server`, `AppData`) porte `#[serde(default)]`, comme le fait déjà tout
  le modèle actuel (`tag_ids`, `jump_host_id`, `auth_method`…) — aucune
  migration manuelle, aucun risque de casser le chargement d'une
  configuration existante.
- Les nouveaux exports (CSV serveurs/réseau/historique) suivent le même
  encodage et séparateur (`,`, UTF-8 avec BOM pour l'ouverture directe dans
  Excel sous Windows, cohérent avec le public cible de l'app).

---

## 4. Risques et points de vigilance

- **A1 (page Services) est prioritaire mais pas anodine côté sécurité** :
  c'est la première page qui expose la saisie d'un secret générique
  (jeton, mot de passe d'API) hors du flux SSH déjà audité — bien
  réutiliser le chiffrement et le masquage existants plutôt que d'écrire un
  nouveau chemin de stockage de secret.
- **A4 (dépendances d'alerte)** : un mauvais calcul de parent masquerait
  une panne réellement indépendante (ex. une VM en panne pour une raison
  propre, alors que son nœud hôte répond normalement) — bien distinguer
  « le parent ne répond pas » de « le parent répond mais l'invité a un
  souci différent », sans quoi la fonctionnalité ferait plus de mal que de
  bien.
- **P1 (UPS)** est l'ajout au risque le plus élevé de tout ce document :
  une action automatique et irréversible (arrêt du labo) déclenchée sans
  confirmation humaine. La temporisation et la case désactivée par défaut
  sont un filet minimal ; envisager aussi un **second facteur** de
  décision (ex. ne déclencher que si le ping vers la passerelle échoue
  *aussi*, pour distinguer une vraie coupure secteur d'un onduleur
  défectueux qui rapporte un faux `OB`) avant de le proposer comme
  fonctionnalité stable, pas seulement en bêta.
- **N1/N2 (scan périodique + alerte nouvel appareil)** : un réseau
  domestique avec des baux DHCP courts (téléphones visiteurs, IoT) peut
  générer un bruit d'alertes « nouvel appareil » sans intérêt réel — prévoir
  un réglage de sensibilité (ignorer les types `phone`/`iot` détectés par
  `guess_device_kind`) avant l'activation par défaut, si elle est un jour
  envisagée.
- **S2 (import CSV)** : source de données non fiable par nature (comme déjà
  documenté pour l'import de configuration dans `organisation.rs` — « les
  données importées ne sont jamais dignes de confiance »), donc toujours
  revalider strictement (longueur des identifiants, doublons, injection de
  caractères de contrôle) avant fusion, exactement comme le fait déjà le
  code existant pour l'import de sauvegarde.
- **Compatibilité ascendante** : comme pour le document Console, chaque
  nouveau champ de modèle (`maintenance_windows`, `depends_on`, nouveau
  `ProbeKind`, `NetInterface`…) porte `#[serde(default)]`.
- **Portée volontairement exclue** : monitoring *push*/heartbeat (romprait
  le modèle « rien n'écoute » de l'app, cf. §2.1), SNMP/LLDP/CDP (effort
  disproportionné face au public homelab sans matériel manageable), page
  de statut publique (même raison que dans le document Console) — à
  revisiter seulement si un besoin explicite et répété apparaît.

---

## 5. Sources

**Outils de supervision, uptime & alertes** (détail complet dans
`bench2/supervision-alertes.md`, produit par un autre agent le 27/09/2026)
- https://github.com/louislam/uptime-kuma · https://uptime.kuma.pet/
- https://www.netdata.cloud/pricing/ · https://www.netdata.cloud/homelab/
- https://www.zabbix.com/
- https://www.paessler.com/prtg
- https://www.pistack.xyz/posts/2026-05-02-beszel-lightweight-self-hosted-server-monitoring-guide/
- https://gatus.io/ (self-hosted status page & health checks)
- https://healthchecks.io/
- https://grafana.com/
- https://checkmk.com/
- https://uptimerobot.com/

**Outils de scan/inventaire réseau et d'alimentation** (détail complet dans
`bench2/reseau-alimentation.md`, produit par un autre agent le 27/09/2026)
- https://www.advanced-ip-scanner.com/
- https://angryip.org/ · https://github.com/angryip/ipscan
- https://www.fing.com/ · https://help.fing.com/hc/en-us/articles/14408571757852
- https://nmap.org/ · https://nmap.org/zenmap/ · https://nmap.org/nsedoc/
- https://docs.netbox.dev/ · https://github.com/netbox-community/netbox
- https://docs.librenms.org/Extensions/Auto-Discovery/
- https://www.lansweeper.com/product/features/
- https://www.depicus.com/wake-on-lan/ · https://www.nirsoft.net/utils/wake_on_lan.html
- https://networkupstools.org/docs/ (NUT)
- https://pve.proxmox.com/wiki/High_Availability

**Code source de l'application (référence interne, pas une URL externe)**
- `src/pages/Dashboard.tsx`, `src/pages/Dashboards.tsx` (module distinct,
  hors périmètre), `src/pages/Servers.tsx`, `src/pages/Groups.tsx`,
  `src/pages/LabPower.tsx`, `src/pages/Resources.tsx`,
  `src/pages/History.tsx`, `src/pages/Alerts.tsx`, `src/pages/Network.tsx`
- `src/components/NetworkGraph.tsx`, `src/utils/network.ts`,
  `src/utils/forceLayout.ts`, `src/stores/useNetworkTopologyStore.ts`,
  `src/utils/modules.ts`
- `src-tauri/src/alerts.rs`, `src-tauri/src/probes.rs`,
  `src-tauri/src/commands/probes.rs`, `src-tauri/src/monitor.rs`,
  `src-tauri/src/metrics.rs`, `src-tauri/src/discovery.rs`,
  `src-tauri/src/lab_power.rs`, `src-tauri/src/scheduler.rs`,
  `src-tauri/src/tray.rs`, `src-tauri/src/dashboard_state.rs`,
  `src-tauri/src/organisation.rs`, `src-tauri/src/models.rs`,
  `src-tauri/src/lib.rs` (liste des commandes enregistrées)
- `docs/superpowers/plans/2026-09-27-benchmark-integration-native.md`
  (document Console, référencé pour le format et pour l'item M1 corrigé
  ici en §0.6)
