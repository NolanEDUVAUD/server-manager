import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  GeneralSettings,
  AppearanceSettings,
  NetworkSettings,
  Theme,
  ImportSummary,
  Group,
  PingResult,
  Server,
  ServerPayload,
  ServerStatus,
  SshResult,
} from "../types";
import {
  applyTheme,
  applyFontSize,
  applyBrightness,
  applyDensity,
  findTheme,
  BUILTIN_THEMES,
  ONE_HALF_DARK,
} from "../utils/theme";

// ── État global de l'application ──────────────────────────────────────────
interface AppStore {
  servers: Server[];
  groups: Group[];
  settings: AppSettings;
  allThemes: Theme[];
  pendingImport: ImportSummary | null;
  statuses: Record<string, ServerStatus>;
  loading: boolean;
  initialized: boolean;

  // ── Chargement initial ─────────────────────────────────────────────────
  initialize: () => Promise<void>;

  // ── Serveurs ───────────────────────────────────────────────────────────
  addServer: (payload: ServerPayload) => Promise<Server>;
  updateServer: (id: string, payload: ServerPayload) => Promise<Server>;
  deleteServer: (id: string) => Promise<void>;

  // ── Groupes ────────────────────────────────────────────────────────────
  addGroup: (name: string, icon?: string) => Promise<Group>;
  updateGroup: (
    id: string,
    data: { name?: string; server_ids?: string[]; icon?: string }
  ) => Promise<Group>;
  toggleServerInGroup: (groupId: string, serverId: string) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;

  // ── WoL ────────────────────────────────────────────────────────────────
  wakeServer: (serverId: string) => Promise<string>;
  wakeGroup: (groupId: string) => Promise<string[]>;

  // ── SSH ────────────────────────────────────────────────────────────────
  shutdownServer: (serverId: string) => Promise<SshResult>;
  rebootServer: (serverId: string) => Promise<SshResult>;
  shutdownGroup: (groupId: string) => Promise<[string, SshResult][]>;

  // ── Ping ───────────────────────────────────────────────────────────────
  pingServer: (serverId: string) => Promise<PingResult>;
  pingAll: () => Promise<void>;
  updateStatus: (results: PingResult[]) => void;

  // ── Paramètres ─────────────────────────────────────────────────────────
  updateSettings: (settings: AppSettings) => Promise<void>;
  updateAppearance: (partial: Partial<AppearanceSettings>) => Promise<void>;
  updateGeneral: (partial: Partial<GeneralSettings>) => Promise<void>;
  updateNetwork: (partial: Partial<NetworkSettings>) => Promise<void>;

  // ── Thèmes custom ──────────────────────────────────────────────────────
  saveCustomTheme: (theme: Theme) => Promise<void>;
  deleteCustomTheme: (id: string) => Promise<void>;

  // ── Import/Export ──────────────────────────────────────────────────────
  exportConfig: () => Promise<string>;
  importConfig: (json: string) => Promise<string>;
  exportFullConfig: () => Promise<string>;
  importFullConfig: () => Promise<ImportSummary>;
  applyImportConfig: (mode: 'merge' | 'replace') => Promise<void>;
  resetSettings: () => Promise<void>;
}

const DEFAULT_SETTINGS: AppSettings = {
  general: { start_minimized: false, auto_start: false, notifications: true },
  appearance: {
    brightness: 1.0,
    font_size: 14,
    density: 'Normal' as const,
    active_theme: 'one-half-dark',
    custom_themes: [],
  },
  network: { ping_interval_secs: 30, ping_timeout_ms: 2000, ssh_timeout_secs: 30 },
};

