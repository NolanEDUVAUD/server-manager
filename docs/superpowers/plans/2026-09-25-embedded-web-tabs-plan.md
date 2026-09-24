# Onglets web intégrés Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre d'ouvrir l'interface web d'une connexion Proxmox (et de futures connexions) dans un onglet natif à l'intérieur de la fenêtre de `server-manager`, via une vraie webview WebView2, plutôt que dans le navigateur système.

**Architecture:** Un état Tauri managé séparé (`DashboardState`, non persisté) garde les handles `Webview` créés via `Window::add_child` (feature `unstable`). Quatre commandes Tauri fines (create/close/show-hide/resize) pilotées par un store Zustand côté frontend, dont la géométrie est synchronisée avec une zone de contenu mesurée en DOM via `ResizeObserver`.

**Tech Stack:** Rust (Tauri v2.10.2, feature `unstable` pour le multiwebview), React 18 + TypeScript (Zustand, Tailwind CSS, Vitest + React Testing Library déjà en place).

**Spec:** `docs/superpowers/specs/2026-09-25-embedded-web-tabs-design.md`

## Global Constraints

- `Window::add_child` n'est disponible qu'avec la feature cargo `unstable` sur `tauri` — absente actuellement (`Cargo.toml` n'a que `["protocol-asset"]`).
- Les handles `Webview<tauri::Wry>` ne sont **jamais** sérialisés ni ajoutés à `AppData`/`data.json` — ils vivent dans un état Tauri managé séparé (`DashboardState`), non persisté.
- `close_dashboard_tab` doit être **idempotente** : ne jamais paniquer si le label n'existe plus (ex: webview déjà fermée côté OS).
- Aucun nouveau champ sur `ProxmoxConnection` — `api_url` sert aussi d'URL de la GUI web.
- Aucune persistance des onglets ouverts entre sessions (état 100% transitoire, frontend + `DashboardState`).
- Aucun bypass automatique de certificat auto-signé, aucun SSO/connexion automatique — hors périmètre explicite de cette v1.
- Les commandes Tauri qui dépendent de `State<...>`/`Window` ne sont **pas** unit-testées dans ce projet (convention déjà établie pour `commands/servers.rs`, `commands/ping.rs`, `commands/proxmox.rs`) — la vérification pour ces tâches est `cargo check` + `cargo test` (suite existante non régressée), pas de nouveaux tests Rust pour ces commandes.
- Signatures Rust exactes à utiliser telles quelles (vérifiées sur docs.rs pour `tauri` 2.10.2, version pinnée dans `Cargo.lock`) :
  ```rust
  pub fn add_child<P: Into<Position>, S: Into<Size>>(&self, webview_builder: WebviewBuilder<R>, position: P, size: S) -> Result<Webview<R>> // sur tauri::Window
  pub fn new<L: Into<String>>(label: L, url: WebviewUrl) -> Self // WebviewBuilder::new
  // Webview: show(&self), hide(&self), set_position<Pos: Into<Position>>(&self, position: Pos), set_size<S: Into<Size>>(&self, size: S), navigate(&self, url: Url), close(&self), label(&self) -> &str
  ```
  `tauri::LogicalPosition::new(x, y)` et `tauri::LogicalSize::new(w, h)` implémentent `Into<Position>`/`Into<Size>`.

## Review Focus

- Fermer l'onglet actif doit activer automatiquement un autre onglet restant, ou repasser à `null` s'il n'en reste aucun — sinon l'UI reste sur un label qui n'existe plus dans la liste — testé Tâche 4.
- Ouvrir un nouvel onglet pendant qu'un autre est déjà actif doit cacher l'ancien (`set_dashboard_tab_visible(false)`) avant/pendant l'ouverture du nouveau — sinon deux webviews se chevauchent visuellement — testé Tâche 4.
- Cliquer sur l'onglet déjà actif ne doit déclencher aucun appel `invoke` (no-op) — sinon un cycle hide/show inutile clignote — testé Tâche 4.
- Si aucun onglet n'est actif, un redimensionnement du conteneur ne doit **pas** appeler `resizeDashboardTab` (label `null`) — sinon la commande Rust échoue avec "Onglet introuvable" à chaque resize sans onglet ouvert — testé Tâche 5.
- Le conteneur de la webview active qui change de taille (redimensionnement de fenêtre) doit déclencher `resizeDashboardTab` avec les nouvelles coordonnées exactes — sinon la webview native se désynchronise visuellement du reste de l'UI — testé Tâche 5.

---

### Task 1: Feature `unstable` + `DashboardState`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/dashboard_state.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: rien (fondation)
- Produces: `dashboard_state::DashboardState { webviews: Mutex<HashMap<String, tauri::Webview<tauri::Wry>>> }`, `DashboardState::default()`, géré via `app.manage(...)` dans `lib.rs`.

- [ ] **Step 1: Write the failing test**

Créer `src-tauri/src/dashboard_state.rs` :

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Webview, Wry};

