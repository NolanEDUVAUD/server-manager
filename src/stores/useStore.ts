import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  Group,
  PingResult,
  Server,
  ServerPayload,
  ServerStatus,
  SshResult,
} from "../types";

// ── État global de l'application ──────────────────────────────────────────
interface AppStore {
  servers: Server[];
  groups: Group[];
  settings: AppSettings;
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
  exportConfig: () => Promise<string>;
  importConfig: (json: string) => Promise<string>;
}

const DEFAULT_SETTINGS: AppSettings = {
  ping_interval_secs: 30,
  ping_timeout_ms: 2000,
  ssh_timeout_secs: 30,
};

export const useStore = create<AppStore>((set, get) => ({
  servers: [],
  groups: [],
  settings: DEFAULT_SETTINGS,
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
      set({ servers, groups, settings, initialized: true });
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

  // ── Paramètres ─────────────────────────────────────────────────────────
  updateSettings: async (settings) => {
    await invoke("update_settings", { settings });
    set({ settings });
  },

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
}));
