# Server Power Manager v2 — Plan d'implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrer vers un système de thèmes CSS variables, restructurer la page Paramètres avec sidebar multi-sections, améliorer l'export/import de config, et ajouter des icônes custom pour les serveurs.

**Architecture:** Migration CSS progressive (coexistence → renommage → nettoyage), nouveau modèle AppSettings imbriqué avec migration v1→v2 en Rust, nouvelles commandes Tauri, page Paramètres restructurée avec 5 sections.

**Tech Stack:** Tauri v2, Rust (serde, chrono, winreg[windows], tauri-plugin-dialog, tauri-plugin-notification), React 18, TypeScript, Tailwind CSS 3, Zustand 4, Lucide React.

---

## Structure des fichiers

**Fichiers créés :**
- `src/utils/theme.ts` — applyTheme(), applyFontSize(), constantes BUILTIN_THEMES
- `src/components/ThemeCard.tsx` — carte de prévisualisation d'un thème
- `src/components/ThemeEditor.tsx` — éditeur couleur (color pickers)
- `src/components/IconPicker.tsx` — picker d'icônes Lucide + upload fichier

**Fichiers modifiés :**
- `tailwind.config.js` — clés CSS variables (coexistence puis nettoyage)
- `src/index.css` — variables `:root` fallback + classes densité
- `src/App.tsx` — applyTheme() + applyFontSize() au démarrage
- `src/types/index.ts` — Theme, AppSettings v2, ImportSummary, Density
- `src/stores/useStore.ts` — slices appearance, general, themes, pendingImport
- `src/components/Layout.tsx`, `ServerCard.tsx`, `ServerForm.tsx`, `GroupForm.tsx`, `StatusBadge.tsx`, `ConfirmDialog.tsx`, `Toast.tsx` — renommage classes win-*
- `src/pages/Dashboard.tsx`, `Servers.tsx`, `Groups.tsx` — renommage classes win-*
- `src/pages/Settings.tsx` — réécriture complète avec sidebar
- `src-tauri/src/models.rs` — AppSettings v2, Theme, PendingImport, Density, AppSettingsV1
- `src-tauri/src/storage.rs` — logique de migration v1→v2
- `src-tauri/src/lib.rs` — enregistrement nouvelles commandes + plugins
- `src-tauri/src/commands/settings.rs` — export/import/themes/autostart
- `src-tauri/src/commands/servers.rs` — upload_server_icon
- `src-tauri/Cargo.toml` — nouvelles dépendances
- `src-tauri/tauri.conf.json` — plugins + asset protocol

---

## Task 1 : CSS Variables — Fondation tailwind.config.js

**Files:**
- Modify: `tailwind.config.js`

- [ ] **Étape 1 : Ajouter les nouvelles clés CSS-variable dans tailwind.config.js**

Ouvrir `tailwind.config.js`. Dans `theme.extend.colors`, ajouter les nouvelles clés **en plus** des clés `win.*` existantes (ne pas encore supprimer) :

```js
// tailwind.config.js
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // === NOUVELLES CLÉS CSS VARIABLES (thème dynamique) ===
        'bg-primary':    'var(--bg-primary)',
        'bg-secondary':  'var(--bg-secondary)',
        'bg-tertiary':   'var(--bg-tertiary)',
        'bg-input':      'var(--bg-input)',
        'bg-hover':      'var(--bg-hover)',
        'bg-active':     'var(--bg-active)',
        'text-primary':  'var(--text-primary)',
        'text-secondary':'var(--text-secondary)',
        'text-muted':    'var(--text-muted)',
        'accent-primary':  'var(--accent-primary)',
        'accent-secondary':'var(--accent-secondary)',
        'accent-success':  'var(--accent-success)',
        'accent-warning':  'var(--accent-warning)',
        'accent-error':    'var(--accent-error)',
        'accent-info':     'var(--accent-info)',
        'border-primary':  'var(--border-primary)',
        'border-secondary':'var(--border-secondary)',
        // === ANCIENNES CLÉS win.* (conservées temporairement) ===
        win: {
          bg:      '#0a0a0f',
          surface: '#111117',
          card:    '#16161e',
          border:  '#2a2a3a',
          hover:   '#1e1e2e',
          accent:  '#0078d4',
          muted:   '#94a3b8',
          text:    '#e2e8f0',
        },
        status: {
          online:  '#16a34a',
          offline: '#dc2626',
          unknown: '#64748b',
          warning: '#d97706',
        },
      },
      // Conserver le reste (borderRadius, boxShadow, animation, fontFamily) tel quel
    },
  },
  plugins: [],
}
```

- [ ] **Étape 2 : Vérifier que Tailwind génère bien les nouvelles classes**

```bash
cd c:/Users/user/OneDrive/02_Developpement/SERVEURS/server-manager
npm run dev
```

Ouvrir le navigateur, inspecter un élément. Vérifier qu'ajouter manuellement la classe `bg-bg-primary` à un élément dans les DevTools produit une couleur (peut être transparente à ce stade — les variables CSS n'ont pas encore de valeur). Arrêter le serveur dev.

- [ ] **Étape 3 : Commit**

```bash
git add tailwind.config.js
git commit -m "feat: add CSS variable-based Tailwind color keys (coexistence with win.*)"
```

---

## Task 2 : CSS Variables — Variables :root dans index.css

**Files:**
- Modify: `src/index.css`

- [ ] **Étape 1 : Remplacer le contenu de index.css**

```css
/* src/index.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* === VARIABLES CSS — Thème One Half Dark (fallback avant chargement des settings) === */
:root {
  --bg-primary:     #282c34;
  --bg-secondary:   #21252b;
  --bg-tertiary:    #2c313a;
  --bg-input:       #1e2227;
  --bg-hover:       #323842;
  --bg-active:      #3a3f4b;
  --text-primary:   #abb2bf;
  --text-secondary: #7f848e;
  --text-muted:     #5c6370;
  --accent-primary:   #61afef;
  --accent-secondary: #56b6c2;
  --accent-success:   #98c379;
  --accent-warning:   #e5c07b;
  --accent-error:     #e06c75;
  --accent-info:      #61afef;
  --border-primary:   #3e4451;
  --border-secondary: #2c313a;
  --shadow-color:     rgba(0, 0, 0, 0.3);
  --scrollbar-thumb:  #3e4451;
  --scrollbar-track:  #21252b;
  --font-size-base:   14px;
}

@layer base {
  * { box-sizing: border-box; }

  body {
    font-family: 'Segoe UI Variable', 'Segoe UI', Inter, system-ui, sans-serif;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--font-size-base);
    -webkit-user-select: none;
    user-select: none;
  }

  input, textarea, select {
    -webkit-user-select: text;
    user-select: text;
  }

  /* Scrollbar */
  ::-webkit-scrollbar       { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--accent-primary); }
}

/* === DENSITÉ — appliquée via classe sur <body> === */
body.density-compact  .card { padding: 8px;  gap: 4px; }
body.density-normal   .card { padding: 16px; gap: 8px; }
body.density-comfortable .card { padding: 24px; gap: 16px; }

body.density-compact  .form-row { gap: 8px; margin-bottom: 8px; }
body.density-normal   .form-row { gap: 12px; margin-bottom: 12px; }
body.density-comfortable .form-row { gap: 16px; margin-bottom: 20px; }
```

- [ ] **Étape 2 : Lancer le dev server et vérifier le fond**

```bash
npm run dev
```

La fenêtre doit avoir un fond `#282c34` (One Half Dark) depuis les variables CSS. Si le fond est toujours noir (`#0a0a0f`), les variables `win.*` dans Tailwind prennent le dessus sur les composants — c'est normal à ce stade, les composants utilisent encore les classes `bg-win-bg`.

- [ ] **Étape 3 : Commit**

```bash
git add src/index.css
git commit -m "feat: add CSS custom properties :root fallback (One Half Dark theme)"
```

---