#[derive(Default)]
pub struct DashboardState {
    pub webviews: Mutex<HashMap<String, Webview<Wry>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_state_has_no_webviews() {
        let state = DashboardState::default();
        assert!(state.webviews.lock().unwrap().is_empty());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml default_state_has_no_webviews`
Expected: FAIL — module `dashboard_state` n'existe pas encore (erreur de compilation)

- [ ] **Step 3: Implement**

Dans `src-tauri/Cargo.toml`, modifier la ligne `tauri` :

```toml
tauri = { version = "2", features = ["protocol-asset", "unstable"] }
```

Dans `src-tauri/src/lib.rs`, ajouter `mod dashboard_state;` à côté des autres `mod` (en haut du fichier), et dans le `.setup(|app| { ... })` existant, après `app.manage(state);` :

```rust
            app.manage(dashboard_state::DashboardState::default());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml default_state_has_no_webviews`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/dashboard_state.rs src-tauri/src/lib.rs
git commit -m "feat: add DashboardState and enable Tauri unstable feature for multiwebview"
```

---

### Task 2: Commandes Tauri — `open_dashboard_tab` + `close_dashboard_tab`

**Files:**
- Create: `src-tauri/src/commands/dashboards.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `dashboard_state::DashboardState` (Task 1)
- Produces: commandes Tauri `open_dashboard_tab`, `close_dashboard_tab`

- [ ] **Step 1: Implement (pas de test automatisé — voir Global Constraints)**

Créer `src-tauri/src/commands/dashboards.rs` :

```rust
/// Commandes Tauri — Onglets web intégrés (multiwebview)
use tauri::{LogicalPosition, LogicalSize, State, WebviewUrl, Window};

use crate::dashboard_state::DashboardState;

#[tauri::command]
pub fn open_dashboard_tab(
    window: Window,
    state: State<DashboardState>,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    if let Some(webview) = webviews.get(&label) {
        webview
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("Erreur de positionnement: {}", e))?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("Erreur de redimensionnement: {}", e))?;
        webview
            .show()
            .map_err(|e| format!("Erreur d'affichage: {}", e))?;
        return Ok(());
    }

    let parsed_url = url
        .parse()
        .map_err(|e| format!("URL invalide '{}': {}", url, e))?;
    let builder = tauri::webview::WebviewBuilder::new(label.clone(), WebviewUrl::External(parsed_url));
    let webview = window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| format!("Impossible de créer l'onglet: {}", e))?;

    log::info!("Onglet web ouvert : {} ({})", label, url);
    webviews.insert(label, webview);
    Ok(())
}

