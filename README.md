# Server Power Manager

Outil de bureau Windows tout-en-un pour gérer et surveiller un homelab : Wake-on-LAN, arrêt/redémarrage SSH, supervision en temps réel, Proxmox, Docker, console SSH, tâches planifiées, alertes et bien plus.

Construit avec **Tauri v2** (backend Rust) et **React + TypeScript + Tailwind** — binaire léger, interface style Windows 11.

## Fonctionnalités

- **Serveurs & groupes** : ajout/édition avec validation, actions groupées en 1 clic (WoL, arrêt, ping), import/export JSON
- **Organisation** : tags colorés, dossiers, favoris et champs personnalisés (emplacement, numéro de série…) pour les serveurs ; recherche et filtres combinés (texte, tags, dossier, favoris, en ligne / hors ligne)
- **Palette de commandes** (Ctrl+K) : pages et actions sur un serveur précis (réveiller, arrêter, redémarrer, console, ping, modifier), toujours avec confirmation pour ce qui agit sur une machine
- **Alimentation** : Wake-on-LAN, arrêt et redémarrage par SSH avec commande personnalisable par OS
- **Supervision** : statut et latence en temps réel, ressources (CPU, RAM, disque), historique des événements, alertes (ntfy, Discord, Telegram…)
- **Historique persistant** : événements, disponibilité et latence des serveurs, courbes de ressources conservés dans une base locale SQLite ; mesures détaillées 7 jours et agrégats horaires 90 jours par défaut (réglable dans Paramètres → Historique)
- **Réseau** : scan du réseau local, vue liste ou graphe interactif (passerelle, Wi-Fi, sous-réseaux VPN, traceroute), topologie éditable (Box → switch → machines)
- **Tâches en lot intelligentes** : détection de l'OS de chaque cible et commandes adaptées (apt, dnf, pacman, apk, winget…), variables `{{pkg_update}}` & co, aperçu avant exécution
- **Extensions communautaires** : commandes, thèmes et liens ajoutés par un simple manifeste JSON, sans exécution de code (voir [docs/extensions.md](docs/extensions.md))
- **Interface personnalisable** : favoris, ordre des onglets par glisser-déposer, largeur de la barre latérale, densité des pages, saisies conservées entre les pages
- **Modules** : n'affiche que ce que tu utilises (choix au premier lancement, modifiable dans Paramètres → Général)
- **Proxmox** : état du cluster, VM/CT, sauvegardes, migration
- **Docker** : conteneurs et images à mettre à jour
- **Console SSH** intégrée, snippets, tâches en lot sur plusieurs serveurs avec réponse aux questions interactives (dpkg, apt)
- **Clés SSH** : paire ed25519 générée dans l'app ou import d'une clé OpenSSH / PuTTY (.ppk), agent SSH (OpenSSH de Windows, Pageant), déploiement de la clé sur un serveur en un clic, hôte de rebond
- **Planificateur** : tâches programmées, avec création des cronjobs directement sur les serveurs Linux
- **Mises à jour** (apt), **réseau**, **logs** (Loki), zone de notification Windows
- **Thèmes** : One Half Dark, Fluent, Gruvbox Dark, Nord, Dracula, Catppuccin Mocha, Tokyo Night, ou thème personnalisé
- **Langues** : français (par défaut) et anglais, au choix dans Paramètres → Général
- **Verrouillage** : PIN, Windows Hello et mot de passe maître optionnel ; verrouillage automatique après inactivité ou avec la session Windows
- **Sauvegarde chiffrée** de toute la configuration (`.spmbackup`), manuelle ou automatique, restaurable sur un autre PC
- **Mise à jour automatique** signée, proposée au démarrage et toujours installée après confirmation

## Téléchargement

