# Benchmark et plan d'intégration native

> Périmètre : Console SSH (terminal + explorateur SFTP) en priorité, puis les
> autres modules (Docker, monitoring, alertes, batch, réseau, bases de
> données…). Comparaison avec MobaXterm, Termius, Royal TS/TSX, SecureCRT,
> Xshell/Xmanager, les terminaux modernes (Tabby, WindTerm, Warp, Windows
> Terminal, Wave, Electerm) et les outils de gestion de homelab (Cockpit,
> Portainer, Uptime Kuma, Netdata, Beszel, Dockge, Semaphore UI, Remote
> Desktop Manager…). Toute fonctionnalité de l'app actuelle citée ci-dessous a
> été vérifiée dans le code (branche `Test-Neoofix`, v0.5.0), pas supposée.

## 0. Ce que l'app fait déjà (inventaire de référence)

Avant de comparer, un état des lieux précis de la Console et des modules
voisins, établi à la lecture du code plutôt que de la documentation seule.

**Console SSH** (`src/pages/Console.tsx`, `src/components/TerminalView.tsx`) :
- Terminal `@xterm/xterm` (v6) avec seul l'addon `@xterm/addon-fit` chargé —
  **aucun** `xterm-addon-search`, `xterm-addon-web-links`, `xterm-addon-unicode11`
  ou `xterm-addon-clipboard` dans `package.json`. Pas de recherche, pas de
  liens cliquables, pas de presse-papiers enrichi aujourd'hui.
- Un onglet par session SSH, toutes montées en même temps (`display:none` sur
  les inactives) pour garder le scrollback ; `scrollback: 5000` lignes fixes.
- Reconnexion **manuelle uniquement** : bouton *Reconnecter* qui incrémente
  `session.attempt` et relance `terminal_open`. Aucun keepalive ni
  reconnexion automatique côté Rust (`src-tauri/src/commands/terminal.rs`,
  `client::Config::default()` sans intervalle de keepalive) ni côté frontend.
- Un seul terminal visible à la fois par onglet : pas de split pane.
- Pas de multi-exécution / broadcast : chaque `terminal_write` cible une
  session précise (`sessionId`), rien n'envoie à plusieurs sessions.
- Snippets (`SnippetMenu.tsx`) : liste de commandes mémorisées, **insérées**
  (pas exécutées) dans le terminal actif ; pas de variables, pas d'historique
  de commandes recherchable.
- Aucune coloration de mots-clés, aucune barre de monitoring sous le
  terminal, aucune journalisation de session.

**Explorateur SFTP** (`src/components/FileExplorerPanel.tsx`,
`src-tauri/src/commands/sftp.rs`, `src-tauri/src/sftp.rs`) :
- Navigation complète (précédent/suivant/parent/racine, fil d'Ariane, chemin
  éditable, filtre, fichiers cachés), aperçu/édition de texte (1 Mio max),
  upload/download avec barre de progression (`Channel<SftpProgress>`),
  créer/renommer/supprimer (confirmation forte sur un dossier non vide),
  copier le chemin.
- « Ouvrir ici dans le terminal » : envoie un `cd '<chemin>'` (non exécuté
  automatiquement — en fait si, il tape la commande dans le terminal actif,
  cf. `cdCommand`) — **fonctionne dans un seul sens** (explorateur → terminal).
  Rien ne fait l'inverse : le panneau **ne suit pas** le répertoire courant
  du terminal quand on tape `cd` à la main.
- Pas de glisser-déposer de fichiers Windows → explorateur (upload passe
  uniquement par la boîte de dialogue `openDialog`).
- Utilise la même session SSH que la console (mêmes identifiants, même TOFU,
  même hôte de rebond).

**SSH générique** (`src-tauri/src/ssh_auth.rs`, `src-tauri/src/commands/ssh.rs`,
`src-tauri/src/known_hosts.rs`) — déjà solide :
- **Hôte de rebond (ProxyJump) à un niveau**, avec vérification TOFU de
  chaque saut sous sa propre identité, détection de cycle et de double
  rebond (`check_jump`). C'est déjà l'équivalent de la passerelle SSH de
  MobaXterm/Xmanager, sans interface graphique de tunnels arbitraires.
- Authentification mot de passe **ou** clé privée gérée par l'app (Ed25519,
  RSA avec négociation `server-sig-algs`), génération et déploiement de clé
  (`ssh_keys_cmd`), **import de clés `.ppk` PuTTY** déjà supporté
  (`src-tauri/src/ppk.rs`, avec bornage des paramètres Argon2 contre un
  fichier piégé) — mais uniquement la clé, pas les sessions PuTTY.
- TOFU avec message d'erreur explicite en cas de changement de clé d'hôte
  (attaque possible), et bouton pour « oublier » l'empreinte après
  réinstallation légitime.
- Secrets chiffrés (AES-256-GCM), jamais en clair dans les logs `Debug`.

**Autres modules pertinents pour le benchmark** (lus dans `src/pages/`,
`src-tauri/src/commands/`, `docs/guide/fonctionnalites.md`) :
- **Wake-on-LAN + Lab Power** (`lab_power.rs`) : plan d'extinction/démarrage
  ordonné d'un labo entier (dépendances entre machines et invités Proxmox) —
  **aucun concurrent étudié n'offre ça**, c'est un différenciateur fort.
- **Proxmox** : santé de cluster, VM/CT, snapshots, migration à chaud,
  vidage de nœud (drain) — largement au-delà de ce que fait MobaXterm/Termius
  (qui n'ont pas d'intégration Proxmox native) et comparable à un usage
  Cockpit + interface web Proxmox combinées.
- **Smart Batch** : détection d'OS multi-famille et résolution de gabarits
  `{{pkg_update}}`/`{{#if debian}}` par cible — une automatisation plus fine
  que le simple *Send to All* de MobaXterm/Xshell.
- **Bases de données** : détection MySQL/PostgreSQL/Redis, éditeur SQL en
  lecture seule par défaut, sauvegardes `mysqldump`/`pg_dump` — sans jamais
  ouvrir de port, tout par SSH.
- **Alertes** multi-canal (ntfy, Discord, Telegram) avec cooldown, sondes
  HTTP/TCP-like (`probes_cmd`), historique SQLite avec rétention agrégée —
  proche d'un Uptime Kuma allégé mais **sans monitoring HTTP/DNS/mots-clés
  générique** ni page de statut publique.
- Modules optionnels (`src/utils/modules.ts`) : power, resources, console,
  history, alerts (essentiels) + network, docker, databases, batch, updates,
  logs, scheduler, proxmox, web (désactivables).
- Raccourcis clavier (`src/utils/shortcuts.ts`) déjà pris : `Ctrl+K` palette,
  `Échap`, `?` aide, `/` recherche de page, `Ctrl+Maj+L` verrouillage,
  `g` puis `d/s/c/p` navigation. **`Ctrl+Maj+F` est libre**, tout comme
  `Ctrl+B` (split), `Ctrl+D` (dupliquer un pane) — vérifié par absence dans
  `SHORTCUTS`.

---

## 1. Benchmark des solutions existantes

### Modèles de prix

> Prix et éditions relevés en ligne le 27/09/2026 par une collecte automatisée : indicatifs, à revérifier avant toute communication publique.

| Produit | Modèle | Prix indicatif |
|---|---|---|
| MobaXterm | Freemium (Home gratuite / Pro payante) | Pro : 69 USD / 49 € par utilisateur, licence à vie |
| Termius | Freemium par paliers | Pro 10 USD/mois, Team 20 USD/util./mois, Business 30 USD/util./mois |
| Royal TS/TSX | Shareware + licence unique | Gratuit ≤10 connexions ; licence perso ≈59 USD unique ; Royal Server en tarif commercial |
| SecureCRT | Commercial (licence classique) | Tarif exact non communiqué dans les sources consultées |
| Xshell / Xmanager | Gratuit non-commercial / payant commercial | Xshell 99-119 USD, Xmanager (Power Suite) 249 USD, one-time |
| Tabby / WindTerm / Windows Terminal / Wave / Electerm | Open source | Gratuit (MIT/Apache 2.0) |
| Warp | Freemium | Gratuit puis Build 20 USD/mois, Max 200 USD/mois, Business 50 USD/util./mois |
| Cockpit / Uptime Kuma / Dockge | Open source | Gratuit |
| Portainer | Freemium | CE gratuite, BE à partir de 5 USD/nœud/mois |
| Netdata | Freemium | Community gratuite ≤5 nœuds, Homelab 90 USD/an nœuds illimités |
| Remote Desktop Manager (Devolutions) | Freemium | Free perso gratuite, Team à partir de 25-30 USD/util./mois |
| **Server Power Manager** | Application native locale | — (hors périmètre de ce document) |