#[tauri::command]
pub fn close_dashboard_tab(state: State<DashboardState>, label: String) -> Result<(), String> {
    let mut webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;

    if let Some(webview) = webviews.remove(&label) {
        webview
            .close()
            .map_err(|e| format!("Erreur de fermeture: {}", e))?;
        log::info!("Onglet web fermé : {}", label);
    }
    // Idempotent : si le label n'existe pas (déjà fermé côté OS), on ne fait rien
    // et on retourne Ok, sans jamais paniquer.
    Ok(())
}
```

Dans `src-tauri/src/commands/mod.rs`, ajouter `pub mod dashboards;` (par ordre alphabétique parmi les autres `pub mod`).

Dans `src-tauri/src/lib.rs`, mettre à jour l'import des commandes :

```rust
use commands::{dashboards, groups, ping, proxmox as proxmox_cmd, servers, settings, ssh, wol};
```

Et ajouter dans `invoke_handler![...]`, une nouvelle section :

```rust
            // ── Onglets web intégrés ────────────────────────────
            dashboards::open_dashboard_tab,
            dashboards::close_dashboard_tab,
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès (aucune erreur ; la feature `unstable` doit être active pour que `add_child` soit visible)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/dashboards.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add open_dashboard_tab and close_dashboard_tab commands"
```

---

### Task 3: Commandes Tauri — `set_dashboard_tab_visible` + `resize_dashboard_tab`

**Files:**
- Modify: `src-tauri/src/commands/dashboards.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `dashboard_state::DashboardState` (Task 1)
- Produces: commandes Tauri `set_dashboard_tab_visible`, `resize_dashboard_tab`

- [ ] **Step 1: Implement (pas de test automatisé — voir Global Constraints)**

Ajouter dans `src-tauri/src/commands/dashboards.rs`, après `close_dashboard_tab` :

```rust
#[tauri::command]
pub fn set_dashboard_tab_visible(
    state: State<DashboardState>,
    label: String,
    visible: bool,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Onglet introuvable: {}", label))?;

    if visible {
        webview.show().map_err(|e| format!("Erreur d'affichage: {}", e))
    } else {
        webview.hide().map_err(|e| format!("Erreur de masquage: {}", e))
    }
}

#[tauri::command]
pub fn resize_dashboard_tab(
    state: State<DashboardState>,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webviews = state
        .webviews
        .lock()
        .map_err(|e| format!("Erreur mutex: {}", e))?;
    let webview = webviews
        .get(&label)
        .ok_or_else(|| format!("Onglet introuvable: {}", label))?;

    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("Erreur de positionnement: {}", e))?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| format!("Erreur de redimensionnement: {}", e))?;
    Ok(())
}
```

Dans `src-tauri/src/lib.rs`, ajouter à la suite du bloc "Onglets web intégrés" dans `invoke_handler![...]` :

```rust
            dashboards::set_dashboard_tab_visible,
            dashboards::resize_dashboard_tab,
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: succès

- [ ] **Step 3: Run the full backend test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS (tous les tests existants + `default_state_has_no_webviews` de la Tâche 1)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/dashboards.rs src-tauri/src/lib.rs
git commit -m "feat: add set_dashboard_tab_visible and resize_dashboard_tab commands"
```

---

### Task 4: Types frontend + store des onglets

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/stores/useStore.ts`
- Create: `src/stores/useStore.dashboards.test.ts`

**Interfaces:**
- Consumes: commandes Tauri `open_dashboard_tab`, `close_dashboard_tab`, `set_dashboard_tab_visible`, `resize_dashboard_tab` (Tasks 2-3)
- Produces: type `DashboardTab { label: string; connectionId: string; url: string; title: string }`, store : `dashboardTabs: DashboardTab[]`, `activeDashboardTabLabel: string | null`, actions `openDashboardTab(tab, x, y, width, height)`, `closeDashboardTab(label)`, `setActiveDashboardTab(label)`, `resizeDashboardTab(label, x, y, width, height)`

- [ ] **Step 1: Write the failing tests**

Ajouter à `src/types/index.ts` :

```typescript
// ─── Onglets web intégrés ──────────────────────────────────────────────────

export interface DashboardTab {
  label: string;
  connectionId: string;
  url: string;
  title: string;
}
```

Créer `src/stores/useStore.dashboards.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./useStore";
import { DashboardTab } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const tabA: DashboardTab = { label: "conn-a", connectionId: "conn-a", url: "https://a:8006", title: "A" };
const tabB: DashboardTab = { label: "conn-b", connectionId: "conn-b", url: "https://b:8006", title: "B" };