## Task 3 : Migration CSS — Layout.tsx + App.tsx

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/App.tsx`

**Table de correspondance des classes :**
| Ancienne classe | Nouvelle classe |
|---|---|
| `bg-win-bg` | `bg-bg-primary` |
| `bg-win-surface` | `bg-bg-secondary` |
| `bg-win-card` | `bg-bg-tertiary` |
| `bg-win-hover` | `bg-bg-hover` |
| `bg-win-accent` | `bg-accent-primary` |
| `text-win-text` | `text-text-primary` |
| `text-win-muted` | `text-text-secondary` |
| `border-win-border` | `border-border-primary` |
| `bg-status-online` | `bg-accent-success` |
| `bg-status-offline` | `bg-accent-error` |
| `bg-status-unknown` | `bg-text-muted` |

- [ ] **Étape 1 : Rechercher toutes les classes win-* dans Layout.tsx**

```bash
grep -n "win-\|status-" src/components/Layout.tsx
```

- [ ] **Étape 2 : Remplacer les classes dans Layout.tsx** selon la table ci-dessus. Utiliser Rechercher/Remplacer dans l'éditeur.

- [ ] **Étape 3 : Vérifier la compilation**

```bash
npm run build 2>&1 | head -30
```

Aucune erreur TypeScript attendue (c'est une migration de classes CSS, pas de types).

- [ ] **Étape 4 : Répéter pour App.tsx** — même processus grep + remplacement.

- [ ] **Étape 5 : Vérifier visuellement**

```bash
npm run dev
```

Le layout (sidebar + contenu) doit s'afficher avec les couleurs One Half Dark.

- [ ] **Étape 6 : Commit**

```bash
git add src/components/Layout.tsx src/App.tsx
git commit -m "feat: migrate Layout.tsx and App.tsx to CSS variable classes"
```

---

## Task 4 : Migration CSS — Composants

**Files:**
- Modify: `src/components/ServerCard.tsx`
- Modify: `src/components/ServerForm.tsx`
- Modify: `src/components/GroupForm.tsx`
- Modify: `src/components/StatusBadge.tsx`
- Modify: `src/components/ConfirmDialog.tsx`
- Modify: `src/components/Toast.tsx`

- [ ] **Étape 1 : Rechercher toutes les occurrences win-* dans les composants**

```bash
grep -rn "win-\|status-" src/components/
```

Noter la liste des fichiers et lignes.

- [ ] **Étape 2 : Migrer chaque composant** en appliquant la table de correspondance de la Task 3. Un fichier à la fois, compiler après chaque.

Pour StatusBadge.tsx, la correspondance status est particulière :
- `bg-status-online` → `bg-accent-success`
- `text-status-online` → `text-accent-success`
- `bg-status-offline` → `bg-accent-error`
- `bg-status-unknown` → `bg-text-muted`

Pour Toast.tsx, les couleurs de type toast :
- Type `success` → utiliser `--accent-success`
- Type `error` → utiliser `--accent-error`
- Type `warning` → utiliser `--accent-warning`
- Type `info` → utiliser `--accent-info`

- [ ] **Étape 3 : Compiler après chaque fichier**

```bash
npm run build 2>&1 | grep -i error
```

- [ ] **Étape 4 : Test visuel complet**

```bash
npm run dev
```

Naviguer dans Dashboard, Servers, Groups. Vérifier les cards, badges de statut, formulaires, toasts.

- [ ] **Étape 5 : Commit**

```bash
git add src/components/
git commit -m "feat: migrate all components to CSS variable classes"
```

---

## Task 5 : Migration CSS — Pages + Nettoyage final

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Servers.tsx`
- Modify: `src/pages/Groups.tsx`
- Modify: `tailwind.config.js` (suppression clés win.*)

- [ ] **Étape 1 : Rechercher les classes win-* dans les pages**

```bash
grep -rn "win-\|status-" src/pages/
```

- [ ] **Étape 2 : Migrer Dashboard.tsx, Servers.tsx, Groups.tsx** selon la table de Task 3.

Note : `Settings.tsx` sera entièrement réécrit en Task 14, ne pas migrer maintenant.

- [ ] **Étape 3 : Compiler**

```bash
npm run build 2>&1 | grep -i error
```

- [ ] **Étape 4 : Supprimer les anciennes clés win.* de tailwind.config.js**

Retirer le bloc `win: { bg, surface, card, border, hover, accent, muted, text }` et le bloc `status: { online, offline, unknown, warning }`. Les classes `win-*` et `status-*` ne doivent plus exister dans les composants à ce stade.

- [ ] **Étape 5 : Vérification finale — aucune classe win-* restante**

```bash
grep -rn "win-\|status-" src/ --include="*.tsx" --include="*.ts"
```

Résultat attendu : aucune ligne.

- [ ] **Étape 6 : Build complet**

```bash
npm run build
```

Aucune erreur attendue.

- [ ] **Étape 7 : Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Servers.tsx src/pages/Groups.tsx tailwind.config.js
git commit -m "feat: complete CSS migration — remove win.* Tailwind keys"
```

---

## Task 6 : Modèle Rust — AppSettings v2 + migration + tests

**Files:**
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/storage.rs`

- [ ] **Étape 1 : Écrire les tests unitaires de migration dans models.rs**

Ajouter à la fin de `src-tauri/src/models.rs` :

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_migrate_v1_settings_preserves_network() {
        let v1 = AppSettingsV1 {
            ping_interval_secs: 60,
            ping_timeout_ms: 3000,
            ssh_timeout_secs: 45,
        };
        let v2 = AppSettings::from_v1(v1);
        assert_eq!(v2.network.ping_interval_secs, 60);
        assert_eq!(v2.network.ping_timeout_ms, 3000);
        assert_eq!(v2.network.ssh_timeout_secs, 45);
        assert_eq!(v2.appearance.active_theme, "one-half-dark");
        assert!(!v2.general.start_minimized);
        assert!(v2.general.notifications);
    }

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.network.ping_interval_secs, 30);
        assert_eq!(settings.appearance.font_size, 14);
        assert_eq!(settings.appearance.active_theme, "one-half-dark");
    }
}
```

- [ ] **Étape 2 : Vérifier que les tests échouent (modèles pas encore mis à jour)**

```bash
cd src-tauri && cargo test 2>&1 | head -20
```

Attendu : erreur de compilation (AppSettings::from_v1 n'existe pas).

- [ ] **Étape 3 : Remplacer AppSettings dans models.rs**

Remplacer toute la section des structs de settings dans `models.rs` :

```rust
use std::collections::HashMap;

// ─── Thème ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub builtin: bool,
    pub colors: HashMap<String, String>,
}

// ─── Density ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Default)]
pub enum Density {
    Compact,
    #[default]
    Normal,
    Comfortable,
}

// ─── AppSettings v2 ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneralSettings {
    pub start_minimized: bool,
    pub auto_start: bool,
    pub notifications: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self { start_minimized: false, auto_start: false, notifications: true }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppearanceSettings {
    pub brightness: f32,
    pub font_size: u8,
    pub density: Density,
    pub active_theme: String,
    pub custom_themes: Vec<Theme>,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            font_size: 14,
            density: Density::Normal,
            active_theme: "one-half-dark".to_string(),
            custom_themes: vec![],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkSettings {
    pub ping_interval_secs: u64,
    pub ping_timeout_ms: u64,
    pub ssh_timeout_secs: u64,
}

impl Default for NetworkSettings {
    fn default() -> Self {
        Self { ping_interval_secs: 30, ping_timeout_ms: 2000, ssh_timeout_secs: 30 }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
    pub general: GeneralSettings,
    pub appearance: AppearanceSettings,
    pub network: NetworkSettings,
}

impl AppSettings {
    pub fn from_v1(v1: AppSettingsV1) -> Self {
        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            network: NetworkSettings {
                ping_interval_secs: v1.ping_interval_secs,
                ping_timeout_ms: v1.ping_timeout_ms,
                ssh_timeout_secs: v1.ssh_timeout_secs,
            },
        }
    }
}

// ─── Format v1 pour migration ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AppSettingsV1 {
    pub ping_interval_secs: u64,
    pub ping_timeout_ms: u64,
    pub ssh_timeout_secs: u64,
}

#[derive(Debug, Deserialize)]
pub struct AppDataV1 {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettingsV1,
    pub encryption_salt: String,
}

// ─── PendingImport ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingImport {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: Option<AppSettings>,
    pub config_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportSummary {
    pub servers_count: usize,
    pub groups_count: usize,
    pub settings_present: bool,
    pub config_version: String,
    pub exported_at: Option<String>,
}
```

Mettre à jour `AppData` pour utiliser le nouveau `AppSettings` :
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppData {
    pub servers: Vec<Server>,
    pub groups: Vec<Group>,
    pub settings: AppSettings,
    pub encryption_salt: String,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            servers: vec![],
            groups: vec![],
            settings: AppSettings::default(),
            encryption_salt: crate::crypto::generate_salt(),
        }
    }
}
```