### Tableau comparatif exhaustif

Légende : ✅ disponible · 💰 payant/édition supérieure · ➖ partiel/limité · ❌ absent.

#### Sessions & protocoles

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| SSH mot de passe + clé | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (Cockpit) | ✅ |
| RDP / VNC / XDMCP intégrés | ✅ | ❌ | ✅ | Xmanager ✅ | ❌ | ➖ (RDM) | ❌ |
| Telnet / Rlogin / Mosh / Série | ✅ | ➖ (Mosh) | Telnet ✅ | Telnet ✅ | WindTerm ✅ (Serial) | ❌ | ❌ |
| Shell local / WSL | ✅ | ❌ | ❌ | ❌ | ✅ (WinTerm/Tabby) | ❌ | ❌ (hors périmètre desktop) |
| Jump host / ProxyJump | ✅ | ✅ (chaînage) | ➖ (Secure Gateway payant) | — | WindTerm ✅ | ✅ (Cockpit ajout SSH) | ✅ **déjà natif, 1 niveau, TOFU par saut** |
| Import PuTTY/registre/config SSH | ✅ (export/import sessions) | ➖ | ➖ | — | — | ❌ | ➖ **clé `.ppk` seule, pas les sessions** |

#### Terminal

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Recherche dans le scrollback | ✅ | ➖ | ➖ | ✅ | Warp ✅ (Ctrl+R unifié) | ❌ | ❌ |
| Liens cliquables (URL/chemins) | ✅ | ➖ | ➖ | ➖ | Tabby/Wave ✅ | ❌ | ❌ |
| Coloration de mots-clés | ✅ | ❌ | ❌ | ✅ (INI Cisco) | Xshell ✅ (Highlight Sets) | ❌ | ❌ |
| Split panes / multi-terminaux | ✅ (2x1, 2x2) | ❌ | ❌ | — | ✅ (Tabby, WinTerm) | ❌ | ❌ |
| Multi-exécution / broadcast | ✅ | ❌ | Key Sequence Tasks ✅ | ✅ (Chat window) | WindTerm/Wave ➖ | ❌ | ❌ |
| Reconnexion auto + keepalive | ➖ | ➖ | ➖ | ➖ | Wave ✅ (sessions durables) | ❌ | ❌ **manuel uniquement** |
| Journalisation de session | ✅ | ✅ (Pro+) | ➖ | ✅ | ➖ | ❌ | ❌ |
| Compose bar / saisie multi-ligne | ➖ | ➖ | ➖ | Xshell ✅ | Warp ✅ (Blocks) | ❌ | ❌ |
| Palette de commandes / recherche unifiée | ➖ | ➖ | ➖ | ➖ | Warp/WinTerm ✅ | ❌ | ➖ (palette globale `Ctrl+K`, pas de contexte terminal) |
| Notifications fin de commande longue | ❌ | ❌ | ❌ | ❌ | Tabby ✅ (détection de progression) | ❌ | ❌ |

#### Transfert de fichiers

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Navigateur SFTP graphique | ✅ | ✅ | ➖ | — | Tabby ✅ | Dockge (terminal web, pas SFTP) | ✅ |
| SFTP suit le répertoire du terminal | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ **un seul sens (panneau→terminal : « Ouvrir ici dans le terminal »)** |
| Glisser-déposer Windows ↔ serveur | ✅ | ➖ | ➖ | ➖ | ➖ | ❌ | ❌ (boîte de dialogue uniquement) |
| Édition de fichier distant | ✅ (MobaTextEditor) | ➖ | ❌ | ❌ | Wave ✅ | ❌ | ✅ (aperçu/édition texte 1 Mio) |
| Progression de transfert | ✅ | ✅ | — | — | — | ❌ | ✅ |

#### Organisation des connexions

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Dossiers / arborescence | ✅ | ✅ (groupes) | ✅ (documents) | ➖ | ✅ | Homarr/Homepage (dashboards) | ✅ (dossiers + tags + favoris) |
| Recherche/filtre de serveurs | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ (nom/IP/OS/notes/tag/champ perso) |
| Champs personnalisés | ➖ | ➖ | ✅ (credentials liés) | — | ➖ | ➖ | ✅ |
| Import/export de sessions | ✅ (XML) | ✅ (vault) | ✅ (documents) | — | ➖ | ➖ | ➖ (export config complet chiffré `.spmbackup`, pas de session par session) |
| Icônes personnalisées | ➖ | ➖ | ➖ | — | ➖ | Homarr ✅ (widgets) | ✅ (bibliothèque Lucide + import image) |

#### Automatisation

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Macros enregistrées | ✅ (4 max en Home) | ❌ | Key Sequence Tasks ✅ | ✅ (scripting) | ❌ | Semaphore/Rundeck ✅ (jobs) | ➖ (snippets = insertion simple, pas de séquence enregistrée) |
| Scripting avancé (langage) | ➖ | ❌ | ➖ (Command Tasks PowerShell) | ✅ (VBScript/JS/Python) | ❌ | ✅ (Ansible/Terraform/PowerShell) | ✅ **Smart Batch (gabarits par OS) + Ansible + scripts en lot** |
| Planification (cron-like) | ➖ (daemons limités en Home) | ❌ | ❌ | ❌ | ❌ | ✅ (Semaphore, Rundeck) | ✅ (planificateur natif + mode cron serveur) |
| Snippets avec variables | ❌ | ✅ (basique) | ❌ | ❌ | ❌ | ❌ | ❌ (nom + commande figée) |

#### Sécurité & secrets

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Coffre chiffré local | ✅ (master password) | ✅ | ✅ (documents chiffrés) | — | ✅ (Tabby Vault) | Semaphore (vault) / RDM ✅ | ✅ (AES-256-GCM + mot de passe maître Argon2id optionnel) |
| Verrouillage app (PIN/biométrie) | ❌ | ✅ (Touch/Face ID) | ❌ | ❌ | ❌ | ❌ | ✅ (PIN, Windows Hello) |
| TOFU / vérification clé d'hôte | ✅ (implicite SSH) | ✅ | — | ✅ | ✅ | — | ✅ **avec message explicite anti-usurpation** |
| Audit / RBAC équipe | ❌ | ➖ (Team) | ➖ (partage credentials) | ❌ | ❌ | ✅ (Portainer BE, Semaphore, RDM Team) | ➖ (mono-utilisateur, historique local) |

#### Réseau & tunnels

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Tunnels SSH GUI (local/distant/SOCKS) | ✅ (MobaSSHTunnel) | ✅ | ✅ (Secure Gateway) | ➖ | Tabby/WindTerm ✅ | ❌ | ❌ (pas d'UI de tunnel, seulement le rebond fixe) |
| Scanner réseau / topologie | ✅ (Port Scanner) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **vue graphe façon Obsidian, unique dans le comparatif** |
| Wake-on-LAN | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ **absent chez tous les concurrents étudiés** |
| X11 forwarding / serveur X | ✅ | ❌ | ❌ | Xmanager ✅ | ❌ | ❌ | ❌ (hors périmètre, cf. §2) |

#### Supervision

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Barre de monitoring sous le terminal | ✅ (CPU/RAM/disque/réseau) | ❌ | ❌ | ❌ | Wave (widget sysinfo séparé) | ❌ | ❌ (page Ressources séparée, pas sous le terminal) |
| Monitoring HTTP/TCP/DNS générique | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Uptime Kuma) | ➖ (sondes existantes, périmètre à vérifier §3) |
| Anomalies / ML | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Netdata) | ❌ |
| Historique de métriques | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Netdata, Beszel) | ✅ (SQLite, rétention configurable) |
| Page de statut publique | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Uptime Kuma) | ❌ |

