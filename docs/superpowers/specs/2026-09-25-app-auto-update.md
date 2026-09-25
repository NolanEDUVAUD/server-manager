# Mise à jour automatique signée — Design (1.5)

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
L'application se met à jour elle-même à partir des releases GitHub : au démarrage (réglage activé par défaut)
ou à la demande, elle lit le manifeste `latest.json`, propose la nouvelle version avec ses notes, et ne
l'installe qu'après confirmation explicite. Chaque paquet est signé (minisign, format Tauri) et sa signature
est vérifiée avec une clé publique embarquée avant toute installation.

## Hors périmètre
Canaux bêta, retour à une version antérieure, mises à jour différentielles, installation silencieuse sans
confirmation, signature Authenticode de l'installateur (SmartScreen).

## Clés et configuration
- **Clé privée** : jamais dans le dépôt. Le propriétaire la génère sur son PC
  (`npm run tauri signer generate -- -w <chemin hors du dépôt>`) et la dépose dans les secrets GitHub
  `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. `.gitignore` refuse `*.key` et
  `*.key.pub` par précaution.
- **Clé publique** : `src-tauri/updater-pubkey.txt`, versionnée, embarquée à la compilation (`include_str!`).
  Lignes vides, espaces et lignes `#` sont ignorés. Contenu vide ou invalide (pas du base64, pas une clé
  publique minisign, ou une clé **privée** collée par erreur) = mises à jour désactivées : l'interface affiche
  « Mises à jour automatiques non configurées pour cette version », aucune requête réseau n'est faite.
- `tauri.conf.json` : `plugins.updater` avec `pubkey: ""` (champ obligatoire du plugin, remplacé au démarrage
  par la clé embarquée), le point de terminaison GitHub `releases/latest/download/latest.json` (HTTPS) et
  `windows.installMode: "passive"`. **Pas** de `createUpdaterArtifacts` : un `npm run tauri build` local sans
  clé fonctionne comme avant.
- `tauri.release.conf.json` (fusionné par `tauri build --config src-tauri/tauri.release.conf.json`, utilisé par
  la CI) : `bundle.createUpdaterArtifacts: true` et `plugins.updater.pubkey: "updater-pubkey.txt"`. La CLI Tauri
  lit alors la clé publique dans ce fichier (chemin relatif à `src-tauri`) pour vérifier les signatures
  qu'elle vient de produire : la clé n'existe qu'à un seul endroit.
- Windows : installateur NSIS en mode **passif** (`/P /R`) — barre de progression sans question, pas de droits
  administrateur (installation par utilisateur), relance automatique de l'app. L'installation MSI se met à jour
  par le MSI (`/passive`), le plugin choisissant la cible `windows-x86_64-nsis` ou `-msi` du manifeste selon
  l'installateur d'origine.