describe("dashboard tabs store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    useStore.setState({ dashboardTabs: [], activeDashboardTabLabel: null });
  });

  it("openDashboardTab ajoute l'onglet et l'active", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);

    expect(useStore.getState().dashboardTabs).toEqual([tabA]);
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-a");
    expect(invoke).toHaveBeenCalledWith("open_dashboard_tab", {
      label: "conn-a",
      url: tabA.url,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("openDashboardTab cache l'onglet précédemment actif avant d'ouvrir le nouveau", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    vi.mocked(invoke).mockClear();

    await useStore.getState().openDashboardTab(tabB, 0, 0, 100, 100);

    expect(invoke).toHaveBeenCalledWith("set_dashboard_tab_visible", { label: "conn-a", visible: false });
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-b");
  });

  it("setActiveDashboardTab ne fait rien si l'onglet demandé est déjà actif", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    vi.mocked(invoke).mockClear();

    await useStore.getState().setActiveDashboardTab("conn-a");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("closeDashboardTab retire l'onglet et active le suivant s'il était actif", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    await useStore.getState().openDashboardTab(tabB, 0, 0, 100, 100);

    await useStore.getState().closeDashboardTab("conn-b");

    expect(useStore.getState().dashboardTabs).toEqual([tabA]);
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-a");
  });

  it("closeDashboardTab passe à null si c'était le dernier onglet", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);

    await useStore.getState().closeDashboardTab("conn-a");

    expect(useStore.getState().dashboardTabs).toEqual([]);
    expect(useStore.getState().activeDashboardTabLabel).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/stores/useStore.dashboards.test.ts`
Expected: FAIL — `openDashboardTab`/`closeDashboardTab`/`setActiveDashboardTab` n'existent pas encore sur le store

- [ ] **Step 3: Implement**

Dans `src/stores/useStore.ts`, mettre à jour l'import :

```typescript
import {
  AppSettings,
  GeneralSettings,
  AppearanceSettings,
  NetworkSettings,
  Theme,
  ImportSummary,
  Group,
  PingResult,
  ProxmoxConnection,
  ProxmoxConnectionPayload,
  ProxmoxSnapshot,
  ProxmoxVm,
  Server,
  ServerPayload,
  ServerStatus,
  SshResult,
  VmAction,
  VmType,
  DashboardTab,
} from "../types";
```

Ajouter à l'interface `AppStore` (après le bloc `// ── Proxmox ──`, avant `// ── Paramètres ──`) :

```typescript
  // ── Onglets web intégrés ───────────────────────────────────────────────
  dashboardTabs: DashboardTab[];
  activeDashboardTabLabel: string | null;
  openDashboardTab: (tab: DashboardTab, x: number, y: number, width: number, height: number) => Promise<void>;
  closeDashboardTab: (label: string) => Promise<void>;
  setActiveDashboardTab: (label: string | null) => Promise<void>;
  resizeDashboardTab: (label: string, x: number, y: number, width: number, height: number) => Promise<void>;
```

Ajouter au state initial du `create<AppStore>((set, get) => ({ ... }))` :

```typescript
  dashboardTabs: [],
  activeDashboardTabLabel: null,
```

Ajouter les implémentations (après le bloc Proxmox existant, avant `// ── Paramètres ──`) :

```typescript
  // ── Onglets web intégrés ───────────────────────────────────────────────
  openDashboardTab: async (tab, x, y, width, height) => {
    const prevActive = get().activeDashboardTabLabel;
    if (prevActive && prevActive !== tab.label) {
      await invoke("set_dashboard_tab_visible", { label: prevActive, visible: false }).catch(() => {});
    }

    const exists = get().dashboardTabs.some((t) => t.label === tab.label);
    await invoke("open_dashboard_tab", { label: tab.label, url: tab.url, x, y, width, height });

    if (!exists) {
      set((s) => ({ dashboardTabs: [...s.dashboardTabs, tab] }));
    }
    set({ activeDashboardTabLabel: tab.label });
  },

  closeDashboardTab: async (label) => {
    await invoke("close_dashboard_tab", { label });
    set((s) => {
      const remaining = s.dashboardTabs.filter((t) => t.label !== label);
      const activeDashboardTabLabel =
        s.activeDashboardTabLabel === label ? (remaining[0]?.label ?? null) : s.activeDashboardTabLabel;
      return { dashboardTabs: remaining, activeDashboardTabLabel };
    });
  },

  setActiveDashboardTab: async (label) => {
    const prev = get().activeDashboardTabLabel;
    if (prev === label) return;

    if (prev) {
      await invoke("set_dashboard_tab_visible", { label: prev, visible: false }).catch(() => {});
    }
    if (label) {
      await invoke("set_dashboard_tab_visible", { label, visible: true });
    }
    set({ activeDashboardTabLabel: label });
  },

  resizeDashboardTab: async (label, x, y, width, height) => {
    await invoke("resize_dashboard_tab", { label, x, y, width, height });
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/stores/useStore.dashboards.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/stores/useStore.ts src/stores/useStore.dashboards.test.ts
git commit -m "feat: add dashboard tabs types and Zustand store actions"
```

---

### Task 5: Hook `useDashboardTabSync`

**Files:**
- Create: `src/hooks/useDashboardTabSync.ts`
- Create: `src/hooks/useDashboardTabSync.test.ts`

**Interfaces:**
- Consumes: `useStore` (Task 4) — `activeDashboardTabLabel`, `resizeDashboardTab`
- Produces: `useDashboardTabSync(containerRef: React.RefObject<HTMLDivElement>): void`

- [ ] **Step 1: Write the failing tests**

Créer `src/hooks/useDashboardTabSync.test.ts` :

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDashboardTabSync } from "./useDashboardTabSync";
import { useStore } from "../stores/useStore";

