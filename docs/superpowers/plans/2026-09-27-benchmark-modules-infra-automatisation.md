# Benchmark et plan d'intégration native — Infrastructure, automatisation, données et sécurité

> Périmètre : Docker, Proxmox, Sauvegardes, Tâches en lot, Planificateur, Mises
> à jour, Logs (Loki), Bases de données, Onglets web, Intégrations,
> Sécurité/verrouillage/clés SSH, Extensions, Paramètres (sauvegarde de
> configuration `.spmbackup`, thèmes). La Console SSH/SFTP est traitée dans
> `docs/superpowers/plans/2026-09-27-benchmark-integration-native.md` (M2,
> éditeur Docker Compose) : ce document l'étend sans la dupliquer. Dashboard,
> Serveurs, Alimentation, Ressources, Historique, Alertes et Réseau sont
> couverts par un document séparé.
>
> Toute fonctionnalité de l'app actuelle citée ci-dessous a été vérifiée dans
> le code (branche `Test-Neoofix`, v0.5.0 beta), pas supposée. Prix et
> éditions des concurrents relevés en ligne le 27/09/2026 par une collecte
> automatisée (deux analystes, sources dans les fichiers `bench2/*.md`) :
> indicatifs, à revérifier avant toute communication publique.

## 0. Inventaire actuel (par module, avec fichiers)

### Docker (`src/pages/Docker.tsx`, `src-tauri/src/docker.rs`, `src-tauri/src/commands/docker.rs`)
- Une commande SSH combinée (`docker ps -a` + `docker stats --no-stream`) par
  hôte, reparsée côté Rust (`parse_list`) ; détection de l'absence de Docker
  (`__NO_DOCKER__`), dépréciation des ports `0.0.0.0`/`[::]` dédupliqués.
- Actions : `start` / `stop` / `restart` uniquement (`docker_action`),
  validation stricte de l'identifiant de conteneur contre l'injection shell
  (`validate_container_ref`).
- Logs : `docker logs --tail <n> --timestamps`, bouton *Rafraîchir* manuel —
  **pas de suivi en direct** (`-f`), pas de recherche dans les logs.
- **Pas d'exec/attach**, pas de pause/unpause, pas d'éditeur Compose, pas de
  détection de mise à jour d'image, pas d'historique de stats (CPU/RAM
  instantanés uniquement, rafraîchis toutes les 15 s côté frontend).
- Sélection du serveur affiché parmi tous les serveurs supportant les
  métriques (`supportsMetrics`), un badge « running/total » par hôte.

### Proxmox (`src/pages/Proxmox.tsx`, `src-tauri/src/proxmox/{client,health,migration,backups,models}.rs`, `src-tauri/src/commands/proxmox.rs`)
- Connexions API multiples (token API, TLS vérifiable ou non), secrets
  chiffrés comme les mots de passe SSH.
- VM/CT : liste agrégée tous nœuds, actions `start/stop/shutdown/reboot/
  suspend`, snapshots (liste/créer/rollback), clonage, migration à chaud
  (plan puis exécution), suivi de tâche asynchrone (`task_status`, UPID).
- Santé de cluster (`cluster_health`) et rapport de sauvegarde (jobs vzdump,
  couverture des invités, tâches récentes) — cf. module Sauvegardes.
- **Pas de console (noVNC/SPICE)**, pas de gestion du pare-feu, pas de
  statut Proxmox Backup Server dédié (seulement les jobs vzdump côté PVE),
  pas de gestion des templates/ISO, pas de vue HA/Corosync.

### Sauvegardes — VM/CT (`src/pages/Backups.tsx`, `src-tauri/src/proxmox/backups.rs`)
- Lit les jobs vzdump planifiés côté Proxmox (`schedule_text` humanisé),
  la couverture par invité (dernière archive, taille, âge), les tâches
  récentes, et déclenche une sauvegarde immédiate vers un stockage choisi.
- **Lecture seule côté planification** (les jobs se créent dans Proxmox, pas
  dans l'app), pas de restauration, pas de vérification d'intégrité
  (`verify`), pas d'intégration Proxmox Backup Server (dédup/chiffrement
  côté PBS), pas de rétention configurable depuis l'app.
- *(Le fichier `.spmbackup` — sauvegarde chiffrée de la configuration de
  l'app elle-même — est un module distinct : voir Paramètres ci-dessous.)*

### Tâches en lot (`src/pages/Batch.tsx`, `src-tauri/src/batch.rs`, `src-tauri/src/smart_batch.rs`, `src-tauri/src/commands/batch.rs`)
- Script multi-ligne (bash, protégé par quotage — `wrap_script`) envoyé à
  plusieurs serveurs, mode parallèle ou séquentiel avec arrêt en cas
  d'erreur ; entrées clavier interactives possibles pendant l'exécution
  (`BatchInputs`, réponse aux invites `dpkg`, etc.).
- **Lot intelligent** (Smart Batch, `smart_batch.rs`) : détection d'OS par
  cible (`/etc/os-release`, `uname -s`, `sw_vers`, PowerShell côté Windows),
  résolution en actions portables (`SmartAction` : `UpdatePackages`,
  `UpgradeSystem`, `InstallPackage`, `RestartService`, `CleanPackageCache`,
  `RebootIfRequired`) déclinées par famille de gestionnaire de paquets (apt,
  dnf/yum, zypper, pacman, apk, brew, winget/choco) — **différenciateur
  fort, aucun concurrent étudié n'a cette portabilité multi-OS d'un même
  bouton**.
- Ansible : lancement de playbook depuis un hôte porteur (`ansible-playbook`),
  `--check --diff` (dry-run) activé par défaut dans l'UI, `--limit`, liste
  des playbooks disponibles (exclut `roles/`, `group_vars/`, `host_vars/`).
- Bibliothèque de tâches enregistrées (`BatchTask`), compatible ascendante
  (`#[serde(default)]` sur `smart_action`).
- **Pas d'historique persistant des exécutions** (rien en base, seulement le
  flux d'événements `Update` de la session en cours), pas de relance
  ciblée des seuls échecs, pas de dry-run générique hors Ansible, pas
  d'approbation/validation avant exécution sur des cibles sensibles.

### Planificateur (`src/pages/Scheduler.tsx`, `src-tauri/src/scheduler.rs`, `src-tauri/src/commands/schedules.rs`, `src-tauri/src/cron.rs`)
- Tâches Wake-on-LAN / Extinction / Redémarrage, ciblant un serveur ou un
  groupe, par jours de la semaine + heure locale.
- Deux modes : **App** (tant que l'app tourne, fenêtre de rattrapage de
  2 minutes pour ne pas manquer un créneau ni déclencher une extinction
  surprise après une longue veille) et **Cron** (la ligne crontab est
  synchronisée sur le serveur cible lui-même — `plan_cron_ops`/
  `apply_cron_ops` — donc survit à l'app fermée) ; le Wake ne peut pas être
  en Cron (le serveur est éteint) et le Cron est refusé sur
  Windows/ESXi (incompatible).
- Consultation directe des crontabs existants d'un serveur
  (`cron_list`, utilisateur + `/etc/crontab` + `/etc/cron.d`).
- **Pas de vue calendrier**, pas d'historique des exécutions passées
  (seulement `last_run`, un horodatage), pas de fenêtres de maintenance
  généralisées à d'autres actions que Wake/Shutdown/Reboot, pas de tâches
  arbitraires planifiées (scripts/lots) — uniquement les trois actions
  d'alimentation.

### Mises à jour (`src/pages/Updates.tsx`, `src-tauri/src/updates.rs`)
- Scan **lecture seule** par serveur : paquets `apt` en attente (avec
  distinction sécurité/non-sécurité par suite), redémarrage requis
  (`/var/run/reboot-required`), âge du cache `apt` (fiabilité du « à jour »),
  noyau courant, et **conteneurs Docker dont l'image locale a été mise à
  jour sans recréation du conteneur** (comparaison de l'identifiant d'image
  référencé vs. celui du tag courant — logique proche de Diun/WUD mais sans
  toucher au registre distant, uniquement le cache local déjà tiré).
- **`apt` uniquement** : aucune détection pour `dnf`/`yum`/`zypper`/
  `pacman`/`apk`/Windows Update, alors que Smart Batch (autre module) sait
  déjà distinguer ces familles. Aucune application des mises à jour depuis
  cette page (lecture seule assumée), pas de planification, pas de
  notification dédiée, pas de fenêtre de redémarrage.

### Logs — Loki (`src/pages/Logs.tsx`, `src-tauri/src/loki.rs`, `src-tauri/src/commands/loki.rs`)
- Construction de requêtes LogQL (hôte, priorité syslog max, unité systemd,
  texte insensible à la casse, échappé) contre une intégration Loki
  existante (`integrations.rs`), lecture par `/query_range` sur une plage
  temporelle choisie.
- Mode « Live » : re-sondage toutes les 5 s (`setInterval`), pas un vrai
  flux WebSocket/tail Loki (`/loki/api/v1/tail`).
- **Pas de requêtes sauvegardées**, pas d'alertes sur logs (pattern →
  notification), pas d'export, pas de vue multi-hôtes croisée (un hôte à la
  fois).

### Bases de données (`src/pages/Databases.tsx`, `src-tauri/src/db_admin.rs`, `src-tauri/src/commands/db_admin.rs`)
- Détection d'engine par SSH (MySQL/MariaDB, PostgreSQL, Redis), y compris
  dans un conteneur Docker (`docker exec`), sans jamais ouvrir de port ni
  passer par un tunnel SSH explicite — tout transite par la session SSH déjà
  établie.