- [ ] **Étape 4 : Mettre à jour storage.rs — logique de migration**

Dans la fonction `load_app_data()` de `storage.rs`, remplacer la logique de lecture par :

```rust
pub fn load_app_data(path: &std::path::Path) -> AppData {
    if !path.exists() {
        return AppData::default();
    }
    let content = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return AppData::default(),
    };
    // Tentative 1 : format v2
    if let Ok(data) = serde_json::from_str::<AppData>(&content) {
        return data;
    }
    // Tentative 2 : format v1 → migration
    if let Ok(v1) = serde_json::from_str::<AppDataV1>(&content) {
        log::info!("Migration AppData v1 → v2");
        let data = AppData {
            servers: v1.servers,
            groups: v1.groups,
            settings: AppSettings::from_v1(v1.settings),
            encryption_salt: v1.encryption_salt,
        };
        // Sauvegarder immédiatement en format v2
        if let Ok(json) = serde_json::to_string_pretty(&data) {
            let _ = std::fs::write(path, json);
        }
        return data;
    }
    AppData::default()
}
```

Mettre à jour `AppState` pour ajouter `pending_import` :
```rust
pub struct AppState {
    pub data: Mutex<AppData>,
    pub data_path: std::path::PathBuf,
    pub pending_import: Mutex<Option<PendingImport>>,
}
```

Adapter le constructeur de `AppState` en conséquence (ajouter `pending_import: Mutex::new(None)`).

- [ ] **Étape 5 : Lancer les tests**

```bash
cd src-tauri && cargo test 2>&1
```

Attendu : les 2 tests passent.

- [ ] **Étape 6 : Compiler le projet complet**

```bash
cd .. && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

Corriger les erreurs de compilation liées aux changements de type (notamment dans `commands/settings.rs` qui référence l'ancien `AppSettings` plat).

- [ ] **Étape 7 : Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/storage.rs
git commit -m "feat: AppSettings v2 with migration from v1, PendingImport, Theme model"
```

---

## Task 7 : Plugins Tauri — dialog + notification + winreg

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Étape 1 : Ajouter les dépendances dans Cargo.toml**

Dans la section `[dependencies]` :
```toml
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
chrono = { version = "0.4", features = ["serde"] }
```

Dans la section `[target.'cfg(windows)'.dependencies]` (créer si absente) :
```toml
[target.'cfg(windows)'.dependencies]
winreg = "0.52"
```

- [ ] **Étape 2 : Installer les packages npm**

```bash
npm install @tauri-apps/plugin-dialog@^2 @tauri-apps/plugin-notification@^2
```

- [ ] **Étape 3 : Configurer tauri.conf.json**

Ajouter dans l'objet racine :
```json
{
  "plugins": {
    "dialog": {},
    "notification": {}
  },
  "security": {
    "csp": null,
    "assetProtocol": {
      "enable": true,
      "scope": ["$APPDATA/**"]
    }
  }
}
```

- [ ] **Étape 4 : Initialiser les plugins dans lib.rs**

```rust
// src-tauri/src/lib.rs
use tauri_plugin_dialog;
use tauri_plugin_notification;

tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .manage(app_state)
    .invoke_handler(tauri::generate_handler![...])
    // ...
```

- [ ] **Étape 5 : Compiler**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

- [ ] **Étape 6 : Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/src/lib.rs package.json package-lock.json
git commit -m "feat: add dialog, notification, winreg dependencies"
```

---

## Task 8 : Commandes Rust — Autostart (Windows registry)

**Files:**
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Étape 1 : Ajouter get_autostart et set_autostart dans settings.rs**

```rust
// src-tauri/src/commands/settings.rs
#[cfg(windows)]
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const AUTOSTART_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_VALUE: &str = "ServerPowerManager";

#[tauri::command]
pub fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu.open_subkey(AUTOSTART_KEY)
            .map_err(|e| e.to_string())?;
        Ok(run_key.get_value::<String, _>(AUTOSTART_VALUE).is_ok())
    }
    #[cfg(not(windows))]
    Ok(false)
}

#[tauri::command]
pub fn set_autostart(
    enabled: bool,
    state: tauri::State<crate::storage::AppState>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = hkcu
            .create_subkey(AUTOSTART_KEY)
            .map_err(|e| e.to_string())?;
        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .to_string();
            run_key.set_value(AUTOSTART_VALUE, &exe_path)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = run_key.delete_value(AUTOSTART_VALUE);
        }
    }
    // Mettre à jour data.json en miroir
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.settings.general.auto_start = enabled;
    state.save_data(&data).map_err(|e| e.to_string())
}
```

- [ ] **Étape 2 : Enregistrer les commandes dans lib.rs**

Ajouter `get_autostart` et `set_autostart` dans `tauri::generate_handler![]`.

- [ ] **Étape 3 : Compiler**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

- [ ] **Étape 4 : Commit**

```bash
git add src-tauri/src/commands/settings.rs src-tauri/src/lib.rs
git commit -m "feat: add get_autostart/set_autostart commands (Windows registry)"
```

---

## Task 9 : Commandes Rust — Export/Import config

**Files:**
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Étape 1 : Ajouter les tests unitaires de validation**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_import_json_valid() {
        let json = r#"{
            "config_version": "2.0",
            "servers": [{"id":"1","name":"srv","ip":"1.1.1.1","mac_address":"AA:BB:CC:DD:EE:FF","ssh_user":"root","ssh_password":"","ssh_port":22,"shutdown_command":"poweroff","reboot_command":"reboot","os_type":"Linux","icon":null,"notes":null}],
            "groups": []
        }"#;
        let result = validate_import_json(json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_import_json_missing_version() {
        let json = r#"{"servers":[],"groups":[]}"#;
        let result = validate_import_json(json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("config_version"));
    }

    #[test]
    fn test_validate_import_json_missing_ip() {
        let json = r#"{
            "config_version":"2.0",
            "servers":[{"id":"1","name":"srv","mac_address":"AA:BB:CC:DD:EE:FF"}],
            "groups":[]
        }"#;
        let result = validate_import_json(json);
        assert!(result.is_err());
    }
}
```

- [ ] **Étape 2 : Vérifier que les tests échouent**

```bash
cd src-tauri && cargo test commands::settings::tests 2>&1
```

- [ ] **Étape 3 : Implémenter validate_import_json + commandes export/import**