describe("useDashboardTabSync", () => {
  let observeCallback: (() => void) | null = null;

  beforeEach(() => {
    observeCallback = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        observeCallback = cb;
      }
      observe() {}
      disconnect() {}
    };
  });

  it("appelle resizeDashboardTab avec les coordonnées mesurées au montage", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: "conn-1", resizeDashboardTab });

    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 300,
      height: 400,
    } as DOMRect);
    const ref = { current: el };

    renderHook(() => useDashboardTabSync(ref));

    expect(resizeDashboardTab).toHaveBeenCalledWith("conn-1", 10, 20, 300, 400);
  });

  it("re-synchronise quand ResizeObserver se déclenche", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: "conn-1", resizeDashboardTab });

    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as DOMRect);
    const ref = { current: el };

    renderHook(() => useDashboardTabSync(ref));
    resizeDashboardTab.mockClear();

    observeCallback?.();

    expect(resizeDashboardTab).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si aucun onglet n'est actif", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: null, resizeDashboardTab });

    const ref = { current: document.createElement("div") };

    renderHook(() => useDashboardTabSync(ref));

    expect(resizeDashboardTab).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/hooks/useDashboardTabSync.test.ts`
Expected: FAIL — le fichier `useDashboardTabSync.ts` n'existe pas

- [ ] **Step 3: Implement**

Créer `src/hooks/useDashboardTabSync.ts` :

```typescript
import { useEffect } from "react";
import { useStore } from "../stores/useStore";

/**
 * Garde la webview native de l'onglet actif alignée sur la zone de contenu
 * mesurée en DOM, y compris lors des redimensionnements de fenêtre.
 */