- Lister bases/tables/utilisateurs, exécuter une requête SQL avec bascule
  **lecture seule par défaut** appliquée par une vraie transaction
  (`START TRANSACTION READ ONLY` / `SET TRANSACTION READ ONLY`, pas un
  simple indicateur d'interface), résultats plafonnés (1000 lignes,
  4 Mio de sortie brute, tronqués explicitement plutôt que silencieusement).
- Créer/supprimer une base (identifiants validés et quotés par moteur),
  sauvegarde (`mysqldump`/`pg_dump`) vers un dossier serveur, redémarrage du
  service, panneau Redis (`INFO`, commande whitelistée).
- **Pas d'historique de requêtes**, pas de requêtes favorites, pas d'export
  CSV, pas de plan d'exécution (`EXPLAIN`), pas de diagramme ER — ce que
  la doc concurrente identifie comme des fonctionnalités **gratuites** chez
  DBeaver/TablePlus/Beekeeper, donc rattrapables sans réinventer un moteur.

### Onglets web (`src/pages/Dashboards.tsx`, `src/utils/webTargets.ts`, `src-tauri/src/dashboard_state.rs`, `src-tauri/src/commands/dashboards.rs`)
- Onglets de **webview native Tauri** superposée au DOM (pas un `<iframe>`),
  ouverte pour les connexions Proxmox configurées et déduite automatiquement
  pour tout serveur de type Proxmox (port 8006) ou TrueNAS (port 80) —
  **différenciateur réel** : aucun concurrent étudié (Homepage, Homarr,
  Heimdall, Dashy) n'embarque une vraie webview dans une appli desktop,
  ils ouvrent tous le navigateur système ou un iframe web.
- **Cibles limitées à Proxmox/TrueNAS auto-détectés** : impossible d'ajouter
  un onglet vers un service quelconque (Portainer, Grafana, routeur…) sans
  extension (`contributes.webLinks`, qui eux ouvrent le navigateur externe,
  pas un onglet embarqué) ; pas de vérification de santé (up/down), pas de
  favoris/organisation en dossiers, pas de découverte automatique de
  services (façon Homepage Docker labels).

### Intégrations (`src/components/IntegrationsSettings.tsx`, `src-tauri/src/integrations.rs`, `src-tauri/src/integration_checks.rs`)
- 11 intégrations supportées : Zabbix, Loki, Nginx Proxy Manager, TrueNAS,
  Home Assistant, OPNsense, MikroTik, ntfy, Discord, Telegram, Proxmox
  Backup Server — configuration commune (URL, identifiants, secret chiffré,
  TLS), et **test de connexion authentifié propre à chaque service**
  (`integration_checks.rs`, ex. Zabbix : version d'API + validation du
  jeton par un vrai appel `host.get`), pas un simple ping HTTP générique.
- PBS apparaît comme intégration déclarée mais **aucune commande ne
  l'exploite** au-delà du test de connexion (pas de statut de dépôt PBS
  dans l'app, contrairement au rapport vzdump/Proxmox VE qui, lui, est
  exploité dans Sauvegardes).

### Sécurité / verrouillage / clés SSH (`src-tauri/src/lock/{mod,platform,policy}.rs`, `src-tauri/src/crypto.rs`, `src-tauri/src/keystore.rs`, `src-tauri/src/ssh_keys.rs`, `src-tauri/src/commands/{lock,ssh_keys}.rs`)
- Verrouillage applicatif : PIN (4-12 chiffres, Argon2id) ou Windows Hello
  avec PIN de secours, verrouillage sur inactivité (jusqu'à 24 h,
  configurable) et sur verrouillage de session Windows, limiteur de
  tentatives à délai exponentiel (5 s → 5 min après 3 essais libres).
- Clé maître enveloppée dans le coffre système (Windows Credential
  Manager via `keyring`, `keystore.rs`), dérivation Argon2id + AES-256-GCM
  pour tous les secrets (mots de passe SSH, jetons Proxmox/intégrations,
  clés privées SSH importées) — jamais en clair sur disque, jamais renvoyés
  au frontend (vues `View` sans le champ secret).
- Clés SSH : génération Ed25519, import de clé privée (avec ou sans
  passphrase), **import de fichier `.ppk` PuTTY** (bornage Argon2 contre un
  fichier piégé), déploiement d'une clé publique sur un serveur
  (`authorized_keys`, simulation avant écriture), suivi de quels serveurs
  utilisent quelle clé (`key_users`).
- **Pas de gestionnaire de secrets exportable** au format standard (type
  coffre KeePass/Bitwarden), pas d'agent SSH partagé avec d'autres outils,
  pas de journal d'audit consolidé des actions destructives (chaque module
  logue dans `EventLog`, mais rien n'agrège « qui a supprimé quoi » en une
  vue sécurité dédiée).

### Extensions (`src/utils/extensions.ts`, `src/components/ExtensionsSettings.tsx`, `src-tauri/src/commands/extensions.rs`, `docs/extensions.md`)
- Manifeste **purement déclaratif** (JSON), validé exhaustivement côté
  frontend (`validateManifest` : types, longueurs, regex id/semver/URL
  https, rejet de toute clé inconnue à chaque niveau) : aucun champ
  n'autorise du code exécutable, ni script, ni URL appelée automatiquement —
  seulement des snippets (commande à insérer, jamais auto-exécutée), des
  thèmes (couleurs), et des liens web (ouverts via `open_external_url`
  validé côté Rust). **Différenciateur sécurité fort** face à Tabby (plugins
  npm natifs, isolation non garantie) ou même Raycast (sandbox v8 mais code
  réel) : ici, il n'y a tout simplement rien à sandboxer.
- Installation locale (fichier choisi par l'utilisateur), activation/
  désactivation, désinstallation ; fusion avec les listes natives
  (`mergeSnippets`, `mergeThemes`, `mergeWebLinks`), espace de noms
  `ext:<id>:<nom>` pour éviter toute collision.
- **Pas de registre/magasin d'extensions** (découverte, avis, mises à
  jour automatiques) — tout est apporté en fichier local — et pas de
  signature cryptographique du manifeste (moins critique ici puisqu'il n'y
  a pas de code à exécuter, mais rien n'empêche de distribuer un manifeste
  légèrement modifié sans que la source soit vérifiable).

### Paramètres — sauvegarde de configuration `.spmbackup` et thèmes (`src/pages/Settings.tsx`, `src/components/{BackupPanel,ThemeEditor,ThemeCard}.tsx`, `src-tauri/src/backup.rs`, `src-tauri/src/commands/backup.rs`)
- Export/import chiffré de **toute** la configuration (serveurs, groupes,
  sondes, connexions Proxmox, intégrations, planifications, clés SSH…) :
  format `.spmbackup` maison, Argon2id (64 Mio, 3 passes) + AES-256-GCM,
  en-tête entièrement authentifié (AAD), taille de fichier plafonnée à
  50 Mio en lecture. Les secrets voyagent rechiffrés par une **clé de
  transfert aléatoire** elle-même protégée par la phrase de passe — jamais
  en clair, même dans la charge utile déchiffrée en mémoire ; le
  verrouillage local (hash PIN) et la config de sauvegarde automatique
  (propres à la machine) ne voyagent jamais.