```rust
use tauri_plugin_dialog::DialogExt;
use chrono::Utc; // Ajouter chrono = "0.4" dans Cargo.toml si nécessaire, ou utiliser std::time

fn validate_import_json(json: &str) -> Result<serde_json::Value, String> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| format!("JSON invalide : {}", e))?;
    if v.get("config_version").is_none() {
        return Err("Champ 'config_version' manquant".to_string());
    }
    let servers = v.get("servers").and_then(|s| s.as_array())
        .ok_or("Champ 'servers' manquant ou invalide")?;
    let _ = v.get("groups").and_then(|g| g.as_array())
        .ok_or("Champ 'groups' manquant ou invalide")?;
    for (i, srv) in servers.iter().enumerate() {
        for field in &["id", "name", "ip", "mac_address"] {
            if srv.get(field).and_then(|f| f.as_str()).map(|s| s.is_empty()).unwrap_or(true) {
                return Err(format!("Champ 'servers[{}].{}' manquant ou vide", i, field));
            }
        }
    }
    Ok(v)
}

#[tauri::command]
pub async fn export_full_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<String, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    // Exclure les mots de passe SSH
    let servers_clean: Vec<serde_json::Value> = data.servers.iter().map(|s| {
        let mut v = serde_json::to_value(s).unwrap();
        v["ssh_password"] = serde_json::Value::String(String::new());
        v
    }).collect();
    let exported_at = format_timestamp_now();
    let export = serde_json::json!({
        "config_version": "2.0",
        "exported_at": exported_at,
        "servers": servers_clean,
        "groups": data.groups,
        "settings": data.settings,
    });
    let json = serde_json::to_string_pretty(&export).map_err(|e| e.to_string())?;
    // Dialog natif save
    let file_path = app.dialog()
        .file()
        .set_title("Exporter la configuration")
        .set_file_name(&format!("spm-config-{}.json", &exported_at[..10]))
        .add_filter("JSON", &["json"])
        .blocking_save_file();
    let path = match file_path {
        Some(p) => p,
        None => return Err("Export annulé".to_string()),
    };
    std::fs::write(&path, &json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

fn format_timestamp_now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub async fn import_full_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<crate::models::ImportSummary, String> {
    let file_path = app.dialog()
        .file()
        .set_title("Importer une configuration")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();
    let path = match file_path {
        Some(p) => p,
        None => return Err("Import annulé".to_string()),
    };
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v = validate_import_json(&content)?;
    let servers: Vec<crate::models::Server> = serde_json::from_value(
        v["servers"].clone()
    ).map_err(|e| format!("Erreur parsing servers : {}", e))?;
    let groups: Vec<crate::models::Group> = serde_json::from_value(
        v["groups"].clone()
    ).map_err(|e| format!("Erreur parsing groups : {}", e))?;
    // Settings : tenter le format v2, ignorer si absent ou v1
    let settings: Option<crate::models::AppSettings> = v.get("settings")
        .and_then(|s| serde_json::from_value(s.clone()).ok());
    let summary = crate::models::ImportSummary {
        servers_count: servers.len(),
        groups_count: groups.len(),
        settings_present: settings.is_some(),
        config_version: v["config_version"].as_str().unwrap_or("?").to_string(),
        exported_at: v.get("exported_at").and_then(|d| d.as_str()).map(|s| s.to_string()),
    };
    // Stocker en mémoire (pas de retransfer IPC)
    *state.pending_import.lock().map_err(|e| e.to_string())? = Some(
        crate::models::PendingImport { servers, groups, settings, config_version: summary.config_version.clone() }
    );
    Ok(summary)
}

#[tauri::command]
pub fn apply_import_config(
    mode: String,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    let pending = state.pending_import.lock().map_err(|e| e.to_string())?
        .take()
        .ok_or("Aucun import en attente")?;
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    match mode.as_str() {
        "replace" => {
            data.servers = pending.servers;
            data.groups = pending.groups;
            if let Some(s) = pending.settings { data.settings = s; }
        }
        "merge" | _ => {
            let existing_ips: std::collections::HashSet<String> =
                data.servers.iter().map(|s| s.ip.clone()).collect();
            for srv in pending.servers {
                if !existing_ips.contains(&srv.ip) {
                    data.servers.push(srv);
                }
            }
            let existing_ids: std::collections::HashSet<String> =
                data.groups.iter().map(|g| g.id.clone()).collect();
            for grp in pending.groups {
                if !existing_ids.contains(&grp.id) {
                    data.groups.push(grp);
                }
            }
        }
    }
    state.save_data(&data).map_err(|e| e.to_string())
}
```

- [ ] **Étape 4 : Exécuter les tests**

```bash
cd src-tauri && cargo test commands::settings::tests 2>&1
```

Attendu : 3 tests passent.

- [ ] **Étape 5 : Enregistrer les commandes dans lib.rs**

Ajouter `export_full_config`, `import_full_config`, `apply_import_config` dans `generate_handler![]`.

- [ ] **Étape 6 : Compiler**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

- [ ] **Étape 7 : Commit**

```bash
git add src-tauri/src/commands/settings.rs src-tauri/src/lib.rs
git commit -m "feat: add export_full_config, import_full_config, apply_import_config commands"
```

---

## Task 10 : Commandes Rust — Thèmes custom + Icône serveur

**Files:**
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/servers.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Étape 1 : Ajouter save_custom_theme et delete_custom_theme dans settings.rs**

```rust
#[tauri::command]
pub fn save_custom_theme(
    theme: crate::models::Theme,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    if theme.id.is_empty() || theme.name.is_empty() {
        return Err("L'id et le nom du thème sont requis".to_string());
    }
    // Valider que l'id ne contient que des caractères valides
    if !theme.id.chars().all(|c| c.is_alphanumeric() || c == '-') {
        return Err("L'id doit contenir uniquement des caractères alphanumériques et des tirets".to_string());
    }
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    // Remplacer si existe, sinon ajouter
    let pos = data.settings.appearance.custom_themes.iter().position(|t| t.id == theme.id);
    match pos {
        Some(i) => data.settings.appearance.custom_themes[i] = theme,
        None => data.settings.appearance.custom_themes.push(theme),
    }
    state.save_data(&data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_custom_theme(
    id: String,
    state: tauri::State<'_, crate::storage::AppState>,
) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.settings.appearance.custom_themes.retain(|t| t.id != id);
    state.save_data(&data).map_err(|e| e.to_string())
}
```

- [ ] **Étape 2 : Ajouter upload_server_icon dans servers.rs**

```rust
#[tauri::command]
pub async fn upload_server_icon(
    server_id: String,
    file_path: String,
    state: tauri::State<'_, crate::storage::AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let src = std::path::Path::new(&file_path);
    let ext = src.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    if ext != "png" && ext != "svg" {
        return Err("Seuls les fichiers PNG et SVG sont acceptés".to_string());
    }
    let icons_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("icons");
    std::fs::create_dir_all(&icons_dir).map_err(|e| e.to_string())?;
    let file_name = format!("{}.{}", server_id, ext);
    let dest = icons_dir.join(&file_name);
    std::fs::copy(src, &dest).map_err(|e| e.to_string())?;
    // Mettre à jour server.icon
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    if let Some(srv) = data.servers.iter_mut().find(|s| s.id == server_id) {
        srv.icon = Some(format!("file:{}", file_name));
    }
    state.save_data(&data).map_err(|e| e.to_string())?;
    Ok(file_name)
}
```

- [ ] **Étape 3 : Enregistrer dans lib.rs**

Ajouter `save_custom_theme`, `delete_custom_theme`, `upload_server_icon`.

- [ ] **Étape 4 : Compiler**

```bash
cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error"
```

- [ ] **Étape 5 : Commit**

```bash
git add src-tauri/src/commands/
git commit -m "feat: add theme CRUD and server icon upload commands"
```

---

## Task 11 : Types TypeScript + utilitaires thème

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/utils/theme.ts`

- [ ] **Étape 1 : Mettre à jour src/types/index.ts**

Ajouter après les types existants :

```typescript
// src/types/index.ts

export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  colors: Record<string, string>;
}

export type Density = 'Compact' | 'Normal' | 'Comfortable';

export interface GeneralSettings {
  start_minimized: boolean;
  auto_start: boolean;
  notifications: boolean;
}

export interface AppearanceSettings {
  brightness: number;
  font_size: number;
  density: Density;
  active_theme: string;
  custom_themes: Theme[];
}

export interface NetworkSettings {
  ping_interval_secs: number;
  ping_timeout_ms: number;
  ssh_timeout_secs: number;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  network: NetworkSettings;
}

export interface ImportSummary {
  servers_count: number;
  groups_count: number;
  settings_present: boolean;
  config_version: string;
  exported_at: string | null;
}
```

Supprimer l'ancien `AppSettings` plat s'il existe dans le fichier.

- [ ] **Étape 2 : Créer src/utils/theme.ts**

```typescript
// src/utils/theme.ts
import { Theme } from '../types';

// ─── Thèmes builtin ───────────────────────────────────────────────────────────

export const ONE_HALF_DARK: Theme = {
  id: 'one-half-dark',
  name: 'One Half Dark',
  builtin: true,
  colors: {
    '--bg-primary':     '#282c34',
    '--bg-secondary':   '#21252b',
    '--bg-tertiary':    '#2c313a',
    '--bg-input':       '#1e2227',
    '--bg-hover':       '#323842',
    '--bg-active':      '#3a3f4b',
    '--text-primary':   '#abb2bf',
    '--text-secondary': '#7f848e',
    '--text-muted':     '#5c6370',
    '--accent-primary':   '#61afef',
    '--accent-secondary': '#56b6c2',
    '--accent-success':   '#98c379',
    '--accent-warning':   '#e5c07b',
    '--accent-error':     '#e06c75',
    '--accent-info':      '#61afef',
    '--border-primary':   '#3e4451',
    '--border-secondary': '#2c313a',
    '--shadow-color':     'rgba(0, 0, 0, 0.3)',
    '--scrollbar-thumb':  '#3e4451',
    '--scrollbar-track':  '#21252b',
    '--font-size-base':   '14px',
  },
};