export function useDashboardTabSync(containerRef: React.RefObject<HTMLDivElement>) {
  const { activeDashboardTabLabel, resizeDashboardTab } = useStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activeDashboardTabLabel) return;

    function sync() {
      const rect = el!.getBoundingClientRect();
      resizeDashboardTab(activeDashboardTabLabel!, rect.left, rect.top, rect.width, rect.height);
    }

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [containerRef, activeDashboardTabLabel, resizeDashboardTab]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/hooks/useDashboardTabSync.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDashboardTabSync.ts src/hooks/useDashboardTabSync.test.ts
git commit -m "feat: add useDashboardTabSync hook"
```

---

### Task 6: Page `Dashboards`, entrée sidebar, routing

**Files:**
- Create: `src/pages/Dashboards.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useStore` (Task 4) — `dashboardTabs`, `activeDashboardTabLabel`, `setActiveDashboardTab`, `closeDashboardTab` ; `useDashboardTabSync` (Task 5)

- [ ] **Step 1: Implement**

Créer `src/pages/Dashboards.tsx` :

```typescript
import { useRef } from "react";
import { X, LayoutPanelTop } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useDashboardTabSync } from "../hooks/useDashboardTabSync";
import { cn } from "../utils";

export function Dashboards() {
  const { dashboardTabs, activeDashboardTabLabel, setActiveDashboardTab, closeDashboardTab } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useDashboardTabSync(containerRef);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border-primary bg-bg-secondary px-2 shrink-0 overflow-x-auto">
        {dashboardTabs.length === 0 && (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-3 px-1">
            <LayoutPanelTop size={14} className="opacity-50" />
            Aucun onglet ouvert — utilise "Ouvrir l'interface web" depuis une connexion.
          </div>
        )}
        {dashboardTabs.map((tab) => (
          <div
            key={tab.label}
            onClick={() => setActiveDashboardTab(tab.label)}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer border-b-2 transition-colors shrink-0",
              activeDashboardTabLabel === tab.label
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <span className="truncate max-w-[150px]">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeDashboardTab(tab.label);
              }}
              className="hover:text-red-400 transition-colors"
              title="Fermer l'onglet"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
```

Dans `src/components/Layout.tsx`, mettre à jour l'import et `NAV_ITEMS` :

```typescript
import { NavLink } from "react-router-dom";
import { LayoutDashboard, Server, Layers, Settings, Wifi, Boxes, LayoutPanelTop } from "lucide-react";
```

```typescript
const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/servers", icon: Server, label: "Serveurs" },
  { to: "/groups", icon: Layers, label: "Groupes" },
  { to: "/proxmox", icon: Boxes, label: "Proxmox" },
  { to: "/dashboards", icon: LayoutPanelTop, label: "Onglets web" },
  { to: "/settings", icon: Settings, label: "Paramètres" },
];
```

Dans `src/App.tsx`, ajouter l'import et la route :

```typescript
import { Dashboards } from "./pages/Dashboards";
```

```typescript
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/proxmox" element={<Proxmox />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Run the full frontend test suite**

Run: `npm run test -- --run`
Expected: PASS (tous les tests existants + ceux des Tâches 4 et 5)

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboards.tsx src/components/Layout.tsx src/App.tsx
git commit -m "feat: add Dashboards page, sidebar entry, and route"
```

---

### Task 7: Bouton "Ouvrir l'interface web" sur la page Proxmox

**Files:**
- Modify: `src/pages/Proxmox.tsx`

**Interfaces:**
- Consumes: `useStore` (Task 4) — `openDashboardTab` ; `useNavigate` de `react-router-dom` (déjà une dépendance du projet, utilisée par `App.tsx`/`HashRouter`)

- [ ] **Step 1: Implement**

Dans `src/pages/Proxmox.tsx`, mettre à jour les imports :

```typescript
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Server as ServerIcon, AlertCircle, Pencil, Trash2, Globe } from "lucide-react";
```

Dans le composant `Proxmox()`, ajouter après la ligne `const { proxmoxConnections, ... } = useStore();` (mettre à jour la déstructuration pour inclure `openDashboardTab`) :

```typescript
  const { proxmoxConnections, proxmoxVms, proxmoxErrors, loadProxmoxConnections, deleteProxmoxConnection, openDashboardTab } = useStore();
  const navigate = useNavigate();