- Sauvegarde automatique planifiée (quotidienne/hebdomadaire), rotation
  des fichiers les plus anciens (`keep`), phrase de passe elle-même chiffrée
  par la clé maître, jamais renvoyée au frontend, historique minimal
  (dernière exécution/erreur seulement, pas de liste des sauvegardes
  passées dans l'UI au-delà du dossier disque).
- Restauration en deux temps (aperçu déchiffré `backup_inspect` avant
  confirmation `backup_apply`), copie de sécurité automatique de la config
  actuelle avant écrasement (`data.json.before-restore.bak`).
- Thèmes : 7 thèmes intégrés, éditeur de thème personnalisé (dupliquer/
  modifier une palette), thèmes contribués par les extensions — **pas
  d'export/partage d'un thème seul** en dehors du mécanisme d'extension
  complet (un thème isolé ne peut pas être exporté en un fichier à glisser
  à quelqu'un sans construire un manifeste entier).

---

## 1. Benchmark des solutions existantes

### Modèles de prix (indicatifs, 27/09/2026)

| Produit | Modèle | Prix indicatif |
|---|---|---|
| Portainer | Freemium | CE gratuite ; BE 99 USD/mois (15 nœuds) à 199 USD/mois (35 nœuds), gratuit ≤3 nœuds |
| Dockge / Komodo / Yacht / Dozzle | Open source | Gratuit |
| Watchtower / Diun / What's Up Docker | Open source | Gratuit |
| Proxmox VE / Proxmox Backup Server | Open source + support optionnel | Gratuit (Community), abonnement support en sus |
| ProxMenux / Helper Scripts | Communautaire | Gratuit |
| Veeam Community Edition | Freemium restreint | Gratuit ≤10 workloads (usage non commercial) ; VUL 250-450 USD/workload/an |
| Duplicati / Restic / Kopia / UrBackup | Open source | Gratuit |
| Ansible AWX | Open source | Gratuit ; Red Hat AAP à partir de 13 000 USD/an (100 nœuds) |
| Semaphore UI | Freemium | Community gratuite (MIT) ; Pro 15 USD/mois ; Enterprise sur devis |
| Rundeck / PagerDuty Process Automation | Freemium | Community gratuite ; Enterprise à partir de 51 000 USD/an |
| Cronicle / crontab-ui | Open source | Gratuit |
| Canonical Landscape | Payant | Tarification non publique |
| Action1 | Freemium | Gratuit ≤200 endpoints ; 4 USD/mois/endpoint au-delà |
| unattended-upgrades / dnf-automatic | Open source (paquet OS) | Gratuit |
| Grafana Loki | Freemium | Self-hosted gratuit (coût infra) ; Cloud 0,50 USD/Go ingestion + 0,10 USD/Go/mois |
| Graylog | Freemium | Open gratuit ; Enterprise 15 000 USD/an ; Security 18 000 USD/an |
| Better Stack | Freemium | 3 Go/mois gratuit ; Nano 25 USD/mois ; Tera 420 USD/mois |
| DBeaver | Freemium | Community gratuite ; Lite 113 USD/an → Ultimate 510 USD/an |
| TablePlus | Freemium | Gratuit (2 onglets) ; licence 99 USD one-time + 59 USD/an |
| Beekeeper Studio | Freemium | Community gratuite ; Ultimate 99 USD/an |
| pgAdmin / phpMyAdmin / Adminer / HeidiSQL | Open source | Gratuit |
| KeePassXC / Bitwarden (gratuit) | Open source / freemium | Gratuit |
| Bitwarden Premium / 1Password | Payant | ~20 USD/an ; 1Password à partir d'un abonnement mensuel |
| Remote Desktop Manager (Devolutions) | Commercial | Tarif non public |
| Tabby (plugins) / Homepage (widgets) / Raycast Store | Open source | Gratuit |
| **Server Power Manager** | Application native locale | — (hors périmètre de ce document) |

### Tableaux comparatifs

Légende : ✅ disponible · 💰 payant/édition supérieure · ➖ partiel/limité · ❌ absent.

#### Docker

| Fonctionnalité | Portainer CE | Dockge | Komodo | Dozzle | Watchtower/Diun/WUD | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|
| Liste + actions start/stop/restart | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Exec / attach shell | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Logs en direct (suivi) | ✅ | ✅ | ✅ | ✅ (focus) | ❌ | ❌ **tail statique, rafraîchi à la main** |
| Stats CPU/RAM instantanées | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Éditeur Compose / stacks | ✅ | ✅ (focus) | ✅ | ❌ | ❌ | ❌ (prévu M2 Console, cf. doc dédié) |
| Détection de mise à jour d'image | ➖ | ✅ | ✅ | ❌ | ✅ (cœur du produit) | ➖ **conteneurs obsolètes détectés localement, pas de comparaison registre distant** |
| Multi-hôtes en une vue | ✅ | ✅ (agents) | ✅ | ✅ | — | ➖ (un hôte à la fois, sélecteur) |
| Sans exposer de port Docker distant | ➖ (socket/agent) | ➖ | ➖ | ➖ | ➖ | ✅ **tout par SSH déjà établi** |

#### Proxmox

| Fonctionnalité | Proxmox VE Web UI | Proxmox Backup Server | ProxMenux/Helper Scripts | **SPM aujourd'hui** |
|---|---|---|---|---|
| VM/CT liste + actions | ✅ | — | ❌ | ✅ (multi-nœuds agrégé) |
| Snapshots / clone | ✅ | — | ❌ | ✅ |
| Migration à chaud | ✅ | — | ❌ | ✅ (plan + exécution + suivi de tâche) |
| Console HTML5/SPICE | ✅ | — | ❌ | ❌ |
| Santé de cluster | ✅ | — | ❌ | ✅ (`cluster_health`) |
| Sauvegarde vzdump (jobs, couverture) | ✅ | ✅ (dédup/chiffrement) | ❌ | ✅ **rapport de couverture agrégé, meilleur que l'UI Proxmox brute** |
| Dépôt PBS dédié (dédup, vérif) | ❌ | ✅ | ❌ | ❌ (intégration déclarée mais inexploitée) |
| Pare-feu / HA / templates | ✅ | — | ➖ | ❌ |
| Depuis une appli desktop tierce (comparatif Console) | — | — | — | ✅ **aucun concurrent SSH étudié (MobaXterm, Termius…) n'a d'intégration Proxmox** |

#### Sauvegardes (VM/CT et configuration app)

| Fonctionnalité | Veeam CE | Restic/Kopia | PBS | UrBackup | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| Planification | ✅ | ➖ (cron externe) | ✅ | ✅ | ➖ (lit les jobs Proxmox, n'en crée pas) |
| Rapport de couverture par machine | ➖ | ❌ | ➖ | ➖ | ✅ **différenciateur (croise VM/CT ↔ archives ↔ stockages)** |
| Restauration | ✅ | ✅ | ✅ | ✅ | ❌ (VM/CT) / ✅ (config app, `.spmbackup`) |
| Vérification d'intégrité | ✅ | ✅ (crypto) | ✅ | ➖ | ❌ |
| Chiffrement bout en bout | ✅ | ✅ | ✅ | ❌ | ✅ (`.spmbackup`, AES-256-GCM + Argon2id, secrets jamais en clair) |
| Sauvegarde de la config de l'outil lui-même | — | — | — | — | ✅ **aucun concurrent de ce comparatif n'a cette notion (ils sauvegardent des machines, pas leur propre état)** |

#### Tâches en lot / automatisation

| Fonctionnalité | Ansible AWX | Semaphore UI | Rundeck | **SPM aujourd'hui** |
|---|---|---|---|---|
| Exécution multi-cibles parallèle/séquentielle | ✅ | ✅ | ✅ | ✅ |
| Dry-run / mode vérification | ✅ | ✅ | ➖ | ➖ (Ansible seulement, `--check`) |
| Détection d'OS et résolution portable multi-famille | ❌ | ❌ | ❌ | ✅ **unique : Smart Batch, 9 familles de paquets/init** |
| Historique & audit persistant | ✅ | ✅ | ✅ | ❌ **rien en base, flux d'événements volatil** |
| Approbations avant exécution | ✅ | ➖ | 💰 (Enterprise) | ❌ |
| Entrées interactives pendant l'exécution | ➖ | ➖ | ➖ | ✅ (réponse aux invites `dpkg`, etc.) |
| Gestion de secrets dédiée | ✅ (Vault) | ✅ | ✅ (Vault/Secrets Manager) | ➖ (réutilise le coffre SSH de l'app, pas de secrets par tâche) |

#### Planification

| Fonctionnalité | Cronicle | crontab-ui | Rundeck | **SPM aujourd'hui** |
|---|---|---|---|---|
| Cron standard | ✅ | ✅ | ✅ | ✅ (mode Cron, synchronisé sur le serveur) |
| Sélecteur visuel / calendrier | ✅ | ➖ | ➖ | ➖ (jours de semaine + heure, pas de vue calendrier) |
| Chaînage d'événements | ✅ | ❌ | ✅ (workflow) | ❌ |
| Historique d'exécution | ✅ | ➖ (logs d'erreur) | ✅ | ➖ (`last_run` seul, pas de journal) |
| Fenêtres de maintenance | ➖ | ❌ | 💰 (Enterprise) | ➖ (fenêtre de rattrapage 2 min pour Wake/Shutdown/Reboot uniquement) |
| Actions couvertes | Scripts génériques | Scripts génériques | Workflows complexes | Wake/Shutdown/Reboot uniquement **+ cron serveur pour le reste (`cron_list`)** |

#### Mises à jour

| Fonctionnalité | unattended-upgrades | dnf-automatic | Action1 | Landscape | Watchtower/Diun/WUD | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|
| Détection paquets en attente | ✅ (apt) | ✅ (dnf) | ✅ (Windows/Linux) | ✅ | — | ✅ (apt uniquement) |
| Multi-famille (dnf/pacman/zypper…) | ❌ | ❌ | ✅ | ✅ | — | ❌ |
| Application automatique | ✅ (security-only configurable) | ✅ | ✅ | ✅ (update rings) | — | ❌ (lecture seule assumée) |
| Redémarrage requis / fenêtre | ✅ | ➖ | ✅ | ✅ | — | ✅ (détection) / ❌ (planification) |
| Détection d'image Docker obsolète | ❌ | ❌ | ❌ | ❌ | ✅ (cœur du produit) | ✅ **sans appel registre distant** |
| Notification dédiée | ✅ (email) | ➖ | ✅ | ✅ | ✅ (10+ canaux) | ❌ (pas relié aux alertes existantes de l'app) |

#### Logs

| Fonctionnalité | Grafana Loki natif | Dozzle | Graylog | Better Stack | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| Requêtes LogQL construites en UI | ➖ (LogQL brut) | — | — (Lucene) | — (SQL) | ✅ (constructeur guidé : hôte/priorité/unité/texte) |
| Live tail temps réel | ✅ (vrai flux) | ✅ | ➖ | ✅ | ➖ **re-sondage 5 s, pas un flux `/tail`** |
| Requêtes sauvegardées | ✅ (dashboards Grafana) | ❌ | ✅ | ✅ | ❌ |
| Alertes sur logs | ✅ (via Grafana/Prometheus) | ✅ (webhooks) | 💰 (Enterprise) | ✅ | ❌ |
| Multi-hôtes en une recherche | ✅ | ✅ | ✅ | ✅ | ➖ (un hôte sélectionné à la fois) |

#### Bases de données

| Fonctionnalité | DBeaver CE | TablePlus | Beekeeper | pgAdmin/phpMyAdmin | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| Connexion via tunnel SSH | ✅ | 💰 | ✅ | ✅ | ✅ **sans même ouvrir de tunnel : exécution directe par la session SSH** |
| Éditeur de requêtes | ✅ | 💰 | ✅ | ✅ | ✅ (lecture seule par défaut, activable) |
| Historique de requêtes | ✅ | 💰 | 💰 (Ultimate) | ➖ | ❌ |
| Requêtes favorites | ✅ | 💰 | ➖ | ➖ | ❌ |
| Export CSV/JSON | ✅ | 💰 | 💰 | ✅ | ❌ |
| Plan d'exécution (EXPLAIN) | ➖ | 💰 | ❌ | ➖ | ❌ |
| Sauvegarde/restauration | 💰 (Ultimate) | ❌ | ✅ | ✅ (pg_dump intégré) | ➖ (sauvegarde oui, restauration non) |
| Lecture seule appliquée réellement (pas juste UI) | ➖ (auto-commit peut contourner) | — | — | — | ✅ **vraie transaction READ ONLY côté serveur** |
| Redis (info + commande) | 💰 (Pro+) | 💰 | ➖ | ❌ | ✅ |

#### Onglets web / Intégrations / Dashboards

| Fonctionnalité | Homepage | Homarr | Heimdall | Dashy | **SPM aujourd'hui** |
|---|---|---|---|---|---|
| Ajout d'un lien/service quelconque | ✅ (YAML) | ✅ (UI) | ✅ (drag&drop) | ✅ (YAML) | ➖ **seulement Proxmox/TrueNAS auto-détectés + extensions** |
| Rendu dans une vraie fenêtre embarquée (pas juste un lien) | ❌ (liens externes) | ❌ | ❌ | ❌ | ✅ **webview native, différenciateur réel** |
| Vérification de santé (up/down) | ✅ | ➖ | ➖ | ✅ | ❌ |
| Auto-découverte de services (labels Docker) | ✅ | ➖ | ❌ | ❌ | ❌ |
| Test de connexion authentifié par service | — | — | — | — | ✅ **11 intégrations, test réel (jeton, API), pas un simple ping** |
| Secrets d'intégration chiffrés at-rest | ✅ (Homarr) | ✅ | ❌ (reverse proxy) | ➖ | ✅ (AES-256-GCM, clé maître) |

#### Sécurité, verrouillage, clés SSH, extensions

| Fonctionnalité | KeePassXC | Bitwarden (gratuit) | 1Password SSH Agent | Tabby plugins | Raycast Extensions | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|
| Verrouillage local (PIN/biométrie) | ✅ | ✅ (appli) | ✅ (Touch ID/Hello) | — | — | ✅ (PIN + Windows Hello, délai anti-bruteforce) |
| Génération/import de clés SSH | ✅ (attachments) | ✅ | ✅ | — | — | ✅ (Ed25519, import clé/`.ppk`) |
| Déploiement de clé publique sur un hôte | ❌ | ❌ | ❌ | — | — | ✅ (`authorized_keys`, simulation avant écriture) |
| Export/format de coffre standard | ✅ (KDBX) | ✅ | ❌ (propriétaire) | — | — | ➖ (uniquement via `.spmbackup` complet, pas un export de coffre seul) |
| Architecture de plugin/extension | — | — | — | ✅ (npm, non isolé) | ✅ (v8 isolate, code réel) | ✅ **manifeste déclaratif sans code exécutable — surface d'attaque nulle par construction** |
| Registre/magasin d'extensions | — | — | — | ➖ | ✅ (review + store) | ❌ (fichier local uniquement) |
| Sauvegarde chiffrée de la configuration complète de l'outil | — | ➖ (export JSON en clair par défaut) | — | — | — | ✅ **`.spmbackup`, secrets jamais en clair même déchiffré, clé de transfert dédiée** |

---

## 2. Analyse de faisabilité native

Barème : Valeur 1 (marginal) à 5 (très demandé/différenciant) ; Effort
S (≤1 j) / M (2-4 j) / L (1-2 sem) / XL (>2 sem, changement d'architecture).

### 2.1 Docker

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Suivi des logs en direct | 4 | M | `docker logs -f --tail 50` via `execute_ssh_interactive` (déjà utilisé par Batch pour le flux interactif) au lieu de `execute_ssh` ; fermeture propre du canal SSH à la fermeture du modal | Un conteneur très bavard peut saturer le canal : plafonner le débit affiché (buffer + throttle React), jamais bloquant côté Rust | ✅ Intégrer (Phase 1) |
| Pause / Unpause | 3 | S | `docker_action` accepte déjà un ensemble fermé d'actions (`start\|stop\|restart`) : ajouter `pause`/`unpause` à la liste blanche, aucune nouvelle commande | Aucun (mêmes garde-fous que start/stop) | ✅ Intégrer (Phase 1) |
| Exec shell simple (`docker exec -it <c> sh`) | 3 | M | Réutiliser une session `TerminalView` existante en pointant la commande initiale sur `docker exec -it <container> sh` au lieu d'un shell de connexion ; pas de nouveau protocole, juste un nouveau point d'entrée du terminal déjà présent (Console) | Accès complet au conteneur ciblé : n'ouvrir cet exec que depuis un bouton explicite « Ouvrir un terminal dans ce conteneur », jamais automatique | 🟡 Plus tard (Phase 2) — dépend du composant Console, coordination avec l'autre document |
| Détection de mise à jour d'image (registre distant) | 3 | L | Nécessiterait d'interroger le registre (Docker Hub/GHCR) pour le digest courant du tag, en plus de la comparaison locale déjà faite ; ajouter un client `reqwest` vers l'API registry v2 (auth anonyme pour la plupart des images publiques) | Appel réseau sortant vers un tiers (registre) : à documenter clairement, désactivable, jamais automatique en tâche de fond sans consentement | 🟡 Plus tard (Phase 2) — valeur réelle mais élargit la surface réseau sortante de l'app |
| Éditeur Docker Compose | 4 | M | Déjà spécifié dans le document Console (M2) : ne pas dupliquer ici, seulement relier la page Docker à cet éditeur une fois livré | — | ➡️ Voir doc Console (déjà planifié) |
| Multi-hôtes en une seule vue | 2 | M | Fusionner les résultats de plusieurs `docker_list` en une liste unique avec colonne « hôte » | Aucun | 🟡 Plus tard (Phase 3) — la sélection actuelle par onglet hôte couvre l'essentiel des homelabs (peu d'hôtes Docker) |

### 2.2 Proxmox

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Console VM/CT (lien noVNC externe) | 4 | S | Ne pas embarquer de client VNC : construire l'URL de la console noVNC Proxmox (`/?console=kvm&vmid=...&vmname=...&node=...`) authentifiée par un ticket API (`access/ticket`) et l'ouvrir soit dans un onglet web déjà existant (webview native, module Onglets web), soit dans le navigateur externe | Le ticket de console est un secret de courte durée : ne jamais le logger, l'inclure uniquement dans l'URL ouverte immédiatement | ✅ Intégrer (Phase 1) — réutilise directement le module Onglets web |
| Statut Proxmox Backup Server dédié | 3 | M | L'intégration PBS existe déjà (`integrations.rs`, testée) mais rien ne l'exploite : ajouter un client minimal (`/api2/json/status/datastore-usage`, `/admin/datastore/{store}/snapshots`) et une carte dans Sauvegardes quand PBS est configuré | Un jeton PBS mal scoppé pourrait lister plus que prévu : documenter le rôle API minimal recommandé | ✅ Intégrer (Phase 2) |
| Pare-feu (règles datacenter/nœud/VM) | 2 | L | Lecture seule d'abord (afficher les règles actives) avant tout écrit ; l'API Proxmox l'expose déjà | Modifier un pare-feu à distance est une opération à haut risque de coupure : si écriture un jour, exiger une confirmation à double étape | 🟡 Plus tard (Phase 3), lecture seule seulement |
| HA/Corosync — vue de cluster | 2 | M | `cluster_health` existe déjà : étendre avec le statut HA (`/cluster/ha/status/current`) | Aucun (lecture seule) | 🟡 Plus tard (Phase 3) |
| Templates/ISO | 2 | M | Lister les templates disponibles par stockage (`/nodes/{node}/storage/{s}/content`) pour faciliter un clone depuis template | Aucun (lecture) | 🟡 Plus tard (Phase 3) |

**Déjà mieux que la concurrence, à mettre en avant plutôt qu'à refaire** :
le rapport de sauvegarde qui croise jobs vzdump + couverture par invité +
tâches récentes en une seule vue (aucun concurrent de ce comparatif —
Proxmox VE inclus — ne l'agrège ainsi), la migration à chaud avec plan
préalable, et l'intégration Proxmox tout court comparée aux outils SSH purs
(MobaXterm, Termius) qui n'en ont aucune.

### 2.3 Sauvegardes (VM/CT)

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Alerte si une sauvegarde est en retard/absente | 4 | S | Le rapport (`BackupReport.guests[].covered`/`last_backup`) existe déjà : ajouter une vérification périodique (même minuteur que les sondes) qui pousse un événement `Failure` vers le moteur d'alertes existant (ntfy/Discord/Telegram) quand un invité couvert n'a pas d'archive récente au-delà d'un seuil configurable | Faux positifs si le job Proxmox est volontairement plus espacé que le seuil : rendre le seuil configurable par job, pas global | ✅ Intégrer (Phase 1) — réutilise entièrement le moteur d'alertes déjà en place |
| Restauration d'une VM/CT depuis l'app | 2 | L | Nécessiterait d'exposer `POST /nodes/{node}/qemu` (restore) avec sélection de l'archive vzdump : l'API le permet, mais c'est une opération destructive à fort impact (écrase potentiellement une VM existante) | Risque élevé : restauration = perte de données actuelles si mal ciblée. Exiger confirmation forte (nom de la VM tapé), et ne jamais restaurer par-dessus un vmid existant sans avertissement explicite | 🟡 Plus tard (Phase 3), avec garde-fous UX prioritaires sur la vitesse de livraison |
| Intégration PBS (vérification/dédup) | 3 | M | Cf. §2.2 (statut PBS) : une fois le client minimal en place, afficher aussi le résultat des tâches de vérification (`verify`) programmées côté PBS | Lecture seule, aucun risque | ✅ Intégrer (Phase 2), avec X — Statut PBS |

### 2.4 Tâches en lot

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Historique persistant des exécutions | 4 | M | Table SQLite (même base que l'historique de métriques/événements, `db.rs`) : une ligne par exécution (run_id, tâche, cibles, mode, horodatage, statut par cible, sortie tronquée) ; écrite à la réception de `Update::Done`, consultable dans un nouvel onglet de la page Batch | Une sortie de commande peut contenir des secrets tapés par erreur (mot de passe en clair dans un script) : tronquer et ne jamais indexer en clair les valeurs ressemblant à un secret existant (comparaison simple avec les secrets connus, best-effort) | ✅ Intégrer (Phase 1) |
| Relance des seuls échecs | 3 | S | Une fois l'historique en place (ci-dessus), un bouton « Relancer les échecs » reconstruit la liste des `BatchTarget` à partir des cibles marquées `ok: false` du run précédent, appelle `run_smart` normalement | Aucun nouveau risque (mêmes garde-fous que l'exécution normale) | ✅ Intégrer (Phase 1), après l'historique |
| Dry-run générique (hors Ansible) | 3 | M | Pour un script bash, un vrai dry-run générique n'existe pas nativement (contrairement à `ansible --check`) : proposer plutôt un mode « aperçu » qui affiche la commande résolue par cible (variables substituées, `smart_action` traduite) sans l'exécuter — utile pour Smart Batch, où la commande diffère par OS | Aucun risque technique ; bien nommer la fonctionnalité pour ne pas laisser croire à un vrai `--dry-run` shell (qui n'existe pas en général) | ✅ Intégrer (Phase 2) |
| Approbation avant exécution sur cibles sensibles | 2 | L | Marquer certains serveurs (ex. production) comme « sensibles » dans leur fiche, et exiger une confirmation nommée (taper le nombre de cibles) avant un lot qui les inclut | Change le modèle de données `Server` ; à valider avec le produit avant de s'engager | 🟡 Plus tard (Phase 3), décision produit |
| Gestion de secrets par tâche | 2 | L | Actuellement les tâches réutilisent les identifiants SSH déjà stockés par serveur ; un vrai vault de variables par tâche recouperait le coffre existant | Complexité de modèle pour un bénéfice marginal en mono-poste homelab | ❌ Hors périmètre — le coffre par serveur couvre déjà l'essentiel du besoin homelab |

**Déjà mieux que la concurrence, à mettre en avant** : Smart Batch (détection
d'OS et résolution portable multi-famille par cible) n'a d'équivalent dans
aucun outil étudié, y compris Ansible AWX qui nécessite d'écrire soi-même la
logique multi-OS dans les playbooks.

### 2.5 Planificateur

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Vue calendrier | 3 | M | Composant calendrier simple (grille semaine/mois) au-dessus de la liste actuelle, affichant les créneaux `Schedule.days`/`time` — pur frontend, aucune commande Rust nouvelle | Aucun | ✅ Intégrer (Phase 2) |
| Historique des exécutions | 3 | M | Étendre `Schedule` avec un journal borné (ex. 20 dernières exécutions horodatées + résultat) dans `AppData`, écrit à chaque déclenchement réussi/échoué (`#[serde(default)]` pour compatibilité) ; ou réutiliser la même table SQLite que l'historique de lot (§2.4) avec un type d'événement « planification » | Volume limité par nature (peu de tâches, peu d'exécutions/jour) : pas de souci de croissance | ✅ Intégrer (Phase 2) |
| Tâches arbitraires planifiées (pas seulement alimentation) | 3 | L | Généraliser `ScheduleAction` à « exécuter une tâche en lot enregistrée » en plus de Wake/Shutdown/Reboot ; recoupe directement le module Tâches en lot (planifier une `BatchTask`) | Une tâche en lot planifiée sans surveillance peut échouer silencieusement : la relier à l'historique (§2.4) et aux alertes est indispensable, pas optionnel | 🟡 Plus tard (Phase 3) — dépend de l'historique de lot d'abord |
| Fenêtres de maintenance génériques | 2 | M | Concept déjà partiellement présent (fenêtre de rattrapage 2 min) ; l'étendre en un réglage explicite « ne pas exécuter avant/après telle heure » réutilisable par les futures tâches planifiées | Aucun risque technique, juste un réglage supplémentaire | 🟡 Plus tard (Phase 3), avec la généralisation ci-dessus |

**Déjà mieux que la concurrence** : la synchronisation bidirectionnelle des
lignes crontab sur le serveur cible (`plan_cron_ops`) — la tâche survit à la
fermeture de l'app — est plus robuste que le modèle « scheduler qui doit
tourner en permanence » de Cronicle/crontab-ui.

### 2.6 Mises à jour

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Détection multi-famille (dnf/pacman/zypper/apk) | 4 | M | `smart_batch.rs` sait déjà détecter la famille de paquets d'un hôte (`PkgFamily`) et connaît les commandes de mise à jour par famille ; étendre `updates.rs::SCAN_COMMAND` pour brancher, selon la famille détectée en amont, la bonne commande de listing (`dnf check-update`, `zypper lu`, `checkupdates` pour pacman, `apk list -u`) au lieu du seul `apt list --upgradable` | Chaque gestionnaire a un format de sortie différent : un parseur dédié par famille, testé unitairement comme `parse_package` actuel | ✅ Intégrer (Phase 1) — réutilise une détection déjà écrite ailleurs dans l'app |
| Notification des mises à jour de sécurité disponibles | 3 | S | Relier `UpdateReport.security_count > 0` (déjà calculé) au moteur d'alertes existant (ntfy/Discord/Telegram), avec cooldown comme les autres alertes | Aucun nouveau risque : lecture seule, notification uniquement | ✅ Intégrer (Phase 1) |
| Application des mises à jour de sécurité (optionnelle, opt-in) | 3 | L | Bouton explicite « Installer les mises à jour de sécurité » qui construit `apt-get install --only-upgrade <paquets sécurité>` (ou l'équivalent par famille) via le moteur Batch existant (une cible = ce serveur), jamais automatique | **Risque élevé** : une mise à jour peut casser un service. Comportement par défaut = lecture seule inchangé ; l'application reste un geste explicite, un serveur à la fois, jamais en tâche de fond ni en lot par défaut | 🟡 Plus tard (Phase 3) — valeur réelle mais doit rester strictement opt-in et visible |
| Planification de redémarrage après mise à jour | 2 | S | Une fois `reboot_required` détecté, proposer de créer une tâche `Reboot` ponctuelle dans le Planificateur existant (préremplie) plutôt que redémarrer immédiatement | Aucun nouveau risque (réutilise le Planificateur, qui a déjà ses propres garde-fous) | 🟡 Plus tard (Phase 3), après l'application optionnelle ci-dessus |

### 2.7 Logs (Loki)

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Requêtes sauvegardées | 3 | S | Petite table `AppData.saved_log_queries: Vec<SavedLogQuery>` (nom, hôte, priorité, unité, texte) avec commandes CRUD standard ; frontend : liste déroulante au-dessus du constructeur de requête existant | Aucun (pas de secret dans une requête LogQL) | ✅ Intégrer (Phase 1) |
| Vrai live tail (`/loki/api/v1/tail`, WebSocket) | 3 | M | Remplacer le re-sondage 5 s par une connexion WebSocket ouverte côté Rust (`tokio-tungstenite`, déjà dans l'écosystème Tokio de l'app) relayée au frontend via un `Channel`/événement Tauri, comme le fait déjà `SftpProgress` pour les transferts | Une connexion WebSocket longue doit être proprement fermée à la sortie de la page (fuite de tâche sinon) ; prévoir un timeout d'inactivité | 🟡 Plus tard (Phase 2) — le re-sondage 5 s couvre déjà l'essentiel de l'usage homelab (pas de vrai besoin sub-seconde) |
| Alertes sur logs (pattern → notification) | 3 | M | Réutiliser une requête sauvegardée (ci-dessus) comme condition, évaluée par le même minuteur que les sondes existantes (`probes.rs`) ; au dépassement d'un seuil de nouvelles lignes correspondantes, déclencher une alerte via le moteur ntfy/Discord/Telegram déjà en place | Un pattern trop large peut spammer les canaux d'alerte : appliquer le même cooldown que les alertes de sondes | ✅ Intégrer (Phase 2), après les requêtes sauvegardées |
| Export des résultats | 2 | S | Bouton « Exporter en .txt/.csv » sur les résultats déjà affichés, pur frontend | Aucun | 🟡 Plus tard (Phase 3) |

### 2.8 Bases de données

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Historique des requêtes exécutées | 4 | S | Même table SQLite que l'historique de lot (§2.4) ou une table dédiée : connexion, SQL, horodatage, succès/erreur, lecture seule ou non — écrite à chaque `db_run_query` | Le SQL peut contenir des données sensibles saisies par erreur : ne pas dupliquer l'historique dans les logs `Debug`, même garde-fou que le reste de l'app | ✅ Intégrer (Phase 1) |
| Requêtes favorites | 3 | S | CRUD simple sur `AppData` (nom, engine, SQL), pas de secret | Aucun | ✅ Intégrer (Phase 1) |
| Export CSV des résultats | 3 | S | `QueryResult` (colonnes + lignes) déjà structuré : sérialisation CSV pure frontend, bouton de téléchargement | Aucun | ✅ Intégrer (Phase 1) |
| Plan d'exécution (EXPLAIN) | 2 | S | Bouton qui préfixe la requête par `EXPLAIN` (MySQL) / `EXPLAIN ANALYZE` (Postgres, en option car il exécute réellement) avant envoi ; affichage tabulaire réutilisant `QueryResult` | `EXPLAIN ANALYZE` exécute la requête pour de vrai (pas un simple plan) : le proposer seulement décoché par défaut, avec avertissement explicite | 🟡 Plus tard (Phase 2) |
| Connexion GUI externe via tunnel SSH généré | 2 | M | Ouvrir un port local temporaire tunnelé par la session SSH existante (`russh` supporte déjà le forwarding pour SFTP) pour brancher un client externe (DBeaver, etc.) le temps d'une session | Ouvrir un port local, même temporaire, change la posture « rien n'écoute » de l'app : le limiter à `127.0.0.1`, une whitelist stricte de durée, fermeture automatique à la fermeture de la page | 🟡 Plus tard (Phase 3) — l'exécution directe par SSH (déjà en place) couvre le besoin principal sans ce risque |

**Déjà mieux que la concurrence** : exécution directe par SSH sans jamais
ouvrir de port ni configurer de tunnel (contrairement à DBeaver/TablePlus/
pgAdmin qui nécessitent tous une configuration de tunnel explicite), et
lecture seule appliquée par une vraie transaction serveur plutôt qu'un
interrupteur d'interface contournable (limite documentée de DBeaver avec
l'auto-commit).

### 2.9 Onglets web / Intégrations

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Onglet web vers une URL quelconque | 4 | S | `webTargets()` ne connaît que Proxmox/TrueNAS : ajouter un formulaire « Ajouter un onglet » (titre + URL) stocké dans `AppData.custom_web_tabs`, fusionné dans la même liste que les cibles auto-détectées | Une URL arbitraire ouverte dans une webview native a accès au même moteur que le reste de l'app : s'assurer qu'elle reste isolée (contexte de navigation séparé, ce que fait déjà Tauri par onglet) et avertir si l'URL n'est pas HTTPS | ✅ Intégrer (Phase 1) |
| Vérification de santé (up/down) des onglets/services | 3 | M | Réutiliser le moteur de sondes existant (`probes.rs`) sur l'URL de chaque onglet web (HEAD/GET simple), badge coloré dans la liste des cibles | Aucun nouveau risque (sonde sortante, comme les sondes existantes) | ✅ Intégrer (Phase 2) |
| Auto-découverte de services (labels Docker) | 2 | L | Lire les labels Docker (`docker inspect`) déjà accessibles via le module Docker pour suggérer des onglets web (port exposé + libellé) | Faux positifs possibles (port exposé ≠ interface web) : proposer, ne jamais ajouter automatiquement | 🟡 Plus tard (Phase 3) |
| Statut PBS exploité dans les Intégrations | 3 | M | Cf. §2.3 — l'intégration existe déjà, seul le client d'appel manque | — | ✅ Intégrer (Phase 2) (même item que X — Statut PBS) |

### 2.10 Sécurité / verrouillage / clés SSH

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Journal d'audit consolidé des actions destructives | 4 | M | `EventLog` existe déjà et enregistre déjà la plupart des actions (Docker, Proxmox, backup…) : ajouter une page « Journal de sécurité » dans Paramètres qui filtre `EventLog` sur les catégories destructives (suppression, arrêt forcé, restauration, migration) — essentiellement un filtre/vue sur des données déjà collectées | Aucun nouveau risque ; à l'inverse, réduit le risque en rendant visible ce qui existait déjà de façon éparpillée | ✅ Intégrer (Phase 1) |
| Export du coffre de clés SSH au format standard | 2 | M | Exporter les clés privées gérées par l'app en fichiers OpenSSH classiques (déjà le format stocké en interne) vers un dossier choisi, protégé par une confirmation explicite | Exporter une clé privée en clair sur disque est risqué par nature : avertissement fort, jamais par défaut, jamais dans le `.spmbackup` qui a son propre mécanisme déjà plus sûr | 🟡 Plus tard (Phase 3) — le `.spmbackup` couvre déjà la portabilité complète et de façon plus sûre ; cet export ne sert qu'à interopérer avec un outil tiers (ex. copier dans `~/.ssh`) |
| Agent SSH partagé (Pageant-like) | 1 | XL | Implémenter un agent SSH compatible pour d'autres outils (comme KeePassXC/1Password) demanderait un service tournant en arrière-plan exposant un socket/pipe nommé — changement d'architecture (l'app ne fait rien tourner en dehors d'elle-même aujourd'hui) | Surface d'attaque nouvelle (un agent qui répond à n'importe quel processus local) | ❌ Hors périmètre — contraire au modèle actuel, bénéfice marginal pour un homelab mono-poste |
| Signature du manifeste d'extension | 2 | M | Ajouter un champ de signature optionnelle (ed25519) vérifiée si présente, sans la rendre obligatoire tant qu'il n'y a pas de registre officiel | Complexité pour un bénéfice limité tant qu'il n'y a pas de distribution centralisée (§2.11) | 🟡 Plus tard (Phase 3), à coupler avec un éventuel registre |

**Déjà mieux que la concurrence** : le déploiement de clé publique avec
simulation avant écriture (aucun concurrent étudié — KeePassXC, Bitwarden,
1Password — ne va jusqu'à *déployer* une clé sur un serveur cible, ils se
contentent de la stocker/servir en agent), et le verrouillage PIN + Windows
Hello avec délai anti-bruteforce, une combinaison qu'aucun des outils du
comparatif Sécurité n'offre nativement en dehors d'un gestionnaire de mots
de passe dédié.

### 2.11 Extensions

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Registre/magasin d'extensions communautaire | 2 | XL | Nécessiterait un service hébergé (liste, hébergement de fichiers, modération) — hors de la portée d'une app desktop locale sans backend propre | Modération de contenu, hébergement, disponibilité : responsabilités d'éditeur que l'app n'a pas aujourd'hui | ❌ Hors périmètre pour cette version — à réévaluer seulement si une vraie communauté d'extensions émerge |
| Import direct depuis une URL (au lieu d'un fichier local) | 2 | S | `read_extension_file` accepte déjà un chemin local ; ajouter un second champ « importer depuis une URL » qui télécharge le JSON via `reqwest` puis passe par la même validation stricte existante | Une URL arbitraire est un vecteur de contenu non maîtrisé, même sans code exécutable (ex. lien de phishing dans une description) : afficher l'URL source de façon visible avant import, jamais d'auto-import | 🟡 Plus tard (Phase 3) |
| Export d'un thème seul (sans manifeste complet) | 2 | S | Bouton « Exporter ce thème » sur `ThemeCard` qui génère un `ExtensionManifest` minimal contenant uniquement ce thème — réutilise le format existant sans le complexifier | Aucun (le format est déjà entièrement validé) | ✅ Intégrer (Phase 1) — très peu d'effort pour un vrai gain de partage communautaire |

### 2.12 Paramètres (config `.spmbackup`, thèmes)

| Fonctionnalité | Valeur | Effort | Solution technique | Risques | Verdict |
|---|---|---|---|---|---|
| Historique des sauvegardes automatiques (liste, pas juste la dernière) | 3 | S | Lire le contenu du dossier configuré (`BackupConfig.folder`) et lister les fichiers `spm-backup-*.spmbackup` déjà présents (la fonction `is_auto_file`/tri existe déjà pour la rotation) : simple vue, aucune nouvelle donnée à stocker | Aucun (lecture du système de fichiers déjà accédé pour la rotation) | ✅ Intégrer (Phase 1) |
| Sauvegarde automatique vers un stockage distant (WebDAV/S3/SFTP) | 2 | L | Étendrait `BackupConfig` avec un type de destination et un client de transfert (SFTP le plus cohérent avec la stack SSH déjà en place) | Élargit la surface de secrets à gérer (identifiants du stockage distant) : même modèle de chiffrement que le reste, mais plus de code à maintenir pour un gain marginal (un dossier synchronisé par OneDrive/Syncthing couvre déjà 80 % du besoin) | 🟡 Plus tard (Phase 3), priorité basse |
| Vérification automatique qu'une restauration est possible (test d'ouverture) | 2 | S | Après chaque sauvegarde automatique réussie, tenter un `backup::open` (déchiffrement) immédiat avec la phrase de passe déjà en mémoire, sans aller jusqu'à `import_bytes`/`into_local_data` — détecte une corruption d'écriture sans exposer davantage de secrets | Aucun nouveau risque (relit un fichier qu'on vient d'écrire, avec la phrase déjà utilisée) | ✅ Intégrer (Phase 2) |

---

## 3. Plan d'action d'intégration native

### 3.1 Feuille de route

#### Phase 1 — Gains rapides (S/M, forte valeur)

**K1 — Suivi des logs Docker en direct**
Objectif : voir les nouvelles lignes d'un conteneur sans cliquer sur
*Rafraîchir*. Spécification : `docker logs -f --tail 50 --timestamps` via
`execute_ssh_interactive` (déjà utilisé par Batch), relayé au frontend par
un `Channel<String>` (comme `SftpProgress`) ; le canal SSH se ferme
proprement à la fermeture du `LogsModal`. Critères : le tail existant
s'affiche puis se complète en direct ; fermer le modal ne laisse aucun
`docker logs -f` orphelin côté serveur. Tests : construction de la commande
+ relais des chunks (mock du `Channel`). Estimation : M (2 j).

**K2 — Pause / Unpause de conteneur**
Objectif : mettre en pause sans arrêter. Spécification : étendre la liste
blanche d'actions de `docker_action` (`start|stop|restart|pause|unpause`),
aucune commande Rust nouvelle ; bouton supplémentaire dans `Docker.tsx`.
Critères : l'état affiché suit `paused`/`running` (couleurs déjà gérées par
`STATE_COLOR`). Estimation : S (0,5 j).

**T1 — Historique persistant des exécutions en lot**
Objectif : retrouver ce qui a été lancé, où, et avec quel résultat, même
après fermeture de l'app. Spécification : tables SQLite `batch_runs`/
`batch_run_targets` (`db.rs`), écrites depuis `commands/batch.rs` en plus de
l'émission `Emit` déjà existante (`Started`/`Finished`/`Done`) ; nouvel
onglet « Historique » dans `Batch.tsx` (tâche, mode, date, N succès/échecs,
détail par cible). Purge au-delà de N runs, comme l'historique de métriques
existant. Critères : un run apparaît en moins d'une seconde, survit à un
redémarrage. Tests : insertion/lecture Rust ; affichage frontend mocké.
Estimation : M (3 j).

**T2 — Relancer les échecs**
Objectif : ne relancer que les cibles en échec. Dépend de T1. Spécification :
bouton qui reconstruit les `BatchTarget`/`SmartTarget` à partir des cibles
`ok: false` du run choisi, puis réutilise le chemin d'exécution existant.
Critères : un lot à 3 échecs sur 10 ne relance que ces 3 cibles, même
commande. Estimation : S (1 j), après T1.

**U1 — Détection des mises à jour multi-famille**
Objectif : le Centre de mises à jour fonctionne aussi sur Fedora/RHEL/
openSUSE/Arch/Alpine, pas seulement Debian/Ubuntu. Spécification : dans
`updates.rs`, brancher par famille détectée (réutilise
`smart_batch::PkgFamily`/`parse_posix_probe`, déjà écrits ailleurs) :
`dnf check-update` (+ `--security`), `zypper lu`, `checkupdates` (Pacman,
paquet optionnel à documenter), `apk list -u` ; un parseur dédié par famille
produit la même structure `Package`. Critères : rapport correct sur une
cible Fedora (sécurité comprise) ; comportement inchangé sur une famille
inconnue. Tests : un test de parsing par famille, sortie réelle en exemple.
Estimation : M (3 j).

**U2 — Notification des mises à jour de sécurité**
Objectif : être alerté sans ouvrir la page. Spécification : après un scan
périodique, si `security_count` a augmenté depuis la dernière notification
pour ce serveur, pousser une alerte via le moteur existant (ntfy/Discord/
Telegram), même cooldown que les alertes de sondes. Critères : une seule
notification par nouveauté, pas à chaque scan inchangé. Estimation : S (1 j).

**L1 — Requêtes Loki sauvegardées**
Objectif : rejouer une recherche fréquente. Spécification :
`AppData.saved_log_queries: Vec<SavedLogQuery>` (`#[serde(default)]`), CRUD
standard (patron de `save_batch_task`), liste déroulante au-dessus des
filtres de `Logs.tsx`. Critères : recharger une requête restaure exactement
les mêmes filtres. Estimation : S (1-2 j).

**Q1 — Historique des requêtes SQL exécutées**
Objectif : retrouver une requête tapée plus tôt. Spécification : table
dédiée `db_query_history` (même mécanisme que T1), écrite depuis
`db_run_query` (connexion, SQL, horodatage, succès/erreur — jamais le
résultat, potentiellement sensible) ; panneau dans `Databases.tsx`, clic
pour recharger dans l'éditeur sans exécuter. Critères : survit à un
redémarrage ; un échec reste marqué comme tel. Estimation : S (1-2 j).

**Q2 — Requêtes favorites**
Objectif : épingler une requête utile. Spécification :
`AppData.saved_db_queries: Vec<SavedDbQuery>`, CRUD standard, liste
déroulante dans l'éditeur SQL. Estimation : S (1 j).

**Q3 — Export CSV des résultats**
Objectif : sortir un résultat vers un tableur. Spécification : sérialisation
frontend pure de `QueryResult` en CSV (échappement RFC 4180), dialogue de
sauvegarde Tauri déjà utilisé ailleurs (`backup_export`). Tests : cas limites
d'échappement (virgules, guillemets, retours à la ligne). Estimation : S (1 j).

**W1 — Onglet web vers une URL quelconque**
Objectif : ouvrir Portainer, Grafana ou tout service en onglet embarqué, pas
seulement Proxmox/TrueNAS auto-détectés. Spécification :
`AppData.custom_web_tabs: Vec<WebTab>` (`#[serde(default)]`), CRUD ;
`webTargets()` fusionne cette liste (`kind: "Custom"`) ; formulaire
« Ajouter un onglet » dans `Dashboards.tsx` (titre + URL, validation
`http(s)://`, réutilise `integrations::validate_url`). Critères : un onglet
personnalisé persiste comme les onglets auto-détectés ; URL invalide
refusée avec message clair. Estimation : S (1-2 j).

**Z1 — Journal de sécurité (vue filtrée sur `EventLog`)**
Objectif : voir en un endroit ce qui a été supprimé/arrêté/restauré, sans
fouiller module par module. Spécification : commande `security_audit_log`
qui filtre `EventLog` (déjà alimenté par tous les modules) sur les actions
destructrices réussies (suppression, migration, restauration, arrêt forcé) ;
aucune nouvelle donnée collectée, uniquement une vue, dans Paramètres →
Sécurité. Critères : une restauration de sauvegarde et une migration de VM
apparaissent toutes deux, horodatées. Estimation : S/M (1-2 j).

**E1 — Export d'un thème seul**
Objectif : partager un thème personnalisé sans construire un manifeste à la
main. Spécification : bouton « Exporter » sur `ThemeCard` (thèmes
personnalisés) générant un `ExtensionManifest` minimal (un seul thème dans
`contributes.themes`), réutilise entièrement `validateManifest`. Critères :
le fichier exporté se réimporte sans erreur de validation. Estimation : S (1 j).

**G1 — Historique des sauvegardes automatiques**
Objectif : voir la liste des `.spmbackup` déjà écrits, pas seulement la
dernière exécution. Spécification : commande `list_auto_backups` qui relit
le dossier configuré et filtre avec `is_auto_file` (déjà présent pour la
rotation) ; petit tableau dans `BackupPanel.tsx`. Estimation : S (1 j).

#### Phase 2 — Fonctionnalités structurantes (M/L)

**X1 — Console VM/CT via lien noVNC**
Objectif : ouvrir la console d'une VM/CT sans quitter l'app. Spécification :
commande `proxmox_console_url(node, vmid, vm_type)` appelant
`POST /nodes/{node}/{type}/{vmid}/vncproxy` (ticket + port), URL
`/?console=...&vncticket=...` ouverte dans un onglet web (réutilise W1) ou
le navigateur externe. Critères : console fonctionnelle sur VM active ;
message clair si VM arrêtée. Estimation : M (2-3 j).

**X2/B2 — Statut Proxmox Backup Server**
Objectif : exploiter enfin l'intégration PBS déjà déclarée mais inutilisée.
Spécification : client minimal (`proxmox/pbs.rs`) sur
`/status/datastore-usage` et `/admin/datastore/{store}/snapshots` ; carte
dédiée dans `Backups.tsx` quand PBS est configuré et testé. Critères : la
carte n'apparaît que si l'intégration est active ; une erreur PBS ne casse
pas le reste de la page. Estimation : M (3-4 j).

**H1 — Vue calendrier du Planificateur**
Objectif : visualiser les créneaux de la semaine d'un coup d'œil.
Spécification : composant frontend pur (grille 7 jours), lisant les
`Schedule` existants, aucune commande Rust nouvelle. Estimation : M (2-3 j).

**H2 — Historique des exécutions planifiées**
Objectif : savoir si un Wake/Shutdown/Reboot planifié a eu lieu.
Spécification : réutilise l'infrastructure de T1 (`schedule_runs`), écrite
depuis `scheduler.rs` à l'exécution effective. Estimation : M (2 j), après T1.

**L2 — Alertes sur logs**
Objectif : être notifié quand un motif d'erreur apparaît, sans surveiller la
page. Dépend de L1. Spécification : `AppData.log_alerts` (requête + seuil +
cooldown), évalué par le même minuteur que les sondes (`probes.rs`), alerte
via le moteur existant au dépassement. Critères : un pic déclenche une
alerte, respecte le cooldown ensuite. Estimation : M (3 j).

**W2 — Vérification de santé des onglets web**
Objectif : voir quels services sont up/down. Dépend de W1. Spécification :
réutilise `probes.rs` sur l'URL de chaque onglet, badge dans
`TargetPicker`. Estimation : M (2 j).

**Q4 — Plan d'exécution (EXPLAIN)**
Objectif : diagnostiquer une requête lente. Spécification : bouton
préfixant la requête par `EXPLAIN` (par défaut, inoffensif) ou
`EXPLAIN ANALYZE` (case séparée, avertissement — exécute réellement),
affichage réutilisant `QueryResult`. Estimation : S/M (1-2 j).

**G2 — Vérification post-sauvegarde automatique**
Objectif : détecter une sauvegarde corrompue dès l'écriture. Spécification :
dans `run_auto`, après `write_atomic`, relire le fichier et appeler
`backup::open` avec la phrase déjà en mémoire ; échec → `last_error` et
alerte `Failure` au lieu d'un faux succès. Tests : corruption simulée par
troncature post-écriture. Estimation : S (1 j).

#### Phase 3 — Plus tard / nécessite une décision produit

| Fonctionnalité | Pourquoi plus tard |
|---|---|
| K3 — Exec shell dans un conteneur | Dépend de la refonte du terminal (doc Console, M2) : à coordonner, pas dupliquer. |
| K4 — Détection d'image via registre distant | Élargit la surface réseau sortante (appels vers des registres tiers) : décision produit sur l'opt-in avant l'effort. |
| B1 — Restauration de VM/CT depuis l'app | Opération destructive à fort impact (écrase potentiellement une VM) ; garde-fous UX avant vitesse de livraison. |
| T3 — Approbation avant exécution sur cibles sensibles | Nécessite une notion de « serveur sensible » dans le modèle : à valider avec le produit. |
| H3 — Tâches en lot planifiées (au-delà de l'alimentation) | Dépend de T1 livré et stable, pour ne pas planifier des échecs invisibles. |
| U3 — Application optionnelle des mises à jour de sécurité | Risque de casse : après retour d'usage sur U1/U2. |
| L3 — Vrai live tail WebSocket | Le re-sondage 5 s couvre l'essentiel de l'usage homelab ; gain marginal pour l'effort. |
| Q5 — Tunnel SSH temporaire pour client GUI externe | Changerait la posture « rien n'écoute » pour un besoin déjà couvert par l'exécution directe SSH. |
| E2 — Registre d'extensions communautaire | Suppose un service hébergé (modération, disponibilité) hors périmètre actuel. |
| Z2 — Export du coffre de clés SSH au format standard | Le `.spmbackup` couvre déjà la portabilité, plus sûrement ; risque d'exposition en clair sur disque. |
| G3 — Sauvegarde automatique vers stockage distant (S3/WebDAV) | Élargit la surface de secrets pour un gain marginal (un outil de synchro tiers couvre déjà le besoin). |

### 3.2 Directives d'expérience utilisateur

- **Docker** : la pause/reprise (K2) garde la palette `STATE_COLOR`
  existante ; le suivi de logs (K1) reste dans `LogsModal`, avec un
  indicateur « tail figé » vs « suivi actif » (point clignotant, comme le
  `Radio` de Logs.tsx).
- **Proxmox** : l'ouverture de console (X1) exige un clic explicite sur
  l'icône dédiée (jamais sur la ligne, qui ouvre déjà le détail) ; bouton
  désactivé si la VM est arrêtée, plutôt qu'une erreur après coup.
- **Sauvegardes** : une alerte de sauvegarde en retard cite le nom de la
  VM/CT et l'âge exact de la dernière archive, jamais un message générique.
- **Tâches en lot** : historique (T1) et « Relancer les échecs » (T2)
  vivent dans le même onglet que l'exécution, pas une page séparée.
- **Planificateur** : la vue calendrier (H1) reste une lecture d'appoint ;
  l'édition continue de se faire dans le formulaire actuel.
- **Mises à jour** : toute action qui installe réellement (U3, plus tard)
  est visuellement isolée (couleur d'avertissement) ; la page reste par
  défaut un tableau de bord de lecture seule.
- **Logs** : les requêtes sauvegardées (L1) sont triées par usage récent,
  pas alphabétique.
- **Bases de données** : l'historique (Q1) ne réaffiche jamais
  automatiquement un résultat passé — seulement le SQL ; rejouer reste un
  clic explicite sur *Exécuter*.
- **Onglets web** : un onglet personnalisé (W1) est visuellement distinct
  des onglets auto-détectés (icône générique de globe vs. icône du
  service).
- **Sécurité** : le journal (Z1) s'ouvre en lecture seule stricte, aucune
  action possible depuis ses lignes.
- **Extensions** : l'export de thème (E1) précise qu'il génère un
  mini-manifeste d'extension, pas un format de thème dédié.
- **Paramètres** : l'historique des sauvegardes (G1) affiche un état
  « vérifiée »/« non vérifiée » une fois G2 livré, plutôt que de laisser
  croire que tout fichier listé est utilisable.

---

## 4. Risques et points de vigilance

- **Secrets dans les nouveaux historiques** (T1, Q1) : un script ou une
  requête peut contenir un secret tapé par erreur ; documenter que
  l'historique n'est pas un coffre, ne jamais l'inclure dans le
  `.spmbackup` sans le même chiffrement que le reste.
- **Surface réseau sortante élargie** (K4, import d'extension par URL) :
  chaque nouvel appel vers un tiers doit rester désactivable et déclenché
  par une action explicite, jamais automatique dès le premier lancement.
- **Opérations destructives à distance** (B1, U3, futur pare-feu en
  écriture) : même règle commune du projet — confirmation forte, jamais en
  tâche de fond, jamais par défaut — sans exception pour ces items Phase 3.
- **Cohérence des historiques** (T1, H2, Q1) avec l'historique de métriques
  déjà existant (`db.rs`, rétention/purge en place) : réutiliser la même
  base plutôt que d'en créer une troisième.
- **Mises à jour multi-famille** (U1) : chaque distribution a ses
  subtilités de sortie non couvertes par les tests actuels (`apt` seul) ;
  déploiement une famille à la fois, testée sur cible réelle avant la
  suivante.
- **Webviews natives pour URL arbitraires** (W1) : vérifier explicitement
  qu'un onglet personnalisé ne peut pas accéder aux API `invoke` de l'app
  (réservées à la fenêtre principale, jamais aux webviews d'onglets).
- **PBS exploité pour la première fois** (X2/B2) : documenter le rôle API
  minimal (lecture seule) plutôt que de demander un jeton plus large que
  nécessaire par défaut.

---

## 5. Sources

- Docker : Portainer (portainer.io), Dockge (dockge.org), Komodo
  (getkomo.do), Yacht (github.com/SelfhostedPro/Yacht), Dozzle (dozzle.dev),
  Watchtower (containrrr.dev/watchtower), Diun (crazymax.dev/diun), What's
  Up Docker (getwud.github.io/wud).
- Proxmox : Proxmox VE / Backup Server (proxmox.com), ProxMenux
  (proxmenux.com).
- Sauvegardes : Veeam CE (veeam.com), Duplicati (duplicati.com), Restic
  (restic.net), Kopia (kopia.io), UrBackup (urbackup.org).
- Automatisation : Ansible AWX (docs.ansible.com/projects/awx), Semaphore UI
  (semaphoreui.com), Rundeck (docs.rundeck.com), Cronicle (cronicle.net),
  crontab-ui (github.com/alseambusher/crontab-ui).
- Mises à jour : Canonical Landscape (ubuntu.com/landscape), Action1
  (action1.com), unattended-upgrades et dnf-automatic (docs Ubuntu/dnf).
- Logs : Grafana Loki (grafana.com/oss/loki), Graylog (graylog.org), Better
  Stack (betterstack.com).
- Bases de données : DBeaver (dbeaver.com/edition), TablePlus
  (tableplus.com), Beekeeper Studio (beekeeperstudio.io), pgAdmin
  (pgadmin.org), phpMyAdmin (phpmyadmin.net), Adminer (adminer.org),
  HeidiSQL (heidisql.com).
- Onglets web / dashboards : Homepage (gethomepage.dev), Homarr
  (homarr.dev), Heimdall (awesome-homelab.com), Dashy (dashy.to).
- Sécurité : KeePassXC (keepassxc.org), Bitwarden (bitwarden.com),
  1Password SSH Agent (1password.com/blog/1password-ssh-agent), Remote
  Desktop Manager (devolutions.net).
- Extensions : Tabby plugins (deepwiki.com/Eugeny/tabby), Raycast Extensions
  Store (developers.raycast.com).
- Notes de recherche source (deux analystes, collecte du 27/09/2026, dans
  le scratchpad de cette session) : `docker-proxmox-sauvegardes.md`,
  `automatisation-mises-a-jour-logs.md`,
  `bdd-tableaux-securite-extensions.md` — plusieurs affirmations y sont
  marquées « non vérifié » par les analystes eux-mêmes ; elles n'ont pas
  été reprises telles quelles ci-dessus sans recoupement.
- Code de l'application, branche `Test-Neoofix`, v0.5.0 beta : fichiers
  cités en tête de chaque sous-section de la partie 0.