Pour simplement utiliser l'application, télécharge l'installateur de la [dernière version](https://github.com/NolanEDUVAUD/server-manager/releases/latest) :

- **`ServerPowerManager_x.y.z_x64-setup.exe`** — installateur recommandé, sans droits administrateur
- `ServerPowerManager_x.y.z_x64.msi` — pour un déploiement MSI

> L'installateur n'est pas signé : si Windows SmartScreen s'affiche, clique sur *Informations complémentaires* → *Exécuter quand même*.

Les sections suivantes ne concernent que la compilation depuis les sources.

## Installation depuis les sources

### 1. Prérequis

Windows 10/11 avec [winget](https://apps.microsoft.com/detail/9NBLGGH4NNS1) (App Installer).

Le script `install.ps1` installe automatiquement ce qui manque, en sautant ce qui est déjà présent :

- Visual C++ Build Tools (MSVC)
- Rust (rustup)
- Node.js LTS
- CMake et NASM (nécessaires à la compilation de la cryptographie)
- Git
- Tauri CLI v2
- les dépendances npm du projet

### 2. Récupérer le projet et installer l'environnement

Dans PowerShell :

```powershell
git clone https://github.com/NolanEDUVAUD/server-manager.git
cd server-manager
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> Les Build Tools peuvent prendre 5 à 15 minutes à s'installer. Ferme puis rouvre PowerShell après le script pour que `cargo` et `node` soient dans le PATH.

### 3. Lancer l'application

```powershell
npm run tauri dev
```

La première compilation Rust prend quelques minutes ; les suivantes sont rapides.

### 4. Construire un installateur `.exe`

```powershell
$env:RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"   # retire ton chemin utilisateur du binaire
npm run tauri build
```

Les installateurs sont générés dans :

- `src-tauri\target\release\bundle\nsis\` (installateur `.exe`)
- `src-tauri\target\release\bundle\msi\` (installateur `.msi`)

## Premier démarrage

1. **Serveurs** → *Ajouter* : nom, IP, adresse MAC, utilisateur et mot de passe SSH, type d'OS. La commande d'arrêt est pré-remplie selon l'OS et reste modifiable.
2. **Wake-on-LAN** : activer le WoL dans le BIOS/UEFI et sur la carte réseau de chaque machine. Un broadcast personnalisé peut être défini par serveur.
3. **Arrêt SSH** : l'utilisateur doit pouvoir exécuter la commande d'arrêt (par exemple via `sudo` sans mot de passe pour `shutdown`). La clé d'hôte de chaque serveur est mémorisée à la première connexion, puis vérifiée ensuite.
4. **Proxmox** (optionnel) : créer un jeton d'API (*Datacenter → Permissions → API Tokens*) et le renseigner dans l'app.
5. **Paramètres → Intégrations** (optionnel) : notifications ntfy, Loki, etc.

## Raccourcis clavier

L'aide s'ouvre avec <kbd>?</kbd> (ou « Afficher les raccourcis clavier » dans la palette). Elle est générée depuis la même table que le gestionnaire clavier (`src/utils/shortcuts.ts`).

| Raccourci | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Ouvrir ou fermer la palette de commandes |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Entrée</kbd> | Dans la palette : choisir et exécuter une action (les actions sur un serveur demandent confirmation) |
| <kbd>Échap</kbd> | Fermer la palette, l'aide ou la demande de confirmation |
| <kbd>?</kbd> | Afficher l'aide des raccourcis |
| <kbd>/</kbd> | Aller à la recherche (page Serveurs) |
| <kbd>g</kbd> puis <kbd>d</kbd> / <kbd>s</kbd> / <kbd>c</kbd> / <kbd>p</kbd> | Aller au tableau de bord / aux serveurs / à la console / aux paramètres |

Les raccourcis à une touche sont ignorés pendant la saisie dans un champ et dans la console SSH.

## Données et sécurité

- La configuration est stockée dans `%APPDATA%\com.homelab.server-manager\`.
- L'historique (événements, pings, métriques) est dans `history.db` (SQLite) au même endroit. Il ne contient aucun secret : seulement des mesures, des noms affichés et des messages d'événements.
- Tous les secrets (mots de passe SSH, jetons Proxmox, identifiants des intégrations) sont chiffrés en AES-256-GCM avec une clé maître conservée dans le **Gestionnaire d'identification Windows**. Rien n'est écrit en clair sur le disque.
- Les secrets ne sont jamais renvoyés à l'interface (seulement « enregistré ») et ne sont déchiffrés qu'au moment de la connexion, puis effacés de la mémoire.
- Les en-têtes d'authentification sont marqués sensibles et les redirections sont refusées pour les requêtes authentifiées. L'interface prévient si un secret passerait en HTTP ou sans vérification du certificat.
- **Sauvegarde chiffrée `.spmbackup`** (Paramètres → Configuration) : toute la configuration, secrets compris, chiffrée par une phrase de passe (Argon2id + AES-256-GCM, en-tête authentifié). Elle se restaure sur un autre PC, où les secrets sont rechiffrés par la clé maître locale. La sauvegarde automatique vers un dossier est optionnelle (quotidienne ou hebdomadaire, rotation) ; sa phrase de passe est elle-même chiffrée par la clé maître.
- L'export JSON de la configuration ne contient aucun secret (à ressaisir après un import). Tags, dossiers, favoris et champs personnalisés y figurent : ce ne sont pas des secrets, l'interface le rappelle et avertit si un champ personnalisé ressemble à un mot de passe ou un jeton.
- **Verrouillage** (optionnel, Paramètres → Sécurité) : PIN ou Windows Hello, verrouillage après inactivité ou avec la session Windows. Verrouillée, l'app efface la clé maître de la mémoire. Un **mot de passe maître** (Argon2id) peut chiffrer la clé dans le coffre : l'app démarre alors verrouillée et lui seul la déverrouille ; oublié, les secrets sont irrécupérables.
- Les clés privées SSH gérées par l'app sont chiffrées de la même façon : seule la clé publique est affichée, et aucune n'est exportée.
- Clés d'hôte SSH vérifiées à chaque saut (mémorisées à la première connexion, y compris via un hôte de rebond), commandes Tauri limitées à la fenêtre principale, CSP stricte.
- Les mises à jour ne s'installent qu'après vérification de leur signature (clé publique embarquée dans l'app) et confirmation.

### Avis de sécurité connus des dépendances

`cargo audit` et `npm audit --omit=dev` sont lancés à chaque version. Avis restants en 0.3.0, sans correctif disponible ou sans impact ici :

- **`rsa` (RUSTSEC-2023-0071, attaque « Marvin »)** : aucun correctif en amont. Ne concerne que les clés SSH **RSA** (signature). Les clés générées par l'app sont en ed25519, à préférer.
- **`quick-xml` (RUSTSEC-2026-0194 / 0195)** : tiré par les notifications Windows. Il ne lit que les modèles de notification produits par l'app elle-même, jamais de XML venant du réseau.

## Documentation

Un guide utilisateur détaillé, module par module, est disponible dans
[`docs/`](docs/README.md) :

- [Démarrage](docs/guide/demarrage.md) — installation, premier lancement, mises à jour, sauvegarde/restauration
- [Interface](docs/guide/interface.md) — barre latérale, palette de commandes, raccourcis clavier, thèmes
- [Fonctionnalités](docs/guide/fonctionnalites.md) — guide de chaque module (serveurs, réseau, tâches en lot, alertes, Proxmox…)
- [Authentification SSH](docs/guide/ssh.md) — mot de passe, clé, agent SSH, hôte de rebond, dépannage
- [Extensions communautaires](docs/extensions.md) — format de manifeste, création, installation
- [Signaler un problème](docs/guide/signaler-un-probleme.md)
- [Contribuer](docs/CONTRIBUTING.md) — compilation, tests, conventions de code

## Développement

```powershell
npm test                      # tests frontend (Vitest)
cd src-tauri; cargo test      # tests backend (Rust)
```

Structure :

```
src/            Frontend React (pages, composants, stores Zustand)
src-tauri/src/  Backend Rust (commandes Tauri, SSH, WoL, ping, stockage chiffré)
docs/           Spécifications et plans de conception
```

## Mises à jour automatiques et signature

Au démarrage (réglage *Paramètres → Général → Vérifier les mises à jour au démarrage*, activé par défaut) ou avec le bouton *Rechercher maintenant*, l'application lit le manifeste `latest.json` de la dernière release publiée du dépôt (adresse obtenue auprès de `api.github.com` à partir de l'identifiant numérique du dépôt, fichier téléchargé depuis `github.com`). Si une version plus récente existe, une bannière affiche son numéro et ses notes ; rien n'est installé sans confirmation. L'installateur est alors téléchargé, **sa signature est vérifiée** avec la clé publique intégrée à l'application (un paquet non signé ou modifié est refusé), puis il remplace l'application et la relance.

- Sous Windows, l'installateur NSIS s'exécute en **mode passif** (`plugins.updater.windows.installMode = "passive"`) : une simple barre de progression, aucune question, pas de droits administrateur (installation par utilisateur), et relance automatique. Une installation faite avec le `.msi` se met à jour avec le `.msi` (`msiexec /passive`).
- Tant que `src-tauri/updater-pubkey.txt` est vide, les mises à jour automatiques sont désactivées : l'application affiche « Mises à jour automatiques non configurées pour cette version » et ne contacte pas GitHub.
- Cette signature (minisign, format Tauri) protège les mises à jour ; ce n'est pas une signature Authenticode, SmartScreen peut donc toujours s'afficher à la première installation.

### 1. Générer la paire de clés (une seule fois, sur ton PC)

```powershell
npm run tauri signer generate -- -w "$env:USERPROFILE\.tauri\server-power-manager.key"
```

Choisis un mot de passe. Deux fichiers sont créés **hors du dépôt** :

- `server-power-manager.key` : la clé **privée**. Ne la commite jamais, ne la partage pas, et sauvegarde-la avec son mot de passe : sans elle, aucune mise à jour ne pourra plus être proposée aux applications déjà installées (elles ne font confiance qu'à la clé publique qu'elles embarquent). Par précaution, `.gitignore` refuse les fichiers `*.key` et `*.key.pub`.
- `server-power-manager.key.pub` : la clé publique.

### 2. Mettre la clé publique dans le dépôt

```powershell
Copy-Item "$env:USERPROFILE\.tauri\server-power-manager.key.pub" src-tauri\updater-pubkey.txt
git add src-tauri/updater-pubkey.txt
git commit -m "chore: clé publique de mise à jour"
```

La clé est intégrée au binaire à la compilation. Le fichier ne doit contenir que la clé (les lignes `#` et les blancs sont ignorés par l'application et par la CI, mais un build local signé lit le fichier tel quel : `Copy-Item` donne exactement le bon contenu).

### 3. Ajouter les secrets GitHub

Dans le dépôt : *Settings → Secrets and variables → Actions → New repository secret*.

- `TAURI_SIGNING_PRIVATE_KEY` : le contenu du fichier `.key` (`Get-Content "$env:USERPROFILE\.tauri\server-power-manager.key" -Raw | Set-Clipboard` le copie dans le presse-papiers) ;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` : son mot de passe.

### 4. Publier une version

1. Mets le même numéro de version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json` (c'est ce dernier que l'application compare), puis commite.
2. Pose un tag **annoté** : son message devient les notes de version affichées dans l'application.

   ```powershell
   git tag -a v0.3.0 -m "Server Power Manager 0.3.0" -m "- Nouveauté…`n- Correction…"
   git push origin v0.3.0
   ```

3. Le workflow *Release* (`.github/workflows/release.yml`, runner Windows) vérifie que le tag correspond à la version, construit l'application, signe les installateurs et crée une release **brouillon** contenant l'installateur NSIS, le `.msi`, leurs `.sig`, `latest.json` et `SHA256SUMS.txt`. Il peut aussi être lancé à la main (*Actions → Release → Run workflow*, avec des notes facultatives).
4. Relis le brouillon puis **publie-le** : ce n'est qu'à ce moment que `latest.json` devient la « dernière release » et que les applications installées proposent la mise à jour. Les notes affichées dans l'application sont celles du tag, copiées dans `latest.json` au moment du build : modifier ensuite la description de la release ne les change pas.

Pour vérifier un installateur téléchargé : `Get-FileHash .\<installateur> -Algorithm SHA256`, à comparer avec la ligne correspondante de `SHA256SUMS.txt`.

### Build signé en local (facultatif)

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\server-power-manager.key"   # chemin ou contenu de la clé
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = Read-Host "Mot de passe de la clé"
$env:RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"
npm run tauri build -- --config src-tauri/tauri.release.conf.json
```

`tauri.release.conf.json` active `bundle.createUpdaterArtifacts` et indique à la CLI où lire la clé publique ; les `.sig` sont écrits à côté des installateurs. Sans cette option, `npm run tauri build` fonctionne comme avant, sans clé ni signature. Ferme ensuite le terminal (ou `Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY*`) pour ne pas laisser le mot de passe dans la session.