## Backend (Rust)
- Dépendance `tauri-plugin-updater` 2 (`default-features = false`, `rustls-tls` + `system-proxy` : la
  fonctionnalité `zip` ne sert qu'aux paquets du format Tauri v1).
- Le plugin est toujours enregistré (avec la clé embarquée, éventuellement vide) mais **aucune permission
  `updater:*` n'est accordée à la webview** : seules nos commandes y accèdent.
- `app_update.rs` (logique pure, testée) :
  - `parse_pubkey(raw) -> Option<String>` et `configured_pubkey()` ;
  - `sanitize_notes(Option<&str>)` : CRLF → LF, caractères de contrôle retirés (sauf `\n` et `\t`), 4 000
    caractères au plus (coupure sur une frontière de caractère, suivie de « … ») ;
  - `format_date(unix)` en RFC 3339 ; `validate_version` (1 à 64 caractères `[0-9A-Za-z.+-]`) ;
  - `UpdateCheck { configured, available, version, current_version, date, notes }` ;
  - `ProgressTracker` : cumule les octets reçus, refuse au-delà de 200 Mio (annoncés ou reçus), et ne laisse
    passer un événement de progression qu'à chaque pour-cent (ou tous les 512 Kio si la taille est inconnue) ;
  - `check_with(pubkey, current_version, fetch)` : si la clé n'est pas configurée, renvoie « non configuré »
    **sans appeler** `fetch` (donc sans réseau).
- `commands/app_update.rs`, état géré `AppUpdateState { pending: Mutex<Option<Update>>, installing: AtomicBool }` :
  - `app_update_info()` → `{ configured, current_version }` (aucun accès réseau) ;
  - `app_update_check()` → `UpdateCheck`. Délai maximal 20 s. La mise à jour trouvée est mémorisée pour
    l'installation ; un échec est journalisé (`log::warn`) et renvoyé sous forme de message court en français ;
  - `app_update_install(version)` : la version doit être exactement celle mémorisée par la dernière recherche
    (l'utilisateur installe ce qu'il a vu et confirmé), une seule installation à la fois. Téléchargement
    (délai 10 min, 200 Mio max, interrompu au-delà) avec événements `app-update-progress`
    `{ phase: downloading|verifying|installing, downloaded, total }`, vérification de la signature par le plugin,
    puis installation. Sous Windows, le plugin lance l'installateur et quitte l'application (l'installateur la
    relance) ; ailleurs, `app.restart()`.
- Réglage `general.check_updates` (`#[serde(default = "default_true")]`, en fin de struct).

## Frontend
- Store séparé `useAppUpdate` (Zustand) : `info`, `status` (`idle | checking | up-to-date | available |
  not-configured | error | installing`), `update`, `error`, `progress`, `dismissed` ; actions `loadInfo`,
  `check({ silent })`, `install`, `dismiss`.
- `useAppUpdateCheck` (appelé dans `App`) : une fois les réglages chargés, lit `app_update_info` puis, si la clé
  est configurée et `check_updates` actif, lance une recherche **silencieuse** (échec = retour à `idle`, le
  backend journalise).
- `UpdateBanner` (dans `Layout`, au-dessus du contenu) : version, version installée, date, notes affichées en
  **texte** (`whitespace-pre-wrap`, jamais de HTML injecté), bouton « Installer et redémarrer » derrière un
  `ConfirmDialog` qui décrit le téléchargement, la vérification de signature, l'installation, le redémarrage et
  l'interruption des tâches en cours ; « Plus tard » masque la bannière jusqu'au prochain lancement. Pendant
  l'installation : phase et barre de progression ; en cas d'échec : message lisible et bouton de nouvel essai.
- Paramètres → Général → « Mises à jour de l'application » : version installée, case « Vérifier les mises à jour
  au démarrage », bouton « Rechercher maintenant » avec états chargement / à jour / version disponible /
  erreur / non configuré. À propos affiche la vraie version.

## Workflow de release (`.github/workflows/release.yml`)
- Déclencheurs : tag `v*` et `workflow_dispatch`. Runner `windows-latest`, permissions `contents: write` seules.
- Contrôle que le tag correspond à la version de `tauri.conf.json` ; normalisation de `updater-pubkey.txt`
  (lignes `#` et espaces retirés) et échec explicite si elle est vide.
- `npm ci`, `RUSTFLAGS=--remap-path-prefix=<workspace>=. --remap-path-prefix=<profil du runner>=~`.
- `tauri-apps/tauri-action@v0` avec `--config src-tauri/tauri.release.conf.json`, secrets de signature,
  `updaterJsonPreferNsis`, release **brouillon** : NSIS + MSI + `.sig` + `latest.json`.
- `SHA256SUMS.txt` des installateurs joint à la release (`gh release upload`).
- `latest/download/latest.json` ne pointe que sur la dernière release **publiée** : tant que le brouillon n'est
  pas publié à la main, aucun client ne voit la version.

## Sécurité
- Aucune installation sans signature valide (vérifiée par le plugin avec la clé embarquée) ni sans confirmation.
- Point de terminaison HTTPS fixé à la compilation ; aucune option `dangerous*` ; pas de retour en arrière
  (comparateur par défaut : version distante strictement supérieure).
- Aucune permission du plugin côté webview ; version à installer validée côté Rust et comparée à celle
  mémorisée.
- Notes de version limitées et affichées en texte ; messages d'erreur tronqués.
- Test garde-fou : `tauri.conf.json` ne contient ni clé privée ni `createUpdaterArtifacts: true`, la
  configuration de release l'active, et le fichier de clé publique n'est pas une clé privée.

## Tests
- Rust : clé publique (vide / commentaires / espaces → désactivé, valeur valide → activé, base64 invalide,
  clé privée refusée), notes (troncature, contrôle, CRLF), date, sérialisation de `UpdateCheck`, version
  attendue, `ProgressTracker` (plafond, fréquence des événements), `check_with` désactivé sans appel réseau,
  configurations Tauri et workflow, réglage `check_updates` absent d'un ancien fichier = activé.
- Vitest : bannière affichée quand une version est disponible (notes en texte), installation derrière la
  confirmation, état « non configuré » lisible dans les Paramètres, recherche manuelle (à jour / erreur),
  vérification au démarrage silencieuse et conditionnée au réglage.

## Limites connues
- La CLI Tauri 2.10 n'inscrit pas la version dans le commentaire de confiance de la signature : l'option
  `requireSignedVersion` du plugin reste désactivée. Un serveur capable de modifier `latest.json` (hors
  GitHub/TLS) pourrait associer un ancien paquet signé à un numéro de version plus récent. À activer après
  passage à une CLI qui enregistre la version et re-signature des releases.
- Le plugin ne plafonne pas la taille du manifeste : le délai de 20 s et l'hôte fixe (GitHub, TLS) limitent
  le risque ; les notes sont tronquées après lecture.
- Le code d'installation Windows (lancement NSIS / MSI) est celui du plugin et n'a pas pu être exécuté dans le
  conteneur Linux de développement.