export const FLUENT_DARK: Theme = {
  id: 'fluent-dark',
  name: 'Fluent Dark',
  builtin: true,
  colors: {
    '--bg-primary':     '#0a0a0f',
    '--bg-secondary':   '#111117',
    '--bg-tertiary':    '#16161e',
    '--bg-input':       '#0d0d14',
    '--bg-hover':       '#1e1e2e',
    '--bg-active':      '#252535',
    '--text-primary':   '#e2e8f0',
    '--text-secondary': '#94a3b8',
    '--text-muted':     '#64748b',
    '--accent-primary':   '#0078d4',
    '--accent-secondary': '#106ebe',
    '--accent-success':   '#16a34a',
    '--accent-warning':   '#d97706',
    '--accent-error':     '#dc2626',
    '--accent-info':      '#0ea5e9',
    '--border-primary':   '#2a2a3a',
    '--border-secondary': '#1e1e2e',
    '--shadow-color':     'rgba(0, 0, 0, 0.5)',
    '--scrollbar-thumb':  '#2a2a3a',
    '--scrollbar-track':  '#111117',
    '--font-size-base':   '14px',
  },
};

export const BUILTIN_THEMES: Theme[] = [ONE_HALF_DARK, FLUENT_DARK];

// ─── Application du thème ─────────────────────────────────────────────────────

/** Applique un thème en injectant les CSS variables sur :root. Exclut --font-size-base. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    if (key === '--font-size-base') return; // géré séparément
    root.style.setProperty(key, value);
  });
}

/** Applique la taille de police sur :root et body. */
export function applyFontSize(size: number): void {
  document.documentElement.style.setProperty('--font-size-base', `${size}px`);
  document.body.style.fontSize = `${size}px`;
}

/** Applique la luminosité via filtre CSS sur l'élément app-root. */
export function applyBrightness(value: number): void {
  const root = document.getElementById('app-root');
  if (root) root.style.filter = value === 1.0 ? '' : `brightness(${value})`;
}

/** Applique la densité via une classe CSS sur <body>. */
export function applyDensity(density: string): void {
  document.body.classList.remove('density-compact', 'density-normal', 'density-comfortable');
  document.body.classList.add(`density-${density.toLowerCase()}`);
}

/** Retourne le thème par son id dans la liste complète (builtins + customs). */
export function findTheme(id: string, customThemes: Theme[]): Theme {
  const all = [...BUILTIN_THEMES, ...customThemes];
  return all.find(t => t.id === id) ?? ONE_HALF_DARK;
}

