# Server Power Manager

Outil de bureau Windows tout-en-un pour gérer et surveiller un homelab : Wake-on-LAN, arrêt/redémarrage SSH, supervision en temps réel, Proxmox, Docker, console SSH, tâches planifiées, alertes et bien plus.

Construit avec **Tauri v2** (backend Rust) et **React + TypeScript + Tailwind** — binaire léger, interface style Windows 11.

## Fonctionnalités

- **Serveurs & groupes** : ajout/édition avec validation, actions groupées en 1 clic (WoL, arrêt, ping), import/export JSON
- **Alimentation** : Wake-on-LAN, arrêt et redémarrage par SSH avec commande personnalisable par OS
- **Supervision** : statut et latence en temps réel, ressources (CPU, RAM, disque), historique des événements, sondes de services, alertes (ntfy, webhook…)
- **Proxmox** : état du cluster, VM/CT, sauvegardes, migration
- **Docker** : conteneurs et images à mettre à jour
- **Console SSH** intégrée, snippets, tâches en lot sur plusieurs serveurs
- **Planificateur** : tâches programmées, avec création des cronjobs directement sur les serveurs Linux
- **Mises à jour** (apt), **réseau**, **logs** (Loki), zone de notification Windows

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

## Données et sécurité

- La configuration est stockée dans `%APPDATA%\com.homelab.server-manager\`.
- Les mots de passe et jetons sont chiffrés (AES-256-GCM) avec une clé maître conservée dans le **Gestionnaire d'identification Windows**, jamais en clair sur le disque.
- L'export JSON de la configuration n'inclut pas les mots de passe SSH (à ressaisir après un import).

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
