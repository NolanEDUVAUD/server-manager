# Server Power Manager v2 — Design Spec

**Date** : 2026-03-23
**Scope** : Thèmes CSS, Paramètres restructurés, Export/Import amélioré, Icônes custom
**Exclus** : Intégration OneDrive (phase ultérieure), i18n

---

## 1. Contexte et état actuel

L'application est un bureau Tauri v2 (Rust + React). Les couleurs actuelles sont des valeurs hex statiques dans `tailwind.config.js`, utilisées via des classes Tailwind `win-*`. Le modèle `AppSettings` couvre uniquement réseau (ping, SSH). La page Paramètres est une page unique sans navigation.

**Problèmes à résoudre :**
- Couleurs non changeables à l'exécution → migration vers CSS variables
- Paramètres trop limités → nouveau modèle structuré
- Page Paramètres monolithique → sidebar multi-sections
- Export/Import config basique → dialog natif, versioning, modes merge/replace

---

## 2. Système de thèmes

### 2.1 Architecture CSS variables

**Principe** : deux couches superposées.

**Couche 1 — Variables CSS sur `:root` (runtime)** :
```css
:root {
  --bg-primary: #282c34;
  --bg-secondary: #21252b;
  /* ... 21 variables total */
}
```

**Couche 2 — Tailwind référence les variables** :
```js
// tailwind.config.js
colors: {
  'bg-primary': 'var(--bg-primary)',
  'accent-primary': 'var(--accent-primary)',
}
```

Les composants utilisent des classes comme `bg-bg-primary`, `text-text-primary`, `border-border-primary`. Les couleurs sont résolues via CSS variables au runtime. Changer de thème = appeler `document.documentElement.style.setProperty('--bg-primary', value)` pour chaque variable.

### 2.2 Variables CSS définies (21 variables)

| Variable | Rôle |
|---|---|
| `--bg-primary` | Fond principal de la fenêtre |
| `--bg-secondary` | Fond sidebar, modals |
| `--bg-tertiary` | Fond des cards |
| `--bg-input` | Fond des champs de saisie |
| `--bg-hover` | Fond au survol |
| `--bg-active` | Fond élément actif/sélectionné |
| `--text-primary` | Texte principal |
| `--text-secondary` | Texte secondaire |
| `--text-muted` | Texte désactivé/placeholder |
| `--accent-primary` | Couleur d'accent principale |
| `--accent-secondary` | Couleur d'accent secondaire |
| `--accent-success` | Indicateur succès/online |
| `--accent-warning` | Indicateur avertissement |
| `--accent-error` | Indicateur erreur/offline |
| `--accent-info` | Indicateur information |
| `--border-primary` | Bordure principale |
| `--border-secondary` | Bordure secondaire/subtile |
| `--shadow-color` | Couleur des ombres (rgba) |
| `--scrollbar-thumb` | Poignée scrollbar |
| `--scrollbar-track` | Rail scrollbar |
| `--font-size-base` | Taille de police de base (px) |

### 2.3 Thèmes intégrés

**One Half Dark** (défaut) :
```json
{
  "id": "one-half-dark",
  "name": "One Half Dark",
  "builtin": true,
  "colors": {
    "--bg-primary": "#282c34",
    "--bg-secondary": "#21252b",
    "--bg-tertiary": "#2c313a",
    "--bg-input": "#1e2227",
    "--bg-hover": "#323842",
    "--bg-active": "#3a3f4b",
    "--text-primary": "#abb2bf",
    "--text-secondary": "#7f848e",
    "--text-muted": "#5c6370",
    "--accent-primary": "#61afef",
    "--accent-secondary": "#56b6c2",
    "--accent-success": "#98c379",
    "--accent-warning": "#e5c07b",
    "--accent-error": "#e06c75",
    "--accent-info": "#61afef",
    "--border-primary": "#3e4451",
    "--border-secondary": "#2c313a",
    "--shadow-color": "rgba(0, 0, 0, 0.3)",
    "--scrollbar-thumb": "#3e4451",
    "--scrollbar-track": "#21252b",
    "--font-size-base": "14px"
  }
}
```