export const useStore = create<AppStore>((set, get) => ({
  servers: [],
  groups: [],
  settings: DEFAULT_SETTINGS,
  allThemes: [...BUILTIN_THEMES],
  pendingImport: null,
  statuses: {},
  loading: false,
  initialized: false,

  // ── Initialisation ─────────────────────────────────────────────────────
  initialize: async () => {
    if (get().initialized) return;
    set({ loading: true });
    try {
      const [servers, groups, settings] = await Promise.all([
        invoke<Server[]>("get_servers"),
        invoke<Group[]>("get_groups"),
        invoke<AppSettings>("get_settings"),
      ]);
      // Appliquer le thème, la police, la luminosité et la densité
      const customThemes = settings.appearance.custom_themes;
      const theme = findTheme(settings.appearance.active_theme, customThemes);
      applyTheme(theme);
      applyFontSize(settings.appearance.font_size);
      applyBrightness(settings.appearance.brightness);
      applyDensity(settings.appearance.density);
      set({
        servers,
        groups,
        settings,
        allThemes: [...BUILTIN_THEMES, ...customThemes],
        initialized: true,
      });
    } finally {
      set({ loading: false });
    }
  },

  // ── Serveurs ───────────────────────────────────────────────────────────
  addServer: async (payload) => {
    const server = await invoke<Server>("add_server", { payload });
    set((s) => ({ servers: [...s.servers, server] }));
    return server;
  },

  updateServer: async (id, payload) => {
    const server = await invoke<Server>("update_server", { id, payload });
    set((s) => ({
      servers: s.servers.map((sv) => (sv.id === id ? server : sv)),
    }));
    return server;
  },

  deleteServer: async (id) => {
    await invoke("delete_server", { id });
    set((s) => ({
      servers: s.servers.filter((sv) => sv.id !== id),
      groups: s.groups.map((g) => ({
        ...g,
        server_ids: g.server_ids.filter((sid) => sid !== id),
      })),
      statuses: Object.fromEntries(
        Object.entries(s.statuses).filter(([key]) => key !== id)
      ),
    }));
  },

  // ── Groupes ────────────────────────────────────────────────────────────
  addGroup: async (name, icon) => {
    const group = await invoke<Group>("add_group", { name, icon: icon ?? null });
    set((s) => ({ groups: [...s.groups, group] }));
    return group;
  },

  updateGroup: async (id, data) => {
    const group = await invoke<Group>("update_group", {
      id,
      name: data.name ?? null,
      serverIds: data.server_ids ?? null,
      icon: data.icon ?? null,
    });
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? group : g)),
    }));
    return group;
  },

  toggleServerInGroup: async (groupId, serverId) => {
    const group = await invoke<Group>("toggle_server_in_group", {
      groupId,
      serverId,
    });
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? group : g)),
    }));
    return group;
  },

  deleteGroup: async (id) => {
    await invoke("delete_group", { id });
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
  },

  // ── WoL ────────────────────────────────────────────────────────────────
  wakeServer: async (serverId) => {
    return invoke<string>("wake_on_lan", { serverId });
  },

  wakeGroup: async (groupId) => {
    return invoke<string[]>("wake_group", { groupId });
  },

  // ── SSH ────────────────────────────────────────────────────────────────
  shutdownServer: async (serverId) => {
    return invoke<SshResult>("ssh_shutdown", { serverId });
  },

  rebootServer: async (serverId) => {
    return invoke<SshResult>("ssh_reboot", { serverId });
  },

  shutdownGroup: async (groupId) => {
    return invoke<[string, SshResult][]>("ssh_shutdown_group", { groupId });
  },

  // ── Ping ───────────────────────────────────────────────────────────────
  pingServer: async (serverId) => {
    const result = await invoke<PingResult>("ping_server", { serverId });
    set((s) => ({
      statuses: {
        ...s.statuses,
        [serverId]: {
          online: result.online,
          latency_ms: result.latency_ms,
          last_checked: Date.now(),
        },
      },
    }));
    return result;
  },

  pingAll: async () => {
    const results = await invoke<PingResult[]>("ping_all");
    get().updateStatus(results);
  },

  updateStatus: (results) => {
    const now = Date.now();
    const updates: Record<string, ServerStatus> = {};
    for (const r of results) {
      updates[r.server_id] = {
        online: r.online,
        latency_ms: r.latency_ms,
        last_checked: now,
      };
    }
    set((s) => ({ statuses: { ...s.statuses, ...updates } }));
  },

  // ── Paramètres (mise à jour complète) ──────────────────────────────────
  updateSettings: async (settings) => {
    await invoke("update_settings", { settings });
    set({ settings });
  },

  // ── Paramètres d'apparence ─────────────────────────────────────────────
  updateAppearance: async (partial) => {
    const state = get();
    const newAppearance = { ...state.settings.appearance, ...partial };
    const newSettings = { ...state.settings, appearance: newAppearance };
    await invoke("update_settings", { settings: newSettings });
    // Appliquer les changements visuels immédiatement
    if (partial.active_theme !== undefined) {
      const theme = findTheme(partial.active_theme, newAppearance.custom_themes);
      applyTheme(theme);
    }
    if (partial.font_size !== undefined) applyFontSize(partial.font_size);
    if (partial.brightness !== undefined) applyBrightness(partial.brightness);
    if (partial.density !== undefined) applyDensity(partial.density);
    set({ settings: newSettings });
  },

  // ── Paramètres généraux ────────────────────────────────────────────────
  updateGeneral: async (partial) => {
    const state = get();
    const newGeneral = { ...state.settings.general, ...partial };
    const newSettings = { ...state.settings, general: newGeneral };
    await invoke("update_settings", { settings: newSettings });
    set({ settings: newSettings });
  },

  // ── Paramètres réseau ──────────────────────────────────────────────────
  updateNetwork: async (partial) => {
    const state = get();
    const newNetwork = { ...state.settings.network, ...partial };
    const newSettings = { ...state.settings, network: newNetwork };
    await invoke("update_settings", { settings: newSettings });
    set({ settings: newSettings });
  },

  // ── Thèmes personnalisés ───────────────────────────────────────────────
  saveCustomTheme: async (theme) => {
    await invoke("save_custom_theme", { theme });
    const state = get();
    const customs = [...state.settings.appearance.custom_themes];
    const idx = customs.findIndex((t) => t.id === theme.id);
    if (idx >= 0) {
      customs[idx] = theme;
    } else {
      customs.push(theme);
    }
    set({
      allThemes: [...BUILTIN_THEMES, ...customs],
      settings: {
        ...state.settings,
        appearance: { ...state.settings.appearance, custom_themes: customs },
      },
    });
  },

  deleteCustomTheme: async (id) => {
    await invoke("delete_custom_theme", { id });
    const state = get();
    const customs = state.settings.appearance.custom_themes.filter(
      (t) => t.id !== id
    );
    set({
      allThemes: [...BUILTIN_THEMES, ...customs],
      settings: {
        ...state.settings,
        appearance: { ...state.settings.appearance, custom_themes: customs },
      },
    });
  },

  // ── Import/Export (ancienne API) ───────────────────────────────────────
  exportConfig: () => invoke<string>("export_config"),

  importConfig: async (json) => {
    const msg = await invoke<string>("import_config", { json });
    // Recharger les données après import
    const [servers, groups] = await Promise.all([
      invoke<Server[]>("get_servers"),
      invoke<Group[]>("get_groups"),
    ]);
    set({ servers, groups });
    return msg;
  },

  // ── Import/Export complet (nouvelle API v2) ────────────────────────────
  exportFullConfig: async () => {
    return await invoke<string>("export_full_config");
  },

  importFullConfig: async () => {
    const summary = await invoke<ImportSummary>("import_full_config");
    set({ pendingImport: summary });
    return summary;
  },

  applyImportConfig: async (mode) => {
    await invoke("apply_import_config", { mode });
    set({ pendingImport: null });
    // Recharger toutes les données après application de l'import
    const state = get();
    // Réinitialiser le flag pour forcer un rechargement complet
    set({ initialized: false });
    await state.initialize();
  },

  // ── Réinitialisation des paramètres ───────────────────────────────────
  resetSettings: async () => {
    const defaults: AppSettings = {
      general: { start_minimized: false, auto_start: false, notifications: true },
      appearance: {
        brightness: 1.0,
        font_size: 14,
        density: 'Normal',
        active_theme: 'one-half-dark',
        custom_themes: [],
      },
      network: { ping_interval_secs: 30, ping_timeout_ms: 2000, ssh_timeout_secs: 30 },
    };
    await invoke("update_settings", { settings: defaults });
    applyTheme(ONE_HALF_DARK);
    applyFontSize(14);
    applyBrightness(1.0);
    applyDensity('Normal');
    set({ settings: defaults, allThemes: [...BUILTIN_THEMES] });
  },
}));