#### Collaboration

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Coffre partagé équipe | ❌ | ✅ (Team) | ✅ (partage credentials) | ❌ | ❌ | ✅ (RDM Team, Portainer BE) | ❌ (app mono-poste) |
| Sessions partagées / multiplayer | ❌ | ✅ (Team) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Workflows d'équipe | ❌ | ❌ | ❌ | ❌ | Warp ✅ (Build+) | ✅ (Semaphore, Rundeck) | ❌ |

#### Personnalisation

| Fonctionnalité | MobaXterm | Termius | Royal TS | SecureCRT/Xshell | Tabby/Warp/WinTerm/Wave | Outils serveurs | **SPM aujourd'hui** |
|---|---|---|---|---|---|---|---|
| Thèmes clair/sombre | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (+ thèmes personnalisés enregistrables) |
| Polices personnalisées | ✅ | ➖ | ➖ | ✅ | ✅ | — | ➖ (police fixe Cascadia Mono, pas de réglage utilisateur) |
| Widgets/dashboard personnalisable | ❌ | ❌ | ❌ | ❌ | Wave ✅ | Homarr ✅ (drag-and-drop) | ❌ |

---

## 2. Analyse de faisabilité native

Barème : **valeur utilisateur** 1-5 (5 = très demandé/différenciant),
**effort** S (<1 jour) / M (2-5 jours) / L (1-3 semaines) / XL (>3 semaines,
souvent une réécriture d'architecture).

### 2.1 Console — priorité 1

| Fonctionnalité | Valeur | Effort | Faisabilité technique (stack SPM) | Sécurité | Verdict |
|---|---|---|---|---|---|
| Recherche dans le terminal (`Ctrl+Maj+F`) | 5 | S | `xterm-addon-search` officiel, déjà compatible xterm 6 ; overlay React au-dessus du `<div>` du terminal | Aucun risque, recherche locale au buffer | ✅ Intégrer (Phase 1) |
| Liens cliquables (URL, chemins) | 4 | S | `xterm-addon-web-links` (URL) ; un addon maison ou un `registerLinkProvider` pour les chemins absolus (`/…`) qui invoque `openInTerminal`-like vers l'explorateur | Ouvrir une URL doit passer par `open_external_url` (déjà validé côté Rust) — ne jamais ouvrir un lien arbitraire sans cette validation | ✅ Intégrer (Phase 1) |
| Reconnexion auto + keepalive | 5 | M | Keepalive : `russh::client::Config { keepalive_interval, keepalive_max, .. }` (russh 0.63 le supporte) pour détecter une coupure sans attendre le TCP timeout OS. Reconnexion : côté frontend, sur `closedReason` réseau (pas sur fermeture volontaire ni erreur d'auth), relancer automatiquement avec backoff (1s, 2s, 5s, max 3 essais) puis proposer le bouton manuel | Ne jamais relancer avec un mot de passe qui a échoué (éviter le blocage par tentatives) ; ne reconnecter que sur erreur réseau distinguée d'un rejet d'authentification | ✅ Intégrer (Phase 1) |
| Multi-exécution / broadcast vers plusieurs onglets | 4 | M | Nouvel état `broadcastGroup: string[]` dans le store zustand ; `onData` du terminal source republie vers `terminal_write` de chaque session du groupe ; **aucune** nouvelle commande Rust nécessaire (`terminal_write` déjà par session) | Risque élevé d'erreur destructive (ex. `rm -rf` propagé) : bandeau rouge visible en permanence quand un broadcast est actif + confirmation à l'activation, jamais d'activation silencieuse | ✅ Intégrer (Phase 2) — avec garde-fous UX (§3.2) |
| Split panes | 3 | M | CSS grid dans `TerminalView`/`Console.tsx` : un onglet peut porter 1-4 `TerminalView` simultanément, chacun avec son propre `sessionIdRef` ; réutilise le mécanisme de session existant, pas de nouvelle commande Rust | Aucun risque particulier | ✅ Intégrer (Phase 2) |
| Barre de monitoring sous le terminal | 4 | S/M | `get_server_metrics` existe déjà (CPU/RAM/disques) ; il suffit d'un composant qui l'interroge à l'intervalle déjà réglé dans Paramètres → Réseau et l'affiche sous le terminal actif — pas de nouvelle commande Rust, juste du frontend | Aucun (lecture seule, déjà utilisée ailleurs) | ✅ Intégrer (Phase 1) |
| SFTP qui suit le répertoire courant du terminal | 4 | L | Deux mécanismes possibles : **(a)** OSC 7 (`\e]7;file://host/path\a`) émis par un hook shell opt-in injecté au login (`PROMPT_COMMAND`/`precmd`) — fiable mais modifie le profil shell distant, donc **opt-in explicite par serveur** et réversible ; **(b)** poller `pwd` toutes les N secondes via une commande SSH annexe — plus intrusif (bruit dans l'historique shell, canal SSH séparé) et moins réactif. **Choix retenu : OSC 7 opt-in**, avec repli silencieux si la séquence n'apparaît jamais (l'utilisateur n'a pas activé le hook) | L'injection de shell distant doit être clairement documentée et désactivable ; ne jamais l'activer sans action explicite de l'utilisateur (modifie `.bashrc`/`.zshrc`) | 🟡 Plus tard (Phase 3) — valeur réelle mais dépendance shell distant à documenter avec soin |
| Glisser-déposer de fichiers vers l'explorateur | 3 | M | API drag & drop HTML5 sur `FileExplorerPanel` (Tauri v2 expose les chemins de fichiers déposés via `webview::on_drag_drop_event` ou l'évènement `tauri://drag-drop`) → appelle `sftp_upload` existant | Valider que le chemin déposé reste un fichier local légitime avant `sftp_upload` (déjà fait côté commande) | ✅ Intégrer (Phase 2) |
| Tunnels SSH GUI (local/distant/dynamique SOCKS) | 4 | L | russh expose déjà `channel_open_direct_tcpip` (rebond) ; un tunnel local demande d'écouter un port local (`tokio::net::TcpListener`) et de relayer chaque connexion vers `channel_open_direct_tcpip` ; un SOCKS dynamique demande un mini-serveur SOCKS5 local (crate `fast-socks5` ou implémentation minimale) qui ouvre un canal par connexion ; un tunnel distant utilise `tcpip_forward` (déjà dans l'API russh client, à vérifier côté serveur distant qui doit l'accepter) | Ouvrir un port local = surface d'attaque locale ; borner l'écoute à `127.0.0.1` par défaut, jamais `0.0.0.0` sans confirmation explicite | ✅ Intégrer (Phase 2) — definitions persistantes par serveur |
| Journalisation des sessions (opt-in) | 3 | M | Écrire chaque `ArrayBuffer` reçu (avant rendu xterm) dans un fichier local horodaté si l'option est activée pour le serveur ; **rédaction des secrets** : appliquer les mêmes règles de masquage que les logs internes de l'app (mots de passe jamais affichés, mais un log de *sortie* de commande peut quand même contenir des secrets tapés par l'utilisateur — avertir clairement) | Journaux en clair sur disque = risque si la machine est partagée ; chiffrer avec la même clé maître si un mot de passe maître est actif, ou au minimum stocker sous le dossier de données protégé par les permissions Windows | ✅ Intégrer (Phase 2) — opt-in par défaut désactivé |
| Coloration de mots-clés (error/warning/ok) | 3 | M | Aucun addon officiel équivalent : implémentation par un `parser.registerCsiHandler`/post-traitement des lignes avant écriture, ou plus simple, un `Terminal.registerDecorationProvider` sur les lignes correspondant à des regex configurables (error/warn/ok) | Aucun risque, mais attention performance sur un flux très verbeux (limiter le nombre de règles actives) | ✅ Intégrer (Phase 2) — jeu de regex par défaut + personnalisable |
| Compose bar / saisie multi-ligne | 3 | S/M | Un `<textarea>` au-dessus du terminal, envoyé ligne par ligne (ou en bloc) via `terminal_write` à l'appui d'un raccourci ; utile aussi comme brique du broadcast (composer une fois, envoyer à plusieurs) | Aucun risque particulier ; même bandeau rouge que le broadcast si plusieurs cibles | ✅ Intégrer (Phase 1, version simple) |
| Snippets avec variables | 3 | S | Étendre `Snippet { name, command }` avec des `{{placeholders}}` résolus par un petit formulaire avant insertion (même principe que les gabarits Smart Batch déjà existants — réutiliser le moteur de résolution `{{...}}` du batch si possible) | Aucun | ✅ Intégrer (Phase 1) |
| Historique de commandes recherchable | 4 | M | Capturer les lignes tapées avant `Entrée` (déjà transitent par `onData`) et les stocker par serveur (SQLite, table dédiée) ; UI de recherche façon `Ctrl+R`, à ne pas confondre avec l'historique shell distant (`~/.bash_history`) qui reste indépendant | Peut contenir des données sensibles tapées par erreur (mots de passe en clair) : ne pas l'activer par défaut sans avertissement, offrir un bouton de purge | 🟡 Plus tard (Phase 3) — valeur haute mais délicat côté vie privée |
| Restauration des sessions au démarrage | 3 | M | Persister `terminalSessions` (server_id, pas les identifiants) et rouvrir automatiquement au lancement de l'app (avec le même flux `openTerminal`) ; ne jamais restaurer une authentification, seulement rouvrir l'onglet et attendre l'action de connexion ou reconnecter directement puisque les identifiants sont déjà stockés côté app | Comportement à rendre configurable : un utilisateur peut préférer ne pas se reconnecter automatiquement à tout au démarrage | ✅ Intégrer (Phase 2) |
| Import de sessions (PuTTY registre / MobaXterm .mxtsessions / ~/.ssh/config) | 3 | M | Trois formats différents : registre Windows PuTTY (`HKCU\Software\SimonTatham\PuTTY\Sessions`, lecture via `winreg`), `.mxtsessions` (format INI documenté), `~/.ssh/config` (parseur simple `Host/HostName/User/Port/ProxyJump`). Le plus simple et le plus utile en premier : **`~/.ssh/config`** (format ouvert, standard, pas de dépendance Windows) | Ne jamais importer un mot de passe en clair depuis PuTTY (le registre ne les stocke pas de toute façon) ; clés privées référencées à copier dans le magasin de clés de l'app avec confirmation | 🟡 Plus tard (Phase 3) — commencer par `~/.ssh/config`, reste en option |
| Lancement RDP via `mstsc` avec identifiants | 3 | S | **Ne pas embarquer** de client RDP : lancer `mstsc.exe /v:<ip> /admin` (ou générer un `.rdp` temporaire avec l'utilisateur pré-rempli) via le même mécanisme que `open_external_url`/processus externe déjà utilisé pour le navigateur | Ne jamais passer le mot de passe en argument de ligne de commande (visible dans la liste de processus) : au mieux pré-remplir l'utilisateur, laisser Windows demander le mot de passe, ou utiliser `cmdkey` pour enregistrer temporairement la credential Windows puis la retirer | ✅ Intégrer (Phase 2) — lancement externe uniquement, jamais embarqué |
| Sessions série (COM) | 2 | L | Nécessiterait une dépendance série (`serialport` crate) totalement absente de la stack actuelle (l'app ne fait que du SSH/HTTP) ; usage homelab réel très marginal (pas de matériel série mentionné dans le projet) | Accès matériel bas niveau, périmètre différent de tout le reste de l'app | ❌ Hors périmètre — pas de demande homelab identifiée, coût d'intégration disproportionné |
| Notification de fin de commande longue | 3 | M | Heuristique : détecter un retour au prompt après un délai configurable (regex de prompt courant, ou simplement « aucune sortie depuis N secondes puis nouvelle activité ») + `tauri-plugin-notification` déjà présent dans `package.json` | Faux positifs possibles (heuristique de prompt) : présenter comme un « signal », pas une garantie | 🟡 Plus tard (Phase 3) |
| X11 forwarding / serveur X intégré | 2 | XL | Nécessiterait un serveur X complet côté Windows (VcXsrv/Xming embarqué ou réécrit) : hors de portée de la stack Rust/Tauri actuelle, projet à part entière | Surface d'attaque et complexité disproportionnées pour un module secondaire | ❌ Hors périmètre |
| RDP/VNC embarqués (rendu dans l'app) | 2 | XL | Un client RDP ou VNC dans une webview Tauri demanderait soit un composant natif Windows (ActiveX/`mstscax.dll`, difficile à intégrer proprement à une webview), soit une implémentation du protocole RDP/VNC en Rust (immense effort, sécurité critique) | Risque élevé si mal implémenté (canal chiffré RDP/VNC) | ❌ Hors périmètre — le lancement externe `mstsc` couvre le besoin à 80 % du coût |

### 2.2 Autres modules

| Fonctionnalité | Valeur | Effort | Faisabilité | Sécurité | Verdict |
|---|---|---|---|---|---|
| Monitoring HTTP(s)/TCP/DNS générique façon Uptime Kuma | 4 | M | `probes_cmd` existe déjà (`get_probes`, `run_probe_now`) — vérifier son périmètre exact avant de l'étendre ; si limité au ping, ajouter des types HTTP (code de réponse + mot-clé dans le corps), TCP (connexion simple) et DNS (résolution) est une extension naturelle du moteur de sondes existant | Aucun risque particulier, sondes sortantes uniquement | ✅ Intégrer (Phase 2, à confirmer avec l'état réel de `probes.rs`) |
| Page de statut publique | 2 | L | Nécessiterait un petit serveur web local exposé (hors du modèle actuel « appli desktop, rien n'écoute »ហ) : à réserver à un homelab qui veut exposer un statut à des tiers, cas d'usage minoritaire pour l'app actuelle | Ouvrir un port HTTP sur le poste Windows change la posture de sécurité de l'app (jusqu'ici purement cliente) | ❌ Hors périmètre — contraire au modèle « rien n'écoute » de l'app |
| Anomalies ML sur les métriques | 2 | XL | Nécessiterait un modèle ML embarqué ou un service externe ; disproportionné face à la volumétrie d'un homelab | — | ❌ Hors périmètre |
| Éditeur Docker Compose (façon Dockge) | 3 | M | `docker_cmd` gère déjà lister/agir/logs par conteneur ; un éditeur de fichier `compose.yaml` avec `docker compose up/down` par SSH est une extension raisonnable, réutilisant `execute_ssh_stream` déjà présent | Le contenu d'un compose peut exposer des secrets (variables d'env) : mêmes règles de masquage que les commandes SSH | 🟡 Plus tard (Phase 3) |
| RBAC / audit multi-utilisateur | 2 | XL | L'app est mono-poste, mono-utilisateur par conception (verrouillage local, pas de compte) ; un vrai RBAC demanderait un serveur central, changement d'architecture majeur | — | ❌ Hors périmètre — contraire à la philosophie desktop locale de l'app |
| Coffre partagé équipe / sessions multiplayer | 2 | XL | Même remarque : nécessiterait un backend central et de la synchro réseau, absent de l'architecture actuelle (SQLite + fichiers locaux chiffrés) | Un coffre partagé mal sécurisé serait un risque majeur | ❌ Hors périmètre pour cette version — à réévaluer seulement si un besoin multi-poste explicite apparaît |
| Import de sessions MobaXterm/PuTTY vers Serveurs | 3 | M | Cf. §2.1 (import `.ssh/config` prioritaire), pour les autres serveurs, pas seulement la console | — | 🟡 Plus tard (Phase 3) |

**Déjà mieux que la concurrence, à mettre en avant plutôt qu'à refaire :**
Wake-on-LAN et *Lab Power* (extinction/démarrage ordonné d'un labo entier,
absent de tous les outils étudiés), l'intégration Proxmox native
(snapshots, migration à chaud, vidage de nœud), le Smart Batch avec
gabarits multi-OS, la vue graphe réseau façon Obsidian avec détection
Wi-Fi/traceroute, et la gestion de bases de données sans jamais exposer de
port. Le plan ci-dessous ne cherche pas à les concurrencer mais à combler
l'écart sur la Console, qui reste le point le plus visible du comparatif.

---

## 3. Plan d'action d'intégration native

### 3.1 Feuille de route de développement

#### Phase 1 — Gains rapides sur la Console (S/M, forte valeur)

**C1 — Recherche dans le terminal**
- Objectif : retrouver du texte dans le scrollback actif sans quitter le clavier.
- Spécification : ajouter `@xterm/addon-search` en dépendance ; dans
  `TerminalView.tsx`, charger `SearchAddon` à la création du terminal ;
  overlay React (champ + suivant/précédent/compteur) monté dans
  `Console.tsx`, visible seulement pour l'onglet actif, ouvert par
  `Ctrl+Maj+F` (nouvelle entrée dans `SHORTCUTS`, contexte `page`,
  `inInputs: true` pour capter même le focus terminal).
- Dépendances : aucune commande Rust.
- Critères d'acceptation : `Ctrl+Maj+F` ouvre la recherche sur l'onglet
  actif seulement ; `Entrée`/`Maj+Entrée` navigue occurrence suivante/
  précédente ; `Échap` referme sans perdre le focus terminal.
- Tests : test de composant sur le matcher de raccourci (comme
  `shortcuts.test.ts` existant) ; test manuel visuel (pas de test xterm
  automatisé réaliste sans un buffer simulé).
- Estimation : S (0,5-1 jour).

**C2 — Liens cliquables**
- Objectif : ouvrir une URL du terminal dans le navigateur par défaut sans
  copier-coller.
- Spécification : `@xterm/addon-web-links` avec un `handler` personnalisé
  qui appelle **exclusivement** `invoke("open_external_url", { url })`
  (jamais `window.open` direct, pour garder la validation Rust déjà en
  place dans `external.rs`).
- Dépendances : aucune nouvelle commande Rust (réutilise
  `open_external_url`).
- Critères d'acceptation : un clic (Ctrl+clic pour éviter les faux
  positifs pendant la sélection de texte) sur une URL valide l'ouvre dans
  le navigateur système ; une URL malformée ne fait rien.
- Tests : test unitaire du handler (mock d'`invoke`), vérifier qu'aucune
  URL n'est ouverte sans passer par `open_external_url`.
- Estimation : S (0,5 jour).

**C3 — Reconnexion automatique + keepalive**
- Objectif : survivre à une coupure réseau brève sans intervention.
- Spécification technique :
  - Rust (`src-tauri/src/commands/terminal.rs`, `connect_ssh`) : configurer
    `client::Config { keepalive_interval: Some(Duration::from_secs(15)), keepalive_max: 3, ..Default::default() }`
    pour détecter une session morte en ~45 s au lieu du timeout TCP par
    défaut du système.
  - Distinguer, dans la raison de fermeture envoyée au frontend
    (`send_closed`), une coupure réseau (« Déconnecté », erreur
    `channel.wait()` → `None`) d'un échec d'authentification (jamais
    atteint ce point) — déjà le cas dans le code actuel, à documenter
    explicitement dans le message.
  - Frontend (`TerminalView.tsx`) : sur `closedReason` correspondant à une
    coupure réseau (pas une fermeture demandée par l'utilisateur, marquée
    par un nouveau flag `userClosed` mis à `true` uniquement par
    `closeTerminal`), relancer automatiquement `session.attempt += 1` avec
    un backoff (1 s, 2 s, 5 s), maximum 3 tentatives, puis repasser en
    mode manuel (bouton *Reconnecter* déjà existant).
  - Modèle de données : ajouter `autoReconnectAttempts?: number` (interne,
    non persisté) dans `TerminalSession`.
- Dépendances : aucune nouvelle commande, changement de configuration
  `russh::client::Config` uniquement.
- Critères d'acceptation : couper le réseau puis le rétablir sous 45 s
  reconnecte l'onglet sans clic ; un mot de passe faux ne déclenche jamais
  de boucle de reconnexion ; après 3 échecs, retour à l'état actuel
  (bouton manuel).
- Tests : test Rust avec `ssh_test_server` existant simulant une coupure
  brutale du canal ; test frontend du compteur de tentatives et du
  backoff (`vi.useFakeTimers`).
- Estimation : M (2-3 jours).

**C4 — Barre de monitoring sous le terminal**
- Objectif : voir CPU/RAM/disque du serveur connecté sans changer d'onglet.
- Spécification : composant `TerminalMetricsBar` sous chaque `TerminalView`
  actif, appelant `get_server_metrics` (déjà existant) au même intervalle
  que Paramètres → Réseau → Intervalle du monitoring ; masquable (bouton
  toggle, état persisté par utilisateur dans le store zustand local, pas
  côté serveur).
- Dépendances : aucune commande Rust nouvelle.
- Critères d'acceptation : la barre affiche les mêmes valeurs que la page
  Ressources pour le même serveur ; masquée par défaut si le module
  « resources » est désactivé (cohérence avec `MODULES`).
- Tests : test de composant avec `invoke` mocké.
- Estimation : S/M (1-2 jours).

**C5 — Compose bar (saisie multi-ligne)**
- Objectif : préparer une commande sur plusieurs lignes avant envoi.
- Spécification : `<textarea>` repliable au-dessus du terminal actif,
  raccourci `Ctrl+Entrée` pour envoyer tout le contenu via `terminal_write`
  (une seule invocation, `\n` internes conservés) puis vider le champ.
  Base pour C7 (broadcast) en Phase 2.
- Dépendances : aucune.
- Critères d'acceptation : le contenu envoyé apparaît identique dans le
  terminal ; `Échap` referme sans envoyer.
- Estimation : S (1 jour).

**C6 — Snippets avec variables**
- Objectif : un snippet paramétrable (ex. `apt install {{package}}`).
- Spécification : étendre `Snippet` (`src/types` + `snippets_cmd.rs`) avec
  un champ optionnel `variables: Vec<String>` extrait des `{{...}}` du
  `command` (regex simple, même famille que le moteur Smart Batch) ;
  `#[serde(default)]` pour compatibilité ascendante. À l'insertion, si des
  variables sont détectées, un petit formulaire (`Dropdown` existant)
  demande leur valeur avant d'écrire la commande finale dans le terminal.
- Dépendances : migration de données mineure (champ par défaut vide).
- Critères d'acceptation : un snippet sans `{{}}` se comporte exactement
  comme avant ; un snippet avec variables ouvre le formulaire, annule
  proprement si laissé vide.
- Tests : test Rust sur l'extraction de variables ; test frontend sur le
  flux d'insertion.
- Estimation : S (1-2 jours).

#### Phase 2 — Fonctionnalités structurantes (M/L)

**C7 — Multi-exécution / broadcast vers plusieurs onglets**
- Objectif : taper une fois, exécuter sur plusieurs sessions choisies.
- Spécification technique :
  - Store : `broadcastTargets: string[]` (clés de session) dans le store
    zustand de la Console, activable depuis un nouveau bouton *Diffuser*
    dans la barre d'onglets (sélection multi via cases à cocher sur
    chaque onglet en mode diffusion).
  - `onData` de la session « meneuse » republie vers `terminal_write` pour
    chaque session ciblée en plus d'elle-même — aucune commande Rust
    nouvelle.
  - UX de sécurité (détaillée en §3.2) : bandeau rouge permanent
    « Diffusion active vers N sessions » tant que le mode est actif,
    désactivation explicite requise, jamais d'auto-activation au
    changement d'onglet.
- Dépendances : C5 (compose bar) recommandé pour composer avant diffusion.
- Critères d'acceptation : taper dans la session meneuse reproduit la
  frappe sur toutes les cibles sélectionnées et seulement elles ; fermer
  une session cible l'enlève automatiquement du groupe de diffusion.
- Tests : test frontend simulant l'ajout/retrait de cibles et la
  propagation des invocations `terminal_write`.
- Estimation : M (3-4 jours).

**C8 — Split panes**
- Objectif : voir 2 à 4 terminaux côte à côte dans un même onglet.
- Spécification : `TerminalSession` gagne un layout optionnel
  (`panes: string[]`, sessions additionnelles affichées dans le même
  onglet, chacune avec son propre `TerminalView`) ; disposition en grille
  CSS (1, 2 horizontal, 2 vertical, 4) choisie par un sélecteur dans la
  barre d'outils, réutilisant le pattern déjà en place pour
  `panelOpen`/`width` de l'explorateur.
- Dépendances : aucune commande Rust (chaque pane est une session SSH
  indépendante comme aujourd'hui).
- Critères d'acceptation : chaque pane conserve son focus, son scrollback
  et son statut de connexion indépendamment ; fermer un pane ne ferme pas
  les autres.
- Estimation : M (3-5 jours).

**C9 — Tunnels SSH GUI (local / distant / dynamique SOCKS)**
- Objectif : configurer des tunnels persistants sans ligne de commande.
- Spécification technique :
  - Modèle de données : nouvelle table/collection `ssh_tunnels`
    (`server_id`, `kind: Local|Remote|Dynamic`, `bind_host` par défaut
    `127.0.0.1`, `bind_port`, `dest_host`/`dest_port` pour Local,
    `#[serde(default)]` partout pour rétrocompatibilité).
  - Rust : nouveau module `tunnels.rs` + commandes `tunnel_start`,
    `tunnel_stop`, `tunnel_list_active` (état en mémoire, façon
    `TerminalState`). Local/Remote : relais direct via
    `channel_open_direct_tcpip`/`tcpip_forward` (déjà utilisés pour le
    rebond, à généraliser). Dynamique : mini-serveur SOCKS5 local
    (`tokio::net::TcpListener` + implémentation SOCKS5 minimale ou crate
    dédiée) ouvrant un canal `direct-tcpip` par connexion entrante.
  - Frontend : nouvel onglet dans la fiche serveur ou un panneau dédié
    « Tunnels », liste des définitions persistantes avec bouton
    Démarrer/Arrêter et indicateur d'état (actif/inactif/erreur).
- Dépendances : session SSH déjà ouverte (réutilise `connect_ssh`), ou
  connexion dédiée si aucun terminal n'est ouvert pour ce serveur.
- Critères d'acceptation : un tunnel local créé puis démarré rend le port
  local joignable tant que l'app tourne ; l'arrêt libère le port ;
  `bind_host` autre que `127.0.0.1` demande une confirmation explicite.
- Tests : test Rust bout en bout avec `ssh_test_server` (connexion à
  travers le tunnel local vers un service de test).
- Estimation : L (1-2 semaines, le SOCKS dynamique étant la part la plus
  longue).

**C10 — Journalisation des sessions (opt-in)**
- Objectif : garder une trace texte d'une session pour audit/relecture.
- Spécification : option par serveur (`log_session: bool`, `#[serde(default)]`
  sur `Server` ou dans les paramètres de la console) ; si active, chaque
  `ArrayBuffer` reçu par `TerminalView` est aussi accumulé et écrit
  périodiquement (buffer + flush toutes les 2 s) dans
  `<data_path>/session-logs/<server>-<horodatage>.log` (chemin déjà exposé
  par `get_data_path`). Purge configurable (nombre de jours) dans
  Paramètres → Historique, à côté de la rétention SQLite existante.
- Dépendances : aucune nouvelle commande critique, juste de l'écriture
  fichier côté frontend (Tauri fs) ou une commande `terminal_log_append`
  simple côté Rust si on préfère centraliser l'écriture disque.
- Critères d'acceptation : désactivé par défaut ; activé, un fichier lisible
  apparaît après la session ; le contenu tapé (y compris un mot de passe
  saisi par erreur en clair dans le shell) est visiblement **non filtré**
  et un avertissement l'indique clairement dans l'UI d'activation.
- Estimation : M (2-3 jours).

**C11 — Coloration de mots-clés**
- Objectif : repérer error/warning/ok au premier coup d'œil.
- Spécification : jeu de règles par défaut (regex `error|fail(ed)?` → rouge,
  `warn(ing)?` → orange, `ok|success|done` → vert), appliqué via un
  post-traitement des lignes écrites dans xterm (wrapper autour de
  `term.write` insérant les séquences ANSI correspondantes avant l'écriture,
  sans modifier le flux brut renvoyé par le serveur) ; réglable dans
  Paramètres (activer/désactiver, éditer les règles) par utilisateur, pas
  par serveur.
- Dépendances : aucune.
- Critères d'acceptation : les règles par défaut colorent correctement un
  flux de test contenant les mots-clés ; désactivable globalement ; pas de
  ralentissement perceptible sur un flux verbeux (limite de règles actives
  ~10).
- Estimation : M (2-3 jours, essentiellement du réglage fin de performance).

**C12 — Glisser-déposer de fichiers vers l'explorateur**
- Objectif : déposer un fichier Windows directement sur le panneau SFTP.
- Spécification : écouter l'évènement Tauri `tauri://drag-drop` (Tauri v2)
  sur `FileExplorerPanel`, extraire les chemins locaux, appeler
  `sftp_upload` pour chacun avec le `path` courant comme `remoteDir` —
  réutilise la commande existante, juste un nouveau déclencheur UI.
- Dépendances : aucune nouvelle commande Rust.
- Critères d'acceptation : déposer 1 ou plusieurs fichiers déclenche autant
  d'uploads avec la même barre de progression que le bouton existant ;
  déposer un dossier est soit ignoré avec message, soit traité récursivement
  (à trancher selon la complexité — recommandé : ignoré avec message clair
  en V1).
- Estimation : M (2 jours).

**C13 — Restauration des sessions au démarrage**
- Objectif : retrouver ses onglets de console à la relance de l'app.
- Spécification : persister la liste `{ serverId, key }` des sessions
  ouvertes (pas les identifiants) dans le store persistant existant
  (déjà utilisé pour d'autres préférences UI) ; option globale
  Paramètres → Général → « Rouvrir les sessions au démarrage » (défaut :
  désactivé) ; au lancement, si activée, rouvrir chaque onglet et lancer
  `openTerminal` comme un clic normal (redemande donc la connexion avec
  les identifiants déjà stockés, pas de saisie manuelle nécessaire).
- Dépendances : aucune commande Rust nouvelle.
- Critères d'acceptation : avec l'option active, fermer puis relancer l'app
  rouvre les mêmes onglets et relance la connexion automatiquement ;
  désactivée par défaut, comportement actuel inchangé.
- Estimation : M (2 jours).

**C14 — Lancement RDP externe via `mstsc`**
- Objectif : accéder à un serveur Windows sans quitter l'app.
- Spécification : un bouton *Ouvrir en RDP* sur les serveurs marqués
  `OsType::Windows`, qui appelle une nouvelle commande Rust
  `open_rdp(server_id)` : génère un fichier `.rdp` temporaire minimal
  (adresse, utilisateur) dans un dossier temporaire, lance
  `mstsc.exe <fichier>.rdp` via le même mécanisme de lancement de
  processus externe validé que `open_external_url`, puis supprime le
  fichier après un court délai.
- Dépendances : aucune (pas de nouvelle dépendance Rust, `std::process`
  suffit).
- Critères d'acceptation : le bouton n'apparaît que pour les serveurs
  Windows ; `mstsc` s'ouvre avec l'utilisateur pré-rempli, sans mot de
  passe visible nulle part (ni fichier, ni ligne de commande, ni logs).
- Tests : test Rust sur la génération du fichier `.rdp` (contenu, absence
  de mot de passe) ; test manuel du lancement effectif.
- Estimation : S/M (1-2 jours).

**M1 — Monitoring HTTP/TCP/DNS (extension des sondes)**
- Objectif : surveiller un service applicatif, pas seulement un serveur.
- Spécification : à confirmer contre `probes.rs`/`probes_cmd.rs` existants
  (lire leur périmètre exact avant de coder) ; ajouter les types de sonde
  HTTP (code + mot-clé dans le corps), TCP (connexion simple), DNS
  (résolution d'un enregistrement) au moteur déjà en place pour les
  alertes « Service injoignable (sonde) ».
- Dépendances : moteur de sondes existant, `reqwest`/`hyper` déjà
  probablement présent (Rust) pour Proxmox/Zabbix.
- Critères d'acceptation : une sonde HTTP créée sur une URL de test locale
  déclenche une alerte quand le mot-clé disparaît de la réponse.
- Estimation : M (3-4 jours), sous réserve de l'état réel de `probes.rs`.

#### Phase 3 — Plus tard / nécessite une décision produit

**C15 — SFTP qui suit le répertoire courant du terminal**
- Objectif : le panneau change de dossier automatiquement au `cd`.
- Spécification : mécanisme OSC 7 opt-in (voir §2.1) — case à cocher par
  serveur « Faire suivre le répertoire courant à l'explorateur (modifie le
  profil shell distant) », qui ajoute une ligne à `.bashrc`/`.zshrc` via
  SFTP à l'activation (et propose de la retirer à la désactivation) ; le
  frontend écoute la séquence `\e]7;...\a` dans le flux terminal et
  synchronise `FileExplorerPanel` si le panneau est ouvert pour ce serveur.
- Dépendances : C1-C6 posés d'abord (moins prioritaire, plus intrusif).
- Critères d'acceptation : activé, un `cd /var/log` dans le terminal fait
  naviguer le panneau vers `/var/log` sans action manuelle ; désactivé,
  aucun changement de comportement ni de fichier shell distant.
- Estimation : L (1-2 semaines, incluant les tests multi-shells).

**C16 — Historique de commandes recherchable**
- Estimation : M/L. Reporté après C10 (journalisation) pour partager
  l'infrastructure de stockage, et parce que la question de la
  confidentialité (commandes tapées, potentiellement des secrets en clair)
  mérite une décision produit explicite avant de l'activer par défaut.

**C17 — Import de sessions (`~/.ssh/config` puis PuTTY/MobaXterm)**
- Estimation : M pour `~/.ssh/config` seul, L pour les trois formats.
  Commencer par `~/.ssh/config` (format ouvert, zéro dépendance Windows),
  qui couvre déjà une bonne part des utilisateurs venant d'un terminal
  Unix classique.

**C18 — Notification de fin de commande longue**
- Estimation : M. Reporté car l'heuristique de détection de fin de
  commande (pas de canal PTY structuré comme un « exit code » visible en
  mode interactif classique) demande un réglage fin pour éviter les faux
  positifs.

**M2 — Éditeur Docker Compose (façon Dockge)**
- Estimation : M, à envisager seulement si l'usage Docker de l'app se
  développe au-delà de la gestion de conteneurs individuels actuelle.

---

### 3.2 Directives d'expérience utilisateur

**Disposition de la Console**
- Barre d'onglets inchangée en haut ; sous elle, une barre d'outils
  contextuelle qui grossit avec les nouvelles fonctions (recherche,
  diffusion, tunnels) mais reste repliée par défaut pour ne pas surcharger
  l'écran d'un usage simple à un seul terminal.
- Un onglet en mode split affiche un sélecteur de disposition (1/2h/2v/4)
  dans le coin supérieur droit du contenu, jamais dans la barre d'onglets
  globale (qui reste dédiée à la liste des sessions).
- La barre de monitoring (C4) se place **sous** le terminal, hauteur fixe
  ~28px, repliable par une petite flèche — jamais superposée en overlay
  pour ne pas masquer de sortie.
- Le panneau SFTP garde sa position actuelle (à droite, redimensionnable) ;
  le glisser-déposer (C12) affiche une zone de dépôt visuelle uniquement
  quand un glissé Windows est en cours au-dessus de la fenêtre.

**Raccourcis clavier (vérifiés contre `src/utils/shortcuts.ts`, aucun conflit)**

| Nouveau raccourci | Action | Conflit vérifié |
|---|---|---|
| `Ctrl+Maj+F` | Recherche dans le terminal actif | Libre (`l`, `k`, `?`, `/`, `g d/s/c/p` déjà pris, aucun n'utilise F) |
| `Ctrl+Entrée` (dans la compose bar) | Envoyer le contenu multi-ligne | Contexte propre à un champ non global, pas de conflit |
| `Ctrl+B` | Ouvrir/fermer le split (basculer disposition) | Libre |
| `Ctrl+Maj+B` | Activer/désactiver le mode diffusion | Libre |
| `Ctrl+D` (hors champ de saisie) | Dupliquer la disposition en pane supplémentaire | À vérifier au moment du code contre d'éventuels raccourcis navigateur système Windows (aucun dans `SHORTCUTS` actuel) |

Tous les nouveaux raccourcis sont ajoutés à la table unique `SHORTCUTS`
(comme demandé par le commentaire du fichier), avec `context: "page"` pour
qu'ils n'interfèrent pas avec la saisie normale dans le terminal — et testés
via `createShortcutMatcher` comme les raccourcis existants.

**Découvrabilité**
- Un badge « Nouveau » discret sur les boutons Recherche/Diffusion/Tunnels
  lors de leur première apparition après une mise à jour (mécanisme déjà
  utilisé ailleurs dans l'app pour les icônes de nouveauté, à vérifier/
  réutiliser plutôt que réinventer).
- Icône « i » à côté de l'option OSC 7 (C15) et de la journalisation (C10)
  expliquant en une phrase ce que ça modifie côté serveur/disque.
- Les entrées de la palette de commandes (`Ctrl+K`) gagnent des actions
  rapides : « Rechercher dans le terminal », « Activer la diffusion »,
  « Nouveau tunnel SSH » — cohérent avec le principe de la palette existante
  comme point d'entrée unique.
- Un pas-à-pas (tooltip séquentiel, façon `?`) présente le mode diffusion la
  première fois qu'il est activé, avant toute frappe.

**Motifs de sécurité (UX)**
- **Diffusion (C7)** : bandeau rouge plein-largeur, texte contrasté
  « Diffusion active vers N sessions », visible sur *tous* les onglets
  participants (pas seulement le meneur) ; désactivation en un clic
  toujours accessible depuis ce bandeau ; jamais réactivée automatiquement
  après un redémarrage de l'app.
- **Tunnels (C9)** : toute liaison sur autre chose que `127.0.0.1` affiche
  une confirmation explicite nommant l'interface réseau exposée.
- **Journalisation (C10)** et **historique de commandes (C16)** :
  avertissement explicite à l'activation sur le risque de capturer des
  secrets en clair, jamais activés par défaut.
- **OSC 7 (C15)** : décrit comme une modification du profil shell distant
  *avant* activation, avec un bouton pour la retirer proprement.
- **RDP (C14)** : jamais de mot de passe dans le fichier `.rdp` généré ni
  dans la ligne de commande de lancement.

**Accessibilité**
- Tous les nouveaux contrôles (recherche, diffusion, tunnels) suivent le
  même pattern `Dropdown`/`ConfirmDialog` déjà utilisé ailleurs (focus géré,
  fermeture au `Échap, `aria-label` sur les champs) — cohérence avec
  l'existant plutôt qu'un nouveau composant par fonctionnalité.
- Le bandeau de diffusion utilise une couleur **et** une icône/texte
  (jamais la couleur seule) pour rester lisible en cas de daltonisme.

**Cohérence de thème**
- Toute nouvelle UI lit les mêmes variables CSS que `TerminalView`
  (`readTheme()`), pas de couleurs codées en dur — en particulier la
  coloration de mots-clés (C11) doit respecter le thème actif plutôt que
  des couleurs ANSI fixes qui jureraient avec un thème clair personnalisé.

**États vides**
- Le panneau Tunnels affiche un état vide explicite (« Aucun tunnel
  configuré pour ce serveur ») avec un bouton d'ajout direct, plutôt qu'un
  panneau simplement absent.
- Le mode split sans second pane affiche un état « Ajouter un pane »
  plutôt qu'un espace vide déroutant.

**Budgets de performance**
- Scrollback : garder la limite actuelle de 5000 lignes par terminal par
  défaut ; la rendre configurable (Paramètres) plutôt que de l'augmenter
  silencieusement, pour ne pas dégrader la mémoire sur un split à 4 panes.
- Coloration de mots-clés (C11) : plafonner à un nombre raisonnable de
  règles actives simultanément (proposition : 10) pour éviter un coût par
  ligne trop élevé sur un flux verbeux (ex. `journalctl -f`).
- Diffusion (C7) : aucune limite artificielle du nombre de cibles, mais le
  bandeau affiche le compte pour que l'utilisateur mesure lui-même le
  risque/la charge.
- Split panes (C8) : chaque pane est une session SSH indépendante — vérifier
  qu'ouvrir 4 panes ne multiplie pas la fréquence de la barre de monitoring
  (C4) par 4 sans raison (mutualiser l'appel `get_server_metrics` si
  plusieurs panes pointent le même serveur).

---

## 4. Risques et points de vigilance

- **OSC 7 (C15)** modifie un fichier de configuration shell distant : toute
  erreur d'implémentation (mauvaise détection du shell, échappement
  incorrect) pourrait casser le prompt de l'utilisateur sur le serveur — à
  tester sur bash, zsh et au minimum signaler l'absence de prise en charge
  pour un shell non reconnu plutôt que d'injecter à l'aveugle.
- **Diffusion vers plusieurs sessions (C7)** est la fonctionnalité la plus
  dangereuse du lot : une commande destructrice tapée par réflexe (habitude
  d'un terminal simple) pourrait s'exécuter sur des serveurs de production
  non voulus. Le bandeau rouge et l'absence de réactivation automatique ne
  sont qu'un filet ; envisager, si l'usage se révèle risqué en pratique, une
  confirmation supplémentaire pour les commandes reconnues comme
  destructrices (heuristique `rm -rf`, `dd`, `mkfs`…), en Phase 3 seulement
  si le besoin se confirme.
- **Tunnels SOCKS/local (C9)** ouvrent un port TCP local : même borné à
  `127.0.0.1`, toute application du poste Windows peut s'y connecter. À
  documenter clairement, et fermer systématiquement les tunnels à la
  fermeture de l'app (comme `close_all` le fait déjà pour les sessions
  terminal).
- **Journalisation (C10) et historique de commandes (C16)** créent de
  nouveaux emplacements où des secrets tapés par erreur peuvent finir en
  clair sur disque — l'app a jusqu'ici une discipline stricte de secrets
  chiffrés (`crypto.rs`, `Debug` jamais en clair) ; ces deux fonctionnalités
  sont les premières à écrire volontairement du texte libre potentiellement
  sensible sur disque. Elles doivent rester opt-in, désactivées par défaut,
  et clairement expliquées.
- **Keepalive (C3)** : un intervalle trop court userait de la bande passante
  et des ressources serveur sur un grand nombre de sessions simultanées
  (peu probable dans un homelab, mais à garder en tête si l'usage évolue
  vers plus de connexions parallèles).
- **RDP externe (C14)** dépend de `mstsc.exe`, disponible sur toutes les
  éditions Windows 10/11 sauf N/KN sans le pack média (cas marginal) — à
  détecter et signaler proprement plutôt que d'échouer silencieusement.
- **Compatibilité ascendante des modèles de données** : chaque nouveau
  champ (`tunnels`, `log_session`, variables de snippet, sessions
  restaurées) doit porter `#[serde(default)]` comme le fait déjà tout le
  reste du modèle (`AuthMethod`, `jump_host_id`, etc.), pour ne jamais faire
  échouer le chargement d'une configuration existante.
- **Portée volontairement exclue** : RDP/VNC/X11 embarqués, sessions série,
  RBAC multi-utilisateur et coffre d'équipe partagé demanderaient soit une
  dépendance native lourde et risquée (rendu RDP/VNC), soit un changement
  d'architecture (serveur central) contraire au modèle actuel d'application
  desktop mono-poste. Les revisiter seulement si un besoin explicite et
  répété apparaît.

---

## 5. Sources

**MobaXterm**
- https://mobaxterm.mobatek.net/
- https://mobaxterm.mobatek.net/features.html
- https://mobaxterm.mobatek.net/license.html
- https://mobaxterm.mobatek.net/subscription.html
- https://mobaxterm.mobatek.net/plugins.html
- https://www.comparitech.com/net-admin/best-ssh-client-and-connection-managers/
- https://ctrlops.io/blog/putty-vs-mobaxterm
- https://blog.mobatek.net/post/customize-mobaxterm-for-professional-use/
- https://blog.mobatek.net/post/ssh-tunnels-and-port-forwarding/
- https://logmeonce.com/resources/mobaxterm-master-password/
- https://ccportal.ims.ac.jp/en/quickstartguide/mobaxterm
- https://doc.nhr.fau.de/access/ssh-mobaxterm/

**Termius, Royal TS/TSX, SecureCRT, Xshell/Xmanager**
- https://docs.termius.com/
- https://docs.termius.com/getting-started/learn-about-vaults
- https://docs.termius.com/terminal/snippets
- https://docs.termius.com/organize-and-connect-to-hosts/groups-and-tags
- https://docs.termius.com/organize-and-connect-to-hosts/session-logs
- https://docs.termius.com/keychain/sync-of-keys-and-passwords
- https://docs.royalapps.com/
- https://www.royalapps.com/blog/new-feature-secure-gateway-ssh-tunnels
- https://royalapps.com/ts/win/features
- https://github.com/royalapplications/docs (key-sequence.md)
- https://www.vandyke.com/products/securecrt/
- https://www.vandyke.com/support/tips/button_bar.html
- https://www.vandyke.com/support/tips/chatsendcom.html
- https://www.vandyke.com/support/scripting/scripting-examples/import-keyword-highlighting-ini-files.html
- https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/419956557/Manual+-+Xshell
- https://netsarang.atlassian.net/wiki/spaces/ENSUP/pages/419957117/Highlight+Sets+Settings
- https://www.netsarang.com/en/xmanager-all-features/
- https://www.netsarang.com/en/xshell-all-features/

**Terminaux modernes**
- https://github.com/Eugeny/tabby
- https://github.com/kingToolbox/WindTerm
- https://docs.warp.dev/
- https://docs.warp.dev/terminal/blocks/block-actions/
- https://docs.warp.dev/terminal/entry/command-search/
- https://docs.warp.dev/terminal/entry/command-history/
- https://github.com/microsoft/terminal
- https://learn.microsoft.com/en-us/windows/terminal/tips-and-tricks
- https://learn.microsoft.com/en-us/windows/terminal/customize-settings/actions
- https://github.com/wavetermdev/waveterm
- https://docs.waveterm.dev/connections
- https://github.com/electerm/electerm

**Outils de gestion de serveurs / homelab**
- https://cockpit-project.org/
- https://cockpit-project.org/applications
- https://www.portainer.io/features
- https://www.portainer.io/pricing
- https://github.com/louislam/uptime-kuma
- https://uptime.kuma.pet/
- https://www.netdata.cloud/pricing/
- https://www.netdata.cloud/features/aiml/anomaly-detection/
- https://www.netdata.cloud/homelab/
- https://www.pistack.xyz/posts/2026-05-02-beszel-lightweight-self-hosted-server-monitoring-guide/
- https://www.xda-developers.com/beszel-feature/
- https://github.com/louislam/dockge
- https://www.wundertech.net/dockge-docker-manager/
- https://homarr.dev/docs/category/widgets/
- https://homelabcompass.com/alternatives/self-hosted-dashboard
- https://semaphoreui.com/
- https://semaphoreui.com/docs/admin-guide/runners
- https://www.rundeck.com/
- https://devolutions.net/remote-desktop-manager/
- https://devolutions.net/pricing/
- https://termius.com/
- http://webmin.com/
- https://virtualmin.com/

**Code source de l'application (référence interne, pas une URL externe)**
- `src/pages/Console.tsx`, `src/components/TerminalView.tsx`,
  `src/components/FileExplorerPanel.tsx`, `src/components/SnippetMenu.tsx`
- `src-tauri/src/terminal.rs`, `src-tauri/src/commands/terminal.rs`,
  `src-tauri/src/commands/ssh.rs`, `src-tauri/src/ssh_auth.rs`,
  `src-tauri/src/commands/sftp.rs`, `src-tauri/src/sftp.rs`,
  `src-tauri/src/known_hosts.rs`, `src-tauri/src/ppk.rs`
- `src/utils/modules.ts`, `src/utils/shortcuts.ts`
- `src-tauri/src/lib.rs` (liste des commandes enregistrées)
- `docs/guide/fonctionnalites.md`
- `package.json` (dépendances xterm et absence des addons de recherche/liens)