**Fluent Dark** (palette actuelle de l'app) :
```json
{
  "id": "fluent-dark",
  "name": "Fluent Dark",
  "builtin": true,
  "colors": {
    "--bg-primary": "#0a0a0f",
    "--bg-secondary": "#111117",
    "--bg-tertiary": "#16161e",
    "--bg-input": "#0d0d14",
    "--bg-hover": "#1e1e2e",
    "--bg-active": "#252535",
    "--text-primary": "#e2e8f0",
    "--text-secondary": "#94a3b8",
    "--text-muted": "#64748b",
    "--accent-primary": "#0078d4",
    "--accent-secondary": "#106ebe",
    "--accent-success": "#16a34a",
    "--accent-warning": "#d97706",
    "--accent-error": "#dc2626",
    "--accent-info": "#0ea5e9",
    "--border-primary": "#2a2a3a",
    "--border-secondary": "#1e1e2e",
    "--shadow-color": "rgba(0, 0, 0, 0.5)",
    "--scrollbar-thumb": "#2a2a3a",
    "--scrollbar-track": "#111117",
    "--font-size-base": "14px"
  }
}
```

### 2.4 Structure d'un thème custom

```typescript
interface Theme {
  id: string;          // slug unique (validé: alphanumérique + tirets)
  name: string;        // nom affiché
  builtin: boolean;    // non supprimable si true
  colors: Record<string, string>; // 21 variables → valeurs hex/rgba/px
}
```

### 2.5 Thèmes builtin — initialisation

Les thèmes builtin sont des **constantes Rust** (`const` ou `lazy_static`) définies dans le code, non stockés dans `data.json`. Lors du chargement des settings (`load_settings()`), la liste retournée au frontend est constituée de :
```
[ONE_HALF_DARK, FLUENT_DARK] + settings.appearance.custom_themes
```
Les thèmes builtin ne peuvent pas être modifiés ni supprimés. `custom_themes` dans `data.json` ne contient que les thèmes créés par l'utilisateur.

### 2.6 `--font-size-base` — priorité des paramètres

`--font-size-base` est présente dans les thèmes pour définir une valeur par défaut cohérente avec la palette. Cependant, lors de l'application d'un thème, `applyTheme()` **exclut `--font-size-base`** de l'injection. La taille de police est toujours pilotée exclusivement par `AppearanceSettings.font_size` et appliquée séparément :

```typescript
function applyFontSize(size: number) {
  document.documentElement.style.setProperty('--font-size-base', `${size}px`);
  document.body.style.fontSize = `${size}px`;
}
```

Cela garantit que changer de thème ne réinitialise pas la taille de police choisie par l'utilisateur.

### 2.7 Injection du thème — gestion du flash initial

Pour éviter un flash de couleurs par défaut entre le rendu React initial et le chargement des settings Tauri, `index.css` contient les variables du thème par défaut ("one-half-dark") directement sur `:root` :

```css
/* index.css — fallback thème par défaut, remplacé dynamiquement au chargement */
:root {
  --bg-primary: #282c34;
  --bg-secondary: #21252b;
  /* ... 21 variables One Half Dark ... */
}
```

Dans `App.tsx`, `applyTheme()` est appelée dès que les settings sont résolus, remplaçant ces valeurs :
```typescript
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}
```

### 2.7 Fichiers impactés par la migration CSS

- `tailwind.config.js` — remplacer les hex par `var(--xxx)`, renommer les clés (`win.*` → noms sémantiques)
- `src/index.css` — ajouter les variables `:root` fallback, mettre à jour scrollbar via variables
- `src/App.tsx` — ajouter `applyTheme()` au chargement
- `src/components/Layout.tsx`, `ServerCard.tsx`, `ServerForm.tsx`, `GroupForm.tsx`, `StatusBadge.tsx`, `ConfirmDialog.tsx`, `Toast.tsx`
- `src/pages/Dashboard.tsx`, `Servers.tsx`, `Groups.tsx`, `Settings.tsx`

**Convention de nommage des classes après migration** :
- `bg-win-bg` → `bg-bg-primary`
- `bg-win-card` → `bg-bg-tertiary`
- `bg-win-surface` → `bg-bg-secondary`
- `text-win-text` → `text-text-primary`
- `text-win-muted` → `text-text-secondary`
- `bg-win-accent` → `bg-accent-primary`
- `border-win-border` → `border-border-primary`
- `bg-win-hover` → `bg-bg-hover`

**Stratégie de migration progressive** (évite les états non compilables) :
1. **Étape 1a** : Ajouter les nouvelles clés dans `tailwind.config.js` (avec `var(--xxx)`) **en plus** des clés `win.*` existantes. Les deux coexistent.
2. **Étape 1b** : Renommer les classes dans les composants **fichier par fichier**, compiler entre chaque fichier pour garantir zéro régression.
3. **Étape 1c** : Supprimer les anciennes clés `win.*` de `tailwind.config.js` une fois tous les composants migrés.

---

## 3. Nouveau modèle AppSettings

### 3.1 Structure Rust

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub network: NetworkSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralSettings {
    pub start_minimized: bool,    // défaut: false
    pub auto_start: bool,         // défaut: false (reflet de l'état registre)
    pub notifications: bool,      // défaut: true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppearanceSettings {
    pub brightness: f32,          // défaut: 1.0, plage: 0.6–1.2
    pub font_size: u8,            // défaut: 14, plage: 12–18
    pub density: Density,         // défaut: Normal
    pub active_theme: String,     // défaut: "one-half-dark"
    pub custom_themes: Vec<Theme>,
}

// Note: opacity retirée car appliquée différemment (voir section 4.3)

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum Density {
    Compact,
    Normal,
    Comfortable,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkSettings {
    pub ping_interval_secs: u64,  // défaut: 30
    pub ping_timeout_ms: u64,     // défaut: 2000
    pub ssh_timeout_secs: u64,    // défaut: 30
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    pub colors: HashMap<String, String>,
}
```

### 3.2 Migration des données au démarrage

L'ancien `data.json` a `settings` au format plat (`ping_interval_secs` à la racine). La migration se fait dans `storage.rs` avec une désérialisation en deux tentatives :

```rust
// Format v1 (ancien)
#[derive(Deserialize)]
struct AppDataV1 {
    servers: Vec<Server>,
    groups: Vec<Group>,
    settings: AppSettingsV1,
    encryption_salt: String,
}

#[derive(Deserialize)]
struct AppSettingsV1 {
    ping_interval_secs: u64,
    ping_timeout_ms: u64,
    ssh_timeout_secs: u64,
}
```

Logique de chargement :
1. Lire `data.json`
2. Tenter `serde_json::from_str::<AppData>()` (format v2)
3. Si échec, tenter `serde_json::from_str::<AppDataV1>()` (format v1)
4. Si succès v1 : convertir vers `AppData` en mappant les champs réseau, initialiser `general` et `appearance` aux valeurs par défaut
5. Sauvegarder immédiatement le fichier migré en format v2
6. Si les deux tentatives échouent : `AppData::default()`

Aucun backup du fichier original n'est nécessaire : la migration est non-destructive (les valeurs réseau sont conservées).

### 3.3 Noms des commandes Tauri (existants conservés)

Les commandes existantes `get_settings` et `update_settings` sont **conservées** avec leurs noms actuels. Le store Zustand appelle déjà ces noms — les renommer casserait l'app. Les nouvelles commandes utilisent des noms distincts.

---

## 4. Page Paramètres restructurée

### 4.1 Layout

```
┌──────────────┬─────────────────────────────────────┐
│  Sidebar     │  Contenu de la section              │
│  (180px)     │                                     │
│  > Général   │  (scrollable indépendamment)        │
│    Apparence │                                     │
│    Réseau    │                                     │
│    Config    │                                     │
│    À propos  │                                     │
└──────────────┴─────────────────────────────────────┘
```

- Sidebar fixe à gauche (180px), contenu scrollable à droite
- Section active : `bg-bg-active` + bordure gauche `accent-primary` (3px)
- Navigation par état local React (`useState<Section>`)

### 4.2 Section Général

| Contrôle | Type | Comportement |
|---|---|---|
| Démarrer minimisé | Toggle | Minimise la fenêtre au démarrage via `appWindow.minimize()` |
| Démarrage automatique | Toggle | Appelle `set_autostart(bool)`, état lu depuis le registre au montage |
| Notifications système | Toggle | Active/désactive les toasts natifs OS via plugin Tauri notification |

**Autostart — commandes** :
- `set_autostart(enabled: bool)` : écrit/supprime la clé `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\ServerPowerManager` avec `std::env::current_exe()` comme valeur, **ET** met à jour `settings.general.auto_start` dans `data.json` via `save_app_data()`. Source de vérité : le registre Windows. `data.json` est mis à jour pour cohérence mais n'est jamais lu à la place du registre pour déterminer l'état réel.
- `get_autostart() -> Result<bool, String>` : lit la clé de registre directement. Appelée au montage de la section Général pour initialiser le toggle avec l'état réel. Si la clé est absente, retourne `false`.

```toml
# Cargo.toml — dépendance conditionnelle Windows uniquement
[target.'cfg(windows)'.dependencies]
winreg = "0.52"
```

### 4.3 Section Apparence

| Contrôle | Type | Plage | Effet |
|---|---|---|---|
| Luminosité | Slider | 60%–120% | CSS `filter: brightness(x)` sur `#app-root` |
| Taille de police | Slider | 12px–18px | Variable CSS `--font-size-base` sur `:root` + `font-size` sur `body` |
| Densité | Boutons radio | Compact/Normal/Confortable | Classe CSS sur `<body>` |
| Thème actif | Cartes de sélection | Builtins + customs | Appelle `applyTheme()` |

**Note sur l'opacité** : L'opacité de fenêtre native (effet verre/acrylique) nécessite `transparent: true` dans `tauri.conf.json` et des modifications du fond de fenêtre côté Rust. Cette fonctionnalité est retirée du scope v2 pour éviter la complexité de la configuration WebView2. Elle peut être ajoutée en phase ultérieure.

**Densité — approche via classe CSS sur `<body>`** :

Tailwind génère les classes à la compilation et ne lit pas les CSS variables au runtime pour les espacements. La densité est implémentée via une classe sur `<body>` (`density-compact`, `density-normal`, `density-comfortable`) que ciblent des overrides CSS dans `index.css` :

```css
/* index.css */
body.density-compact .card { padding: 8px; gap: 4px; }
body.density-normal .card { padding: 16px; gap: 8px; }
body.density-comfortable .card { padding: 24px; gap: 16px; }
```

Les composants exposent des classes cibles (`card`, `form-row`, etc.) que les overrides peuvent cibler sans modifier les composants eux-mêmes.

**Sélecteur de thème** : cartes avec 4 blocs de couleur (bg-primary, bg-tertiary, accent-primary, accent-success). Bordure `accent-primary` sur le thème actif. Bouton "Dupliquer" sur tous les thèmes. Bouton "Supprimer" uniquement sur les thèmes custom.

**Éditeur de thème custom** : section expansible sous la liste. Affiche les 21 variables avec un `<input type="color">` natif par variable. Aperçu instantané (appel `applyTheme()` en live). Champ nom. Boutons Sauvegarder / Annuler.

### 4.4 Section Réseau

Identique à l'actuelle : ping_interval, ping_timeout, ssh_timeout. Commandes existantes conservées.

### 4.5 Section Configuration

| Élément | Description |
|---|---|
| Exporter la configuration | Dialog natif save, `spm-config-YYYY-MM-DD.json`, icône Download |
| Importer une configuration | Dialog natif open (filtre .json), récapitulatif avant application, modes Fusion/Remplacement |
| Réinitialiser les paramètres | Remet AppSettings aux valeurs par défaut, confirmation via ConfirmDialog |
| Chemin du fichier de données | Affiche le chemin, bouton copier |
| Dernier export / dernier import | Timestamps stockés dans settings, affichés en clair |

### 4.6 Section À propos

- Version de l'application (depuis `tauri.conf.json`)
- Stack : Tauri v2, React 18, Rust
- Chiffrement : AES-256-GCM actif
- Pas de liens externes

### 4.7 Icônes custom serveurs

Dans `ServerForm`, le champ `icon` (actuellement texte libre) est remplacé par un picker :

**Option A — Icône Lucide prédéfinie** : liste de ~20 icônes pertinentes (Server, Database, HardDrive, Monitor, Cpu, Globe, Network, Shield, Box, Container, Cloud, Layers, Terminal, Wifi, Zap...). L'icône sélectionnée est stockée comme son nom Lucide (ex: `"lucide:Server"`).

**Option B — Image custom** : bouton "Choisir un fichier" ouvre un dialog Tauri (filtre PNG/SVG). La commande `upload_server_icon(server_id, file_path)` reçoit le **chemin du fichier** (pas du base64), copie l'image dans `{app_data_dir}/icons/{server_id}.{ext}`, retourne le nom du fichier. Le champ `server.icon` stocke `"file:server_id.png"`. L'affichage utilise le protocole `asset://` de Tauri.

```rust
// Cargo.toml — commande
// Pas de nouvelle dépendance : std::fs::copy suffit
async fn upload_server_icon(server_id: String, file_path: String, state: State<AppState>) -> Result<String, String>
```

---

## 5. Export/Import config amélioré

### 5.1 Commandes Tauri

**`export_full_config()`** :
1. Sérialise serveurs, groupes, settings (mots de passe SSH exclus)
2. Ajoute `config_version: "2.0"` et `exported_at: ISO8601`
3. Ouvre dialog natif `save_file` (filtre `.json`, nom par défaut `spm-config-YYYY-MM-DD.json`)
4. Écrit le fichier à l'emplacement choisi
5. Met à jour `last_export_at` dans `data.json`

**`import_full_config()`** :
1. Ouvre dialog natif `open_file` (filtre `.json`)
2. Lit et parse le fichier
3. Valide le schéma (voir section 5.3)
4. Stocke les données parsées dans `AppState.pending_import: Mutex<Option<PendingImport>>` (évite de retransmettre le JSON via IPC une seconde fois)
5. Retourne `ImportSummary { servers_count, groups_count, settings_present, config_version, exported_at }`

**`apply_import_config(mode: ImportMode)`** :
1. Récupère `pending_import` depuis `AppState`
2. Applique selon le mode :
   - **Merge** : ajoute serveurs/groupes absents (dédoublonnage par IP), ne modifie pas les existants
   - **Replace** : écrase toute la configuration (confirmation ConfirmDialog côté frontend avant cet appel)
3. Vide `pending_import` (le remet à `None`)
4. Sauvegarde `data.json`

**Cycle de vie de `pending_import`** : si l'utilisateur appelle `import_full_config()` une seconde fois sans avoir appelé `apply_import_config()`, l'ancienne `pending_import` est simplement écrasée par la nouvelle. Si l'utilisateur quitte la section sans confirmer, `pending_import` reste en mémoire jusqu'à la fermeture de l'application (comportement acceptable — aucune donnée n'est modifiée tant que `apply_import_config` n'est pas appelée).

```rust
pub struct PendingImport {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: Option<AppSettings>,
    pub config_version: String,
}

pub enum ImportMode {
    Merge,
    Replace,
}
```

### 5.2 Format du fichier exporté

```json
{
  "config_version": "2.0",
  "exported_at": "2026-03-23T14:30:00Z",
  "servers": [...],
  "groups": [...],
  "settings": {
    "general": { "start_minimized": false, "auto_start": false, "notifications": true },
    "appearance": { "active_theme": "one-half-dark", "brightness": 1.0, "font_size": 14, "density": "Normal", "custom_themes": [] },
    "network": { "ping_interval_secs": 30, "ping_timeout_ms": 2000, "ssh_timeout_secs": 30 }
  }
}
```

### 5.3 Validation schéma à l'import

Vérifications obligatoires :
- `config_version` présent (string)
- `servers` est un tableau
- `groups` est un tableau
- Chaque serveur a `id`, `name`, `ip`, `mac_address` (strings non vides)
- `settings` : si présent, doit avoir `general`, `appearance`, `network` (format v2). Si `settings` est absent ou dans l'ancien format v1, les settings importés sont ignorés silencieusement (seuls serveurs et groupes sont importés).
- En cas d'erreur, retourner un message descriptif : `"Champ 'servers[2].ip' manquant"`, `"Format 'settings' incompatible (v1 détecté, ignoré)"`.

---

## 6. Nouvelles commandes Tauri

| Commande | Paramètres | Retour |
|---|---|---|
| `export_full_config()` | — | `Result<String, String>` (chemin du fichier) |
| `import_full_config()` | — | `Result<ImportSummary, String>` |
| `apply_import_config(mode)` | `mode: "merge"\|"replace"` | `Result<(), String>` |
| `save_custom_theme(theme)` | `Theme` | `Result<(), String>` |
| `delete_custom_theme(id)` | `String` | `Result<(), String>` |
| `set_autostart(enabled)` | `bool` | `Result<(), String>` |
| `get_autostart()` | — | `Result<bool, String>` |
| `upload_server_icon(server_id, file_path)` | `String, String` | `Result<String, String>` (nom fichier) |

**Commandes existantes conservées sans changement** : `get_settings`, `update_settings`, `export_config`, `import_config`, `get_data_path`.

Note : `export_config` et `import_config` (anciens) peuvent coexister avec `export_full_config` / `import_full_config` (nouveaux). Les anciens sont dépréciés mais non supprimés pour éviter la casse du store existant.

---

## 7. Dépendances à ajouter

### npm

```json
"@tauri-apps/plugin-dialog": "^2",
"@tauri-apps/plugin-notification": "^2"
```

### Cargo.toml

```toml
[dependencies]
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"

[target.'cfg(windows)'.dependencies]
winreg = "0.52"
```

### tauri.conf.json

```json
{
  "plugins": {
    "dialog": {},
    "notification": {}
  }
}
```

### lib.rs (initialisation des plugins)

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(...)
```

---

## 8. Ordre d'implémentation (Approche A)

1. **Migration CSS — étape 1a** : ajouter les nouvelles clés CSS-variable dans `tailwind.config.js` (coexistence avec `win.*`)
2. **Migration CSS — étape 1b** : renommer les classes composant par composant, compiler entre chaque fichier
3. **Migration CSS — étape 1c** : supprimer les anciennes clés `win.*`, nettoyer `index.css`
4. **Modèle Rust** : nouveau `AppSettings`, `AppSettingsV1` pour migration, `Theme` struct, `PendingImport`, `Density`
5. **Plugin deps** : ajouter dialog + notification dans Cargo.toml, package.json, tauri.conf.json, lib.rs
6. **Nouvelles commandes Tauri** : export_full_config, import_full_config, apply_import_config, save/delete_custom_theme, set/get_autostart, upload_server_icon
7. **Store Zustand** : nouveaux slices (appearance, general, themes), `applyTheme()`, `pendingImport` state
8. **Settings page** : sidebar + 5 sections (Général, Apparence, Réseau, Configuration, À propos)
9. **Sélecteur et éditeur de thèmes** : cartes, color picker, preview live
10. **Export/Import amélioré** : dialog natif, récapitulatif, modes merge/replace
11. **Icônes custom serveurs** : picker Lucide + upload image dans ServerForm
12. **Tests manuels** : compilation Tauri, chaque feature

---

## 9. Contraintes techniques

- Aucune librairie UI tierce
- Icônes Lucide uniquement (sauf icônes uploadées via `asset://`)
- Animations CSS max 150ms
- Rust : `Result<T, String>` pour toutes les commandes
- Mots de passe SSH jamais dans les exports
- Tous les contrôles stylistiquement cohérents avec le thème actif via CSS variables
- `winreg` déclaré en `[target.'cfg(windows)'.dependencies]` uniquement