/** Génère un id slug unique depuis un nom. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
```

- [ ] **Étape 3 : Vérifier la compilation TypeScript**

```bash
npm run build 2>&1 | grep -i "error"
```

- [ ] **Étape 4 : Commit**

```bash
git add src/types/index.ts src/utils/theme.ts
git commit -m "feat: TypeScript types v2 and theme utilities"
```

---

## Task 12 : Store Zustand — mise à jour

**Files:**
- Modify: `src/stores/useStore.ts`
- Modify: `src/App.tsx`

- [ ] **Étape 1 : Mettre à jour useStore.ts**

Remplacer/étendre le store pour refléter la nouvelle structure. Le store doit :

```typescript
// src/stores/useStore.ts
import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { AppSettings, ImportSummary, Theme } from '../types';
import { applyTheme, applyFontSize, applyBrightness, applyDensity, findTheme, BUILTIN_THEMES } from '../utils/theme';
// ... imports existants

interface StoreState {
  // === existant ===
  servers: Server[];
  groups: Group[];
  statuses: Record<string, ServerStatus>;
  loading: boolean;
  initialized: boolean;
  // === nouveau ===
  settings: AppSettings;
  allThemes: Theme[];           // builtins + customs
  pendingImport: ImportSummary | null;

  // === actions existantes ===
  initialize: () => Promise<void>;
  // ... (CRUD servers, groups, wol, ssh, ping — inchangés)

  // === nouvelles actions ===
  updateAppearance: (partial: Partial<AppSettings['appearance']>) => Promise<void>;
  updateGeneral: (partial: Partial<AppSettings['general']>) => Promise<void>;
  updateNetwork: (partial: Partial<AppSettings['network']>) => Promise<void>;
  saveCustomTheme: (theme: Theme) => Promise<void>;
  deleteCustomTheme: (id: string) => Promise<void>;
  exportFullConfig: () => Promise<string>;
  importFullConfig: () => Promise<ImportSummary>;
  applyImportConfig: (mode: 'merge' | 'replace') => Promise<void>;
  resetSettings: () => Promise<void>;
}
```

Dans `initialize()`, après avoir chargé les settings, appliquer le thème, la taille de police, la luminosité et la densité :

```typescript
initialize: async () => {
  // ... chargement existant
  const settings: AppSettings = await invoke('get_settings');
  const customThemes = settings.appearance.custom_themes;
  const theme = findTheme(settings.appearance.active_theme, customThemes);
  applyTheme(theme);
  applyFontSize(settings.appearance.font_size);
  applyBrightness(settings.appearance.brightness);
  applyDensity(settings.appearance.density);
  set({ settings, allThemes: [...BUILTIN_THEMES, ...customThemes], initialized: true });
}
```

Implémenter `updateAppearance` :
```typescript
updateAppearance: async (partial) => {
  const state = get();
  const newAppearance = { ...state.settings.appearance, ...partial };
  const newSettings = { ...state.settings, appearance: newAppearance };
  await invoke('update_settings', { settings: newSettings });
  // Appliquer immédiatement les effets visuels
  if (partial.active_theme) {
    const theme = findTheme(partial.active_theme, newAppearance.custom_themes);
    applyTheme(theme);
  }
  if (partial.font_size !== undefined) applyFontSize(partial.font_size);
  if (partial.brightness !== undefined) applyBrightness(partial.brightness);
  if (partial.density) applyDensity(partial.density);
  set({ settings: newSettings });
},
```

Implémenter `saveCustomTheme` :
```typescript
saveCustomTheme: async (theme) => {
  await invoke('save_custom_theme', { theme });
  const state = get();
  const customs = [...state.settings.appearance.custom_themes];
  const idx = customs.findIndex(t => t.id === theme.id);
  idx >= 0 ? (customs[idx] = theme) : customs.push(theme);
  set({
    allThemes: [...BUILTIN_THEMES, ...customs],
    settings: { ...state.settings, appearance: { ...state.settings.appearance, custom_themes: customs } }
  });
},
```

- [ ] **Étape 2 : Mettre à jour App.tsx**

Ajouter `id="app-root"` sur le `<div>` racine du layout (pour `applyBrightness`).

Vérifier que `initialize()` est toujours appelé au montage.

- [ ] **Étape 3 : Compiler**

```bash
npm run build 2>&1 | grep -i "error"
```

- [ ] **Étape 4 : Commit**

```bash
git add src/stores/useStore.ts src/App.tsx
git commit -m "feat: Zustand store v2 with appearance/general/theme actions"
```

---

## Task 13 : Settings page — structure sidebar + Section Réseau + À propos

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Étape 1 : Réécrire Settings.tsx avec sidebar**

```typescript
// src/pages/Settings.tsx
import { useState } from 'react';
// imports Lucide et store

type Section = 'general' | 'appearance' | 'network' | 'config' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general',    label: 'Général' },
  { id: 'appearance', label: 'Apparence' },
  { id: 'network',    label: 'Réseau' },
  { id: 'config',     label: 'Configuration' },
  { id: 'about',      label: 'À propos' },
];

export function Settings() {
  const [active, setActive] = useState<Section>('general');

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <nav className="w-44 shrink-0 bg-bg-secondary border-r border-border-primary flex flex-col py-4">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={`text-left px-4 py-2 text-sm transition-colors duration-150
              border-l-[3px] ${active === s.id
                ? 'border-accent-primary bg-bg-active text-text-primary'
                : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Contenu scrollable */}
      <div className="flex-1 overflow-y-auto p-6">
        {active === 'general'    && <SectionGeneral />}
        {active === 'appearance' && <SectionAppearance />}
        {active === 'network'    && <SectionNetwork />}
        {active === 'config'     && <SectionConfig />}
        {active === 'about'      && <SectionAbout />}
      </div>
    </div>
  );
}
```

- [ ] **Étape 2 : Implémenter SectionReseau (migrer depuis l'ancienne Settings)**

```typescript
function SectionNetwork() {
  const { settings, updateNetwork } = useStore();
  const [net, setNet] = useState(settings.network);
  const { success, error } = useToast();

  const handleSave = async () => {
    try {
      await updateNetwork(net);
      success('Paramètres réseau sauvegardés');
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Réseau</h2>

      <div className="space-y-4">
        <div className="form-row">
          <label className="text-text-secondary text-xs block mb-1">
            Intervalle de ping (secondes)
          </label>
          <input
            type="number" min={5} max={3600}
            value={net.ping_interval_secs}
            onChange={e => setNet(n => ({ ...n, ping_interval_secs: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border-primary rounded px-3 py-2
                       text-text-primary text-sm focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="form-row">
          <label className="text-text-secondary text-xs block mb-1">
            Timeout ping (ms)
          </label>
          <input
            type="number" min={500} max={30000}
            value={net.ping_timeout_ms}
            onChange={e => setNet(n => ({ ...n, ping_timeout_ms: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border-primary rounded px-3 py-2
                       text-text-primary text-sm focus:outline-none focus:border-accent-primary"
          />
        </div>

        <div className="form-row">
          <label className="text-text-secondary text-xs block mb-1">
            Timeout SSH (secondes)
          </label>
          <input
            type="number" min={5} max={120}
            value={net.ssh_timeout_secs}
            onChange={e => setNet(n => ({ ...n, ssh_timeout_secs: Number(e.target.value) }))}
            className="w-full bg-bg-input border border-border-primary rounded px-3 py-2
                       text-text-primary text-sm focus:outline-none focus:border-accent-primary"
          />
        </div>
      </div>

      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary text-white
                   rounded hover:bg-accent-secondary transition-colors duration-150"
      >
        Sauvegarder
      </button>
    </div>
  );
}
```

- [ ] **Étape 3 : Implémenter SectionAbout**

```typescript
function SectionAbout() {
  return (
    <div className="space-y-4 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">À propos</h2>
      <div className="bg-bg-tertiary rounded-lg p-4 space-y-2 text-sm text-text-secondary">
        <p><span className="text-text-primary">Version</span> 0.1.0</p>
        <p><span className="text-text-primary">Framework</span> Tauri v2 + React 18 + Rust</p>
        <p><span className="text-text-primary">Chiffrement</span> AES-256-GCM</p>
        <p><span className="text-text-primary">Stockage</span> JSON local (AppData)</p>
      </div>
    </div>
  );
}
```

- [ ] **Étape 4 : Test visuel**

```bash
npm run tauri dev
```

Naviguer vers Paramètres. Vérifier la sidebar, la navigation entre sections, la section Réseau fonctionnelle, la section À propos.

- [ ] **Étape 5 : Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: Settings page with sidebar navigation (Réseau + À propos)"
```

---

## Task 14 : Section Général

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Étape 1 : Implémenter SectionGeneral**

```typescript
function SectionGeneral() {
  const { settings, updateGeneral } = useStore();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const { success, error } = useToast();

  // Lire l'état réel depuis le registre au montage
  useEffect(() => {
    invoke<boolean>('get_autostart').then(setAutostart).catch(() => setAutostart(false));
  }, []);

  const handleToggle = async (field: keyof GeneralSettings, value: boolean) => {
    try {
      if (field === 'auto_start') {
        await invoke('set_autostart', { enabled: value });
        setAutostart(value);
      } else {
        await updateGeneral({ [field]: value });
      }
      success('Sauvegardé');
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Général</h2>

      <ToggleRow
        label="Démarrer minimisé"
        description="Réduit la fenêtre au démarrage de l'application"
        checked={settings.general.start_minimized}
        onChange={v => handleToggle('start_minimized', v)}
      />
      <ToggleRow
        label="Démarrage automatique"
        description="Lance l'application au démarrage de Windows"
        checked={autostart ?? settings.general.auto_start}
        onChange={v => handleToggle('auto_start', v)}
      />
      <ToggleRow
        label="Notifications système"
        description="Affiche des notifications OS pour les événements importants"
        checked={settings.general.notifications}
        onChange={v => handleToggle('notifications', v)}
      />
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-secondary">
      <div>
        <p className="text-text-primary text-sm">{label}</p>
        <p className="text-text-muted text-xs mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors duration-150
          ${checked ? 'bg-accent-primary' : 'bg-bg-active'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-150
          ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
```

- [ ] **Étape 2 : Test visuel**

```bash
npm run tauri dev
```

Vérifier les toggles dans la section Général. Tester le toggle autostart : doit écrire dans le registre Windows.

- [ ] **Étape 3 : Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: Settings > Section Général with toggles and autostart registry"
```

---

## Task 15 : Section Apparence — sliders + densité

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Étape 1 : Implémenter SectionAppearance (sliders + densité, sans thèmes)**

```typescript
function SectionAppearance() {
  const { settings, updateAppearance } = useStore();
  const app = settings.appearance;
  const { success, error } = useToast();

  const handleChange = async (partial: Partial<AppearanceSettings>) => {
    try {
      await updateAppearance(partial);
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Apparence</h2>

      {/* Luminosité */}
      <SliderRow
        label="Luminosité"
        value={app.brightness}
        min={0.6} max={1.2} step={0.05}
        display={v => `${Math.round(v * 100)}%`}
        onChange={v => handleChange({ brightness: v })}
      />

      {/* Taille de police */}
      <SliderRow
        label="Taille de police"
        value={app.font_size}
        min={12} max={18} step={1}
        display={v => `${v}px`}
        onChange={v => handleChange({ font_size: v })}
      />

      {/* Densité */}
      <div className="space-y-2">
        <p className="text-text-primary text-sm">Densité</p>
        <div className="flex gap-2">
          {(['Compact', 'Normal', 'Comfortable'] as const).map(d => (
            <button
              key={d}
              onClick={() => handleChange({ density: d })}
              className={`px-3 py-1.5 text-xs rounded transition-colors duration-150
                ${app.density === d
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-active text-text-secondary hover:bg-bg-hover'}`}
            >
              {d === 'Compact' ? 'Compact' : d === 'Normal' ? 'Normal' : 'Aéré'}
            </button>
          ))}
        </div>
      </div>

      {/* Sélecteur de thème — sera ajouté en Task 16 */}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <p className="text-text-primary text-sm">{label}</p>
        <span className="text-text-muted text-xs">{display(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded appearance-none bg-bg-active
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary
          [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}
```

- [ ] **Étape 2 : Test visuel**

```bash
npm run tauri dev
```

Vérifier les sliders (luminosité et taille police doivent avoir un effet immédiat). Vérifier les boutons densité.

- [ ] **Étape 3 : Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat: Settings > Apparence sliders (brightness, font-size, density)"
```

---

## Task 16 : Section Apparence — sélecteur + éditeur de thèmes

**Files:**
- Create: `src/components/ThemeCard.tsx`
- Create: `src/components/ThemeEditor.tsx`
- Modify: `src/pages/Settings.tsx`

- [ ] **Étape 1 : Créer ThemeCard.tsx**

```typescript
// src/components/ThemeCard.tsx
import { Theme } from '../types';
import { Copy, Trash2 } from 'lucide-react';

interface Props {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete?: () => void; // undefined si builtin
}

export function ThemeCard({ theme, active, onSelect, onDuplicate, onDelete }: Props) {
  const c = theme.colors;
  return (
    <div
      onClick={onSelect}
      className={`relative p-3 rounded-lg cursor-pointer transition-all duration-150
        bg-bg-tertiary border-2
        ${active ? 'border-accent-primary' : 'border-border-primary hover:border-border-secondary'}`}
    >
      {/* Prévisualisation couleurs */}
      <div className="flex gap-1.5 mb-2">
        {[c['--bg-primary'], c['--bg-tertiary'], c['--accent-primary'], c['--accent-success']]
          .map((color, i) => (
            <span key={i} className="w-5 h-5 rounded" style={{ backgroundColor: color }} />
          ))
        }
      </div>
      <p className="text-text-primary text-xs font-medium">{theme.name}</p>
      {/* Actions */}
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={e => { e.stopPropagation(); onDuplicate(); }}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          title="Dupliquer"
        >
          <Copy size={12} />
        </button>
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-error"
            title="Supprimer"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Étape 2 : Créer ThemeEditor.tsx**

```typescript
// src/components/ThemeEditor.tsx
import { useState } from 'react';
import { Theme } from '../types';
import { applyTheme, slugify } from '../utils/theme';

const CSS_VAR_LABELS: Record<string, string> = {
  '--bg-primary':     'Fond principal',
  '--bg-secondary':   'Fond sidebar/modals',
  '--bg-tertiary':    'Fond cards',
  '--bg-input':       'Fond champs',
  '--bg-hover':       'Fond survol',
  '--bg-active':      'Fond actif',
  '--text-primary':   'Texte principal',
  '--text-secondary': 'Texte secondaire',
  '--text-muted':     'Texte discret',
  '--accent-primary':   'Accent principal',
  '--accent-secondary': 'Accent secondaire',
  '--accent-success':   'Succès / Online',
  '--accent-warning':   'Avertissement',
  '--accent-error':     'Erreur / Offline',
  '--accent-info':      'Information',
  '--border-primary':   'Bordure principale',
  '--border-secondary': 'Bordure subtile',
  '--shadow-color':     'Couleur ombre',
  '--scrollbar-thumb':  'Poignée scrollbar',
  '--scrollbar-track':  'Rail scrollbar',
};

interface Props {
  initial: Theme;
  onSave: (theme: Theme) => void;
  onCancel: () => void;
}

export function ThemeEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial.name);
  const [colors, setColors] = useState<Record<string, string>>({ ...initial.colors });

  const handleColorChange = (key: string, value: string) => {
    const updated = { ...colors, [key]: value };
    setColors(updated);
    // Aperçu live (exclure --font-size-base)
    if (key !== '--font-size-base') {
      document.documentElement.style.setProperty(key, value);
    }
  };

  const handleSave = () => {
    const id = initial.builtin ? slugify(name) + '-custom' : initial.id;
    onSave({ id, name, builtin: false, colors });
  };

  return (
    <div className="mt-4 bg-bg-secondary rounded-lg p-4 space-y-4">
      <div>
        <label className="text-text-secondary text-xs block mb-1">Nom du thème</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-bg-input border border-border-primary rounded px-3 py-1.5
                     text-text-primary text-sm focus:outline-none focus:border-accent-primary"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 max-h-64 overflow-y-auto">
        {Object.entries(CSS_VAR_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-2">
            <input
              type="color"
              value={colors[key]?.startsWith('#') ? colors[key] : '#888888'}
              onChange={e => handleColorChange(key, e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-border-primary bg-transparent"
            />
            <span className="text-text-secondary text-xs truncate">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary
                     bg-bg-active rounded transition-colors duration-150">
          Annuler
        </button>
        <button onClick={handleSave}
          className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded
                     hover:bg-accent-secondary transition-colors duration-150">
          Sauvegarder
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Étape 3 : Intégrer sélecteur + éditeur dans SectionAppearance**

Dans `SectionAppearance`, ajouter après les sliders :

```typescript
const [editingTheme, setEditingTheme] = useState<Theme | null>(null);
const { allThemes, updateAppearance, saveCustomTheme, deleteCustomTheme } = useStore();

const handleDuplicate = (theme: Theme) => {
  const copy = { ...theme, id: theme.id + '-copy', name: theme.name + ' (copie)', builtin: false };
  setEditingTheme(copy);
};

// Sélecteur
<div className="space-y-2">
  <p className="text-text-primary text-sm">Thème</p>
  <div className="grid grid-cols-3 gap-2">
    {allThemes.map(theme => (
      <ThemeCard
        key={theme.id}
        theme={theme}
        active={app.active_theme === theme.id}
        onSelect={() => updateAppearance({ active_theme: theme.id })}
        onDuplicate={() => handleDuplicate(theme)}
        onDelete={theme.builtin ? undefined : () => deleteCustomTheme(theme.id)}
      />
    ))}
  </div>
</div>

{editingTheme && (
  <ThemeEditor
    initial={editingTheme}
    onSave={async t => { await saveCustomTheme(t); setEditingTheme(null); }}
    onCancel={() => {
      // Restaurer le thème actif si l'aperçu live a changé les variables
      const current = findTheme(app.active_theme, settings.appearance.custom_themes);
      applyTheme(current);
      setEditingTheme(null);
    }}
  />
)}
```

- [ ] **Étape 4 : Test visuel**

```bash
npm run tauri dev
```

Vérifier : sélection de thème instantanée, cartes de prévisualisation, duplication, éditeur avec color pickers live, sauvegarde.

- [ ] **Étape 5 : Commit**

```bash
git add src/components/ThemeCard.tsx src/components/ThemeEditor.tsx src/pages/Settings.tsx
git commit -m "feat: theme selector and editor with live preview"
```

---

## Task 17 : Section Configuration — Export/Import amélioré

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/stores/useStore.ts`

- [ ] **Étape 1 : Implémenter SectionConfig**

```typescript
function SectionConfig() {
  const { exportFullConfig, importFullConfig, applyImportConfig, resetSettings, settings } = useStore();
  const { success, error, info } = useToast();
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [dataPath, setDataPath] = useState('');
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmReplace, setShowConfirmReplace] = useState(false);

  useEffect(() => {
    invoke<string>('get_data_path').then(setDataPath).catch(() => {});
  }, []);

  const handleExport = async () => {
    try {
      const path = await exportFullConfig();
      success(`Exporté : ${path}`);
    } catch (e) { error(String(e)); }
  };

  const handleImport = async () => {
    try {
      const summary = await importFullConfig();
      setImportSummary(summary);
    } catch (e) {
      if (!String(e).includes('annulé')) error(String(e));
    }
  };

  const handleApplyImport = async (mode: 'merge' | 'replace') => {
    try {
      await applyImportConfig(mode);
      setImportSummary(null);
      success('Configuration importée');
    } catch (e) { error(String(e)); }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Configuration</h2>

      {/* Export / Import */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active
                       text-text-primary rounded hover:bg-bg-hover transition-colors duration-150">
            <Download size={14} /> Exporter la configuration
          </button>
          <button onClick={handleImport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active
                       text-text-primary rounded hover:bg-bg-hover transition-colors duration-150">
            <Upload size={14} /> Importer une configuration
          </button>
        </div>

        {/* Récapitulatif d'import */}
        {importSummary && (
          <div className="bg-bg-tertiary rounded-lg p-4 space-y-3 text-sm">
            <p className="text-text-primary font-medium">Récapitulatif de l'import</p>
            <div className="text-text-secondary space-y-1">
              <p>Version : <span className="text-text-primary">{importSummary.config_version}</span></p>
              <p>Serveurs : <span className="text-text-primary">{importSummary.servers_count}</span></p>
              <p>Groupes : <span className="text-text-primary">{importSummary.groups_count}</span></p>
              <p>Paramètres : <span className="text-text-primary">{importSummary.settings_present ? 'inclus' : 'non inclus'}</span></p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleApplyImport('merge')}
                className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded hover:bg-accent-secondary">
                Fusion
              </button>
              <button onClick={() => setShowConfirmReplace(true)}
                className="px-3 py-1.5 text-xs bg-bg-active text-accent-error rounded hover:bg-bg-hover">
                Remplacement
              </button>
              <button onClick={() => setImportSummary(null)}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary">
                Annuler
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Chemin données */}
      <div className="space-y-1">
        <p className="text-text-secondary text-xs">Fichier de données</p>
        <div className="flex gap-2 items-center">
          <code className="text-text-muted text-xs bg-bg-input px-2 py-1 rounded flex-1 truncate">
            {dataPath || 'Chargement...'}
          </code>
          <button onClick={() => navigator.clipboard.writeText(dataPath)}
            className="p-1.5 rounded bg-bg-active hover:bg-bg-hover text-text-muted hover:text-text-primary">
            <Copy size={12} />
          </button>
        </div>
      </div>

      {/* Réinitialisation */}
      <button onClick={() => setShowConfirmReset(true)}
        className="px-3 py-2 text-sm text-accent-error bg-bg-active rounded hover:bg-bg-hover
                   transition-colors duration-150">
        Réinitialiser les paramètres
      </button>

      {showConfirmReset && (
        <ConfirmDialog
          title="Réinitialiser les paramètres"
          message="Les paramètres d'apparence, de réseau et généraux seront remis aux valeurs par défaut. Les serveurs et groupes ne sont pas affectés."
          onConfirm={async () => { await resetSettings(); setShowConfirmReset(false); success('Paramètres réinitialisés'); }}
          onCancel={() => setShowConfirmReset(false)}
        />
      )}
      {showConfirmReplace && (
        <ConfirmDialog
          title="Remplacer la configuration"
          message="Toute la configuration actuelle (serveurs, groupes, paramètres) sera remplacée. Cette action est irréversible."
          onConfirm={async () => { await handleApplyImport('replace'); setShowConfirmReplace(false); }}
          onCancel={() => setShowConfirmReplace(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Étape 2 : Ajouter resetSettings dans le store**

```typescript
resetSettings: async () => {
  const defaults: AppSettings = {
    general: { start_minimized: false, auto_start: false, notifications: true },
    appearance: { brightness: 1.0, font_size: 14, density: 'Normal', active_theme: 'one-half-dark', custom_themes: [] },
    network: { ping_interval_secs: 30, ping_timeout_ms: 2000, ssh_timeout_secs: 30 },
  };
  await invoke('update_settings', { settings: defaults });
  applyTheme(ONE_HALF_DARK);
  applyFontSize(14);
  applyBrightness(1.0);
  applyDensity('Normal');
  set({ settings: defaults });
},
```

- [ ] **Étape 3 : Test visuel**

```bash
npm run tauri dev
```

Tester l'export (dialog natif, fichier créé), l'import avec récapitulatif, les modes fusion/remplacement, la réinitialisation.

- [ ] **Étape 4 : Commit**

```bash
git add src/pages/Settings.tsx src/stores/useStore.ts
git commit -m "feat: Settings > Configuration with export/import dialog and reset"
```

---

## Task 18 : Icônes custom dans ServerForm

**Files:**
- Create: `src/components/IconPicker.tsx`
- Modify: `src/components/ServerForm.tsx`

- [ ] **Étape 1 : Créer IconPicker.tsx**

```typescript
// src/components/IconPicker.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Server, Database, HardDrive, Monitor, Cpu, Globe, Network,
  Shield, Box, Container, Cloud, Layers, Terminal, Wifi, Zap,
  Archive, Boxes, Landmark, Share2, Settings
} from 'lucide-react';

const LUCIDE_ICONS: { name: string; Component: React.FC<{ size?: number }> }[] = [
  { name: 'lucide:Server',    Component: Server },
  { name: 'lucide:Database',  Component: Database },
  { name: 'lucide:HardDrive', Component: HardDrive },
  { name: 'lucide:Monitor',   Component: Monitor },
  { name: 'lucide:Cpu',       Component: Cpu },
  { name: 'lucide:Globe',     Component: Globe },
  { name: 'lucide:Network',   Component: Network },
  { name: 'lucide:Shield',    Component: Shield },
  { name: 'lucide:Box',       Component: Box },
  { name: 'lucide:Container', Component: Container },
  { name: 'lucide:Cloud',     Component: Cloud },
  { name: 'lucide:Layers',    Component: Layers },
  { name: 'lucide:Terminal',  Component: Terminal },
  { name: 'lucide:Wifi',      Component: Wifi },
  { name: 'lucide:Zap',       Component: Zap },
  { name: 'lucide:Archive',   Component: Archive },
  { name: 'lucide:Boxes',     Component: Boxes },
  { name: 'lucide:Landmark',  Component: Landmark },
  { name: 'lucide:Share2',    Component: Share2 },
  { name: 'lucide:Settings',  Component: Settings },
];

interface Props {
  serverId: string;
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ serverId, value, onChange }: Props) {
  const [showOpen, setShowOpen] = useState(false);

  const handleFileUpload = async () => {
    const selected = await open({ filters: [{ name: 'Image', extensions: ['png', 'svg'] }] });
    if (!selected || Array.isArray(selected)) return;
    const fileName = await invoke<string>('upload_server_icon', {
      serverId, filePath: selected
    });
    onChange(`file:${fileName}`);
    setShowOpen(false);
  };

  if (!showOpen) {
    return (
      <button
        type="button"
        onClick={() => setShowOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-bg-active
                   text-text-secondary rounded hover:bg-bg-hover transition-colors duration-150"
      >
        {value ? <CurrentIcon icon={value} size={14} /> : <Server size={14} />}
        {value ? 'Changer l\'icône' : 'Choisir une icône'}
      </button>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-lg p-3 space-y-3">
      <p className="text-text-secondary text-xs">Icône Lucide</p>
      <div className="grid grid-cols-10 gap-1.5">
        {LUCIDE_ICONS.map(({ name, Component }) => (
          <button
            key={name}
            type="button"
            onClick={() => { onChange(name); setShowOpen(false); }}
            className={`p-1.5 rounded transition-colors duration-150
              ${value === name ? 'bg-accent-primary text-white' : 'bg-bg-active text-text-secondary hover:bg-bg-hover'}`}
            title={name.replace('lucide:', '')}
          >
            <Component size={14} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleFileUpload}
          className="px-3 py-1.5 text-xs bg-bg-active text-text-secondary rounded hover:bg-bg-hover"
        >
          Image personnalisée (PNG/SVG)
        </button>
        <button type="button" onClick={() => setShowOpen(false)}
          className="text-xs text-text-muted hover:text-text-primary">
          Annuler
        </button>
      </div>
    </div>
  );
}

/** Affiche l'icône courante (Lucide ou image fichier). */
export function CurrentIcon({ icon, size = 16 }: { icon: string; size?: number }) {
  if (icon.startsWith('lucide:')) {
    const name = icon.replace('lucide:', '');
    const found = LUCIDE_ICONS.find(i => i.name === `lucide:${name}`);
    if (found) return <found.Component size={size} />;
  }
  if (icon.startsWith('file:')) {
    // L'URL sera résolue via convertFileSrc au moment de l'affichage
    return <img src={`asset://localhost/icons/${icon.replace('file:', '')}`} width={size} height={size} className="rounded" />;
  }
  return <Server size={size} />;
}
```

- [ ] **Étape 2 : Intégrer IconPicker dans ServerForm.tsx**

Remplacer le champ texte `icon` par `<IconPicker>` dans le formulaire. Le champ `icon` dans le state du formulaire reste une `string | null`.

```typescript
// Dans ServerForm, remplacer le champ icon:
<div className="form-row">
  <label className="text-text-secondary text-xs block mb-1">Icône</label>
  <IconPicker
    serverId={formData.id || 'new'}
    value={formData.icon || null}
    onChange={icon => setFormData(d => ({ ...d, icon }))}
  />
</div>
```

- [ ] **Étape 3 : Mettre à jour l'affichage des icônes dans ServerCard.tsx**

Dans `ServerCard`, remplacer l'affichage de l'emoji/texte par `<CurrentIcon icon={server.icon} />`.

- [ ] **Étape 4 : Test visuel**

```bash
npm run tauri dev
```

Ouvrir le formulaire d'édition d'un serveur. Vérifier le picker Lucide. Tester l'upload d'un PNG.

- [ ] **Étape 5 : Commit**

```bash
git add src/components/IconPicker.tsx src/components/ServerForm.tsx src/components/ServerCard.tsx
git commit -m "feat: custom server icon picker (Lucide + file upload)"
```

---

## Task 19 : Build final + vérification

**Files:** Aucun fichier modifié — vérification uniquement.

- [ ] **Étape 1 : Build Tauri complet**

```bash
npm run tauri build 2>&1 | tail -30
```

Attendu : build réussi, `.exe` généré dans `src-tauri/target/release/`.

- [ ] **Étape 2 : Lancer le binaire et tester chaque feature**

```
src-tauri/target/release/server-manager.exe
```

Checklist :
- [ ] Thème One Half Dark appliqué au démarrage
- [ ] Changement de thème instantané (Fluent Dark ↔ One Half Dark)
- [ ] Slider luminosité fonctionnel
- [ ] Slider taille police fonctionnel
- [ ] Densité fonctionnelle (vérifier les paddings)
- [ ] Éditeur thème custom : créer, sauvegarder, supprimer
- [ ] Section Général : toggles fonctionnels, autostart écrit dans le registre
- [ ] Export config : dialog natif, fichier JSON créé avec config_version
- [ ] Import config : dialog natif, récapitulatif affiché, fusion et remplacement
- [ ] Réinitialisation paramètres
- [ ] Icône Lucide sur un serveur sauvegardée et affichée
- [ ] Upload icône PNG sur un serveur
- [ ] Redémarrage de l'app : thème et taille police restaurés depuis data.json

- [ ] **Étape 3 : Commit final**

```bash
git add .
git commit -m "feat: Server Power Manager v2 complete — themes, settings, export/import, custom icons"
```

---

## Référence rapide — commandes fréquentes

```bash
# Dev frontend uniquement
npm run dev

# Dev Tauri complet (recommandé pour tester l'IPC)
npm run tauri dev

# Compiler Rust uniquement (vérification rapide)
cargo build --manifest-path src-tauri/Cargo.toml

# Tests Rust
cd src-tauri && cargo test

# Build release
npm run tauri build
```