```

Ajouter la fonction (avec les autres fonctions du composant, avant `return`) :

```typescript
  function openWebGui(conn: (typeof proxmoxConnections)[number]) {
    navigate("/dashboards");
    // Géométrie provisoire (plein écran) : useDashboardTabSync corrige la
    // position/taille dès que le conteneur de la page Dashboards est monté.
    openDashboardTab(
      { label: conn.id, connectionId: conn.id, url: conn.api_url, title: conn.name },
      0,
      0,
      window.innerWidth,
      window.innerHeight
    ).catch((e) => onMessage(String(e), "error"));
  }
```

Dans le JSX, ajouter le bouton dans la `<div className="flex items-center gap-1 ml-auto">` existante, avant le bouton "Modifier" (Pencil) :

```tsx
              <button
                onClick={() => openWebGui(conn)}
                className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                title="Ouvrir l'interface web"
              >
                <Globe size={13} />
              </button>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: aucune erreur de type

- [ ] **Step 3: Run the full frontend test suite**

Run: `npm run test -- --run`
Expected: PASS (aucune régression — ce composant n'a pas de fichier de test dédié, cohérent avec les pages existantes `Servers.tsx`/`Groups.tsx`)

- [ ] **Step 4: Manual verification**

Run: `npm run tauri dev`
Expected: sur la page Proxmox, chaque connexion a un bouton globe "Ouvrir l'interface web" ; cliquer dessus navigue vers Onglets web et affiche un nouvel onglet avec la vraie interface Proxmox (avec, le cas échéant, l'interstitiel de certificat auto-signé WebView2 standard — clic-through manuel attendu, comportement voulu pour cette v1).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Proxmox.tsx
git commit -m "feat: add 'open web GUI' button to Proxmox connection cards"
```

---

## Self-Review

**1. Couverture du spec :** 4 commandes Tauri (Tasks 2-3) ✓, aucune nouvelle entité persistée / réutilisation de `api_url` (Task 7, pas de nouveau champ) ✓, `DashboardState` séparé non persisté (Task 1) ✓, feature `unstable` (Task 1) ✓, page Dashboards + sidebar + route (Task 6) ✓, bouton d'entrée sur Proxmox (Task 7) ✓, `close_dashboard_tab` idempotente (Task 2, `if let Some`) ✓. Hors périmètre (bypass cert, SSO, persistance onglets, Docker/OPNsense) : aucune tâche n'y touche ✓.

**2. Placeholders :** aucun — vérifié.

**3. Cohérence des types :** `DashboardTab` (Task 4) utilisé identiquement dans le store, le hook (Task 5) et la page (Task 6) ; noms des 4 commandes Rust (Tasks 2-3) et des chaînes `invoke(...)` (Task 4) identiques caractère pour caractère.

**4. Review Focus :** les 5 points sont chacun couverts par un test explicite dans la tâche propriétaire (4 dans le store, 1 dans le hook) — confirmé, aucun gap.

---

## Execution Handoff

Plan complet et sauvegardé dans `docs/superpowers/plans/2026-09-25-embedded-web-tabs-plan.md`. Merci de le relire. Quelle approche d'exécution préfères-tu ?

- **Subagent-driven** — un sous-agent frais implémente chaque tâche et un reviewer frais la valide avant de passer à la suivante, puis une revue de branche complète à la fin. Le plus rigoureux ; coûte un contexte frais par tâche et par revue.
- **Native** — j'implémente moi-même toutes les tâches dans cette session, puis un reviewer frais sur le modèle le plus capable vérifie toute la branche. Le moins cher et le plus rapide ; pas de revue indépendante avant la fin.

Je recommande **Subagent-driven**, comme pour le module Proxmox : 7 tâches qui touchent à une API Rust encore jamais utilisée dans ce projet (`add_child`/multiwebview), où une erreur silencieuse (ex: mauvaise géométrie, webview qui ne se cache pas correctement) ne casserait rien à la compilation mais donnerait un rendu visuel cassé en usage réel — une revue par tâche vaut le coût. Cela capture-t-il ce que tu veux, et quelle approche utilise-t-on ?
