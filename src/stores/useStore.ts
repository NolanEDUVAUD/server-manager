import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  GeneralSettings,
  AppearanceSettings,
  NetworkSettings,
  HistorySettings,
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
  MetricsSample,
  AppEvent,
  Schedule,
  ScheduleSaveReport,
  TerminalSession,
  ServerMetrics,
  Tag,
  Folder,
  ItemKind,
} from "../types";
import { EMPTY_FILTERS, FilterScope, ItemFilters, withoutFolder, withoutTag } from "../utils/filters";
import {
  applyTheme,
  applyFontSize,
  applyBrightness,
  applyDensity,
  findTheme,
  BUILTIN_THEMES,
  ONE_HALF_DARK,
} from "../utils/theme";
import { appendSample, mergeSamples } from "../utils";

/** 120 points × 15 s = 30 min d'historique par serveur */
export const METRICS_HISTORY_MAX = 120;

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
  updateHistory: (partial: Partial<HistorySettings>) => Promise<void>;

  // ── Proxmox ────────────────────────────────────────────────────────────
  proxmoxConnections: ProxmoxConnection[];
  proxmoxVms: Record<string, ProxmoxVm[]>;
  proxmoxLoading: Record<string, boolean>;
  proxmoxErrors: Record<string, string | null>;
  loadProxmoxConnections: () => Promise<void>;
  addProxmoxConnection: (payload: ProxmoxConnectionPayload) => Promise<ProxmoxConnection>;
  updateProxmoxConnection: (id: string, payload: ProxmoxConnectionPayload) => Promise<ProxmoxConnection>;
  deleteProxmoxConnection: (id: string) => Promise<void>;
  testProxmoxConnection: (payload: ProxmoxConnectionPayload) => Promise<void>;
  loadProxmoxVms: (connectionId: string) => Promise<void>;
  proxmoxVmAction: (connectionId: string, node: string, vmid: number, vmType: VmType, action: VmAction) => Promise<string>;
  proxmoxSnapshotList: (connectionId: string, node: string, vmid: number, vmType: VmType) => Promise<ProxmoxSnapshot[]>;
  proxmoxSnapshotCreate: (connectionId: string, node: string, vmid: number, vmType: VmType, name: string) => Promise<string>;
  proxmoxSnapshotRollback: (connectionId: string, node: string, vmid: number, vmType: VmType, name: string) => Promise<string>;
  proxmoxCloneVm: (connectionId: string, node: string, vmid: number, vmType: VmType, newName: string) => Promise<string>;

  // ── Onglets web intégrés ───────────────────────────────────────────────
  dashboardTabs: DashboardTab[];
  activeDashboardTabLabel: string | null;

  // ── Monitoring des ressources ──────────────────────────────────────────
  metrics: Record<string, ServerMetrics>;
  metricsErrors: Record<string, string>;
  metricsHistory: Record<string, MetricsSample[]>;
  /** Recharge depuis la base les derniers points de chaque serveur (courbes après redémarrage) */
  loadRecentMetrics: () => Promise<void>;
  fetchMetrics: (serverId: string) => Promise<void>;
  /** Résultat de collecte (reçu du backend ou d'une collecte manuelle) */
  applyMetrics: (serverId: string, metrics: ServerMetrics | null, error: string | null) => void;

  // ── Historique des événements ──────────────────────────────────────────
  /** Du plus récent au plus ancien */
  events: AppEvent[];
  loadEvents: () => Promise<void>;
  addEvent: (event: AppEvent) => void;
  clearEvents: () => Promise<void>;

  // ── Planificateur ──────────────────────────────────────────────────────
  schedules: Schedule[];
  loadSchedules: () => Promise<void>;
  saveSchedule: (schedule: Schedule) => Promise<ScheduleSaveReport>;
  /** Renvoie les erreurs de nettoyage des crontabs (vide si tout va bien) */
  deleteSchedule: (id: string) => Promise<string[]>;
  runScheduleNow: (id: string) => Promise<void>;

  // ── Console SSH ────────────────────────────────────────────────────────
  terminalSessions: TerminalSession[];
  activeTerminalKey: string | null;
  /** Crée une session (la connexion est lancée par le composant TerminalView) */
  openTerminal: (serverId: string) => string;
  updateTerminal: (key: string, patch: Partial<TerminalSession>) => void;
  reconnectTerminal: (key: string) => void;
  closeTerminal: (key: string) => Promise<void>;
  setActiveTerminal: (key: string) => void;
  openDashboardTab: (tab: DashboardTab, x: number, y: number, width: number, height: number) => Promise<void>;
  closeDashboardTab: (label: string) => Promise<void>;
  setActiveDashboardTab: (label: string | null) => Promise<void>;
  resizeDashboardTab: (label: string, x: number, y: number, width: number, height: number) => Promise<void>;

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

  // ── Organisation (tags, dossiers, favoris, filtres, aide clavier) ──────
  tags: Tag[];
  folders: Folder[];
  loadOrganisation: () => Promise<void>;
  /** Crée (id vide) ou modifie un tag */
  saveTag: (tag: Tag) => Promise<Tag>;
  /** Supprime le tag ; le backend le retire de tous les serveurs et services */
  deleteTag: (id: string) => Promise<void>;
  saveFolder: (folder: Folder) => Promise<Folder>;
  /** Supprime le dossier ; ses éléments passent « sans dossier » */
  deleteFolder: (id: string) => Promise<void>;
  /** Bascule un favori ; les serveurs du store sont mis à jour (les services le sont par leur page) */
  toggleFavorite: (kind: ItemKind, id: string) => Promise<boolean>;
  /** Filtres des pages Serveurs et Services, conservés pendant la session */
  filters: Record<FilterScope, ItemFilters>;
  setFilters: (scope: FilterScope, patch: Partial<ItemFilters>) => void;
  clearFilters: (scope: FilterScope) => void;
  shortcutsHelpOpen: boolean;
  setShortcutsHelpOpen: (open: boolean) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  general: { start_minimized: false, auto_start: false, notifications: true, close_to_tray: true, hidden_modules: [], onboarding_done: true },
  appearance: {
    brightness: 1.0,
    font_size: 14,
    density: 'Normal' as const,
    active_theme: 'one-half-dark',
    custom_themes: [],
  },
  network: {
    ping_interval_secs: 30,
    ping_timeout_ms: 2000,
    ssh_timeout_secs: 30,
    proxmox_poll_interval_secs: 15,
    proxmox_timeout_secs: 10,
    metrics_enabled: true,
    metrics_interval_secs: 15,
  },
  history: { raw_days: 7, hourly_days: 90, event_days: 90 },
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
  proxmoxConnections: [],
  proxmoxVms: {},
  proxmoxLoading: {},
  proxmoxErrors: {},
  dashboardTabs: [],
  activeDashboardTabLabel: null,
  metrics: {},
  metricsErrors: {},
  metricsHistory: {},
  terminalSessions: [],
  activeTerminalKey: null,
  events: [],
  schedules: [],

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
      // Tags et dossiers : chargés à part, un échec n'empêche pas le démarrage
      get().loadOrganisation().catch(console.error);
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

  // ── Rétention de l'historique ──────────────────────────────────────────
  updateHistory: async (partial) => {
    const state = get();
    const newSettings = { ...state.settings, history: { ...state.settings.history, ...partial } };
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

  // ── Proxmox ────────────────────────────────────────────────────────────
  loadProxmoxConnections: async () => {
    const connections = await invoke<ProxmoxConnection[]>("proxmox_list_connections");
    set({ proxmoxConnections: connections });
  },

  addProxmoxConnection: async (payload) => {
    const connection = await invoke<ProxmoxConnection>("proxmox_add_connection", { payload });
    set((s) => ({ proxmoxConnections: [...s.proxmoxConnections, connection] }));
    return connection;
  },

  updateProxmoxConnection: async (id, payload) => {
    const connection = await invoke<ProxmoxConnection>("proxmox_update_connection", { id, payload });
    set((s) => ({
      proxmoxConnections: s.proxmoxConnections.map((c) => (c.id === id ? connection : c)),
    }));
    return connection;
  },

  deleteProxmoxConnection: async (id) => {
    await invoke("proxmox_delete_connection", { id });
    set((s) => ({
      proxmoxConnections: s.proxmoxConnections.filter((c) => c.id !== id),
      proxmoxVms: Object.fromEntries(Object.entries(s.proxmoxVms).filter(([key]) => key !== id)),
    }));
  },

  testProxmoxConnection: async (payload) => {
    await invoke("proxmox_test_connection", { payload });
  },

  loadProxmoxVms: async (connectionId) => {
    set((s) => ({ proxmoxLoading: { ...s.proxmoxLoading, [connectionId]: true } }));
    try {
      const vms = await invoke<ProxmoxVm[]>("proxmox_list_vms", { connectionId });
      set((s) => ({
        proxmoxVms: { ...s.proxmoxVms, [connectionId]: vms },
        proxmoxErrors: { ...s.proxmoxErrors, [connectionId]: null },
      }));
    } catch (e) {
      set((s) => ({ proxmoxErrors: { ...s.proxmoxErrors, [connectionId]: String(e) } }));
    } finally {
      set((s) => ({ proxmoxLoading: { ...s.proxmoxLoading, [connectionId]: false } }));
    }
  },

  proxmoxVmAction: async (connectionId, node, vmid, vmType, action) => {
    return invoke<string>("proxmox_vm_action", { connectionId, node, vmid, vmType, action });
  },

  proxmoxSnapshotList: async (connectionId, node, vmid, vmType) => {
    return invoke<ProxmoxSnapshot[]>("proxmox_vm_snapshot_list", { connectionId, node, vmid, vmType });
  },

  proxmoxSnapshotCreate: async (connectionId, node, vmid, vmType, name) => {
    return invoke<string>("proxmox_vm_snapshot_create", { connectionId, node, vmid, vmType, name });
  },

  proxmoxSnapshotRollback: async (connectionId, node, vmid, vmType, name) => {
    return invoke<string>("proxmox_vm_snapshot_rollback", { connectionId, node, vmid, vmType, name });
  },

  proxmoxCloneVm: async (connectionId, node, vmid, vmType, newName) => {
    return invoke<string>("proxmox_vm_clone", { connectionId, node, vmid, vmType, newName });
  },

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

    // Mise à jour atomique AVANT le ré-affichage : une action lancée pendant l'await
    // ci-dessous part ainsi de l'état à jour, au lieu d'être écrasée par un instantané périmé.
    let promoted = null as string | null;
    set((s) => {
      const remaining = s.dashboardTabs.filter((t) => t.label !== label);
      if (s.activeDashboardTabLabel !== label) return { dashboardTabs: remaining };
      promoted = remaining[0]?.label ?? null;
      return { dashboardTabs: remaining, activeDashboardTabLabel: promoted };
    });

    // L'onglet de repli avait pu être masqué quand un autre était passé au premier plan
    if (promoted) {
      await invoke("set_dashboard_tab_visible", { label: promoted, visible: true }).catch(() => {});
    }
  },

  // ── Monitoring des ressources ──────────────────────────────────────────
  fetchMetrics: async (serverId) => {
    try {
      get().applyMetrics(serverId, await invoke<ServerMetrics>("get_server_metrics", { serverId }), null);
    } catch (e) {
      get().applyMetrics(serverId, null, String(e));
    }
  },

  applyMetrics: (serverId, m, error) => {
    if (!m) {
      // On retire les valeurs périmées pour ne pas les afficher comme actuelles ;
      // l'historique déjà collecté reste visible.
      set((s) => {
        const { [serverId]: _stale, ...metrics } = s.metrics;
        return { metrics, metricsErrors: { ...s.metricsErrors, [serverId]: error ?? "Erreur inconnue" } };
      });
      return;
    }
    const sample: MetricsSample = {
      t: Date.now(),
      cpu: m.cpu_percent,
      mem: m.mem_total_bytes > 0 ? (m.mem_used_bytes * 100) / m.mem_total_bytes : 0,
    };
    set((s) => {
      const { [serverId]: _cleared, ...metricsErrors } = s.metricsErrors;
      return {
        metrics: { ...s.metrics, [serverId]: m },
        metricsErrors,
        metricsHistory: {
          ...s.metricsHistory,
          [serverId]: appendSample(s.metricsHistory[serverId], sample, METRICS_HISTORY_MAX),
        },
      };
    });
  },

  loadRecentMetrics: async () => {
    const recent = await invoke<Record<string, MetricsSample[]>>("get_recent_metrics", { limit: METRICS_HISTORY_MAX });
    if (!recent) return;
    set((s) => {
      const metricsHistory = { ...s.metricsHistory };
      for (const [serverId, points] of Object.entries(recent)) {
        metricsHistory[serverId] = mergeSamples(points, s.metricsHistory[serverId], METRICS_HISTORY_MAX);
      }
      return { metricsHistory };
    });
  },

  // ── Historique des événements ──────────────────────────────────────────
  loadEvents: async () => {
    const events = await invoke<AppEvent[]>("get_events");
    set({ events });
  },

  addEvent: (event) => {
    set((s) => (s.events.some((e) => e.id === event.id) ? s : { events: [event, ...s.events] }));
  },

  clearEvents: async () => {
    await invoke("clear_events");
    set({ events: [] });
  },

  // ── Planificateur ──────────────────────────────────────────────────────
  loadSchedules: async () => {
    set({ schedules: await invoke<Schedule[]>("get_schedules") });
  },

  saveSchedule: async (schedule) => {
    const report = await invoke<ScheduleSaveReport>("save_schedule", { schedule });
    const saved = report.schedule;
    set((s) => ({
      schedules: s.schedules.some((x) => x.id === saved.id)
        ? s.schedules.map((x) => (x.id === saved.id ? saved : x))
        : [...s.schedules, saved],
    }));
    return report;
  },

  deleteSchedule: async (id) => {
    const errors = await invoke<string[]>("delete_schedule", { id });
    set((s) => ({ schedules: s.schedules.filter((x) => x.id !== id) }));
    return errors;
  },

  runScheduleNow: async (id) => {
    await invoke("run_schedule_now", { id });
  },

  // ── Console SSH ────────────────────────────────────────────────────────
  openTerminal: (serverId) => {
    const key = crypto.randomUUID();
    set((s) => {
      const name = s.servers.find((sv) => sv.id === serverId)?.name ?? serverId;
      const count = s.terminalSessions.filter((t) => t.serverId === serverId).length;
      const session: TerminalSession = {
        key,
        serverId,
        title: count === 0 ? name : `${name} (${count + 1})`,
        status: "connecting",
        attempt: 0,
      };
      return { terminalSessions: [...s.terminalSessions, session], activeTerminalKey: key };
    });
    return key;
  },

  updateTerminal: (key, patch) => {
    set((s) => ({
      terminalSessions: s.terminalSessions.map((t) => (t.key === key ? { ...t, ...patch } : t)),
    }));
  },

  reconnectTerminal: (key) => {
    set((s) => ({
      terminalSessions: s.terminalSessions.map((t) =>
        t.key === key
          ? { ...t, status: "connecting", closedReason: undefined, sessionId: undefined, attempt: t.attempt + 1 }
          : t
      ),
    }));
  },

  closeTerminal: async (key) => {
    const session = get().terminalSessions.find((t) => t.key === key);
    set((s) => {
      const index = s.terminalSessions.findIndex((t) => t.key === key);
      const remaining = s.terminalSessions.filter((t) => t.key !== key);
      const activeTerminalKey =
        s.activeTerminalKey === key
          ? (remaining[Math.min(index, remaining.length - 1)]?.key ?? null)
          : s.activeTerminalKey;
      return { terminalSessions: remaining, activeTerminalKey };
    });
    if (session?.sessionId) {
      await invoke("terminal_close", { sessionId: session.sessionId }).catch(() => {});
    }
  },

  setActiveTerminal: (key) => set({ activeTerminalKey: key }),

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
    await get().loadOrganisation();
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
      general: { start_minimized: false, auto_start: false, notifications: true, close_to_tray: true, hidden_modules: [], onboarding_done: true },
      appearance: {
        brightness: 1.0,
        font_size: 14,
        density: 'Normal',
        active_theme: 'one-half-dark',
        custom_themes: [],
      },
      network: {
        ping_interval_secs: 30,
        ping_timeout_ms: 2000,
        ssh_timeout_secs: 30,
        proxmox_poll_interval_secs: 15,
        proxmox_timeout_secs: 10,
        metrics_enabled: true,
        metrics_interval_secs: 15,
      },
      history: { raw_days: 7, hourly_days: 90, event_days: 90 },
    };
    await invoke("update_settings", { settings: defaults });
    applyTheme(ONE_HALF_DARK);
    applyFontSize(14);
    applyBrightness(1.0);
    applyDensity('Normal');
    set({ settings: defaults, allThemes: [...BUILTIN_THEMES] });
  },

  // ── Organisation ───────────────────────────────────────────────────────
  tags: [],
  folders: [],
  filters: { servers: EMPTY_FILTERS, services: EMPTY_FILTERS },
  shortcutsHelpOpen: false,

  loadOrganisation: async () => {
    const org = await invoke<{ tags: Tag[]; folders: Folder[] }>("get_organisation");
    set({ tags: org.tags, folders: org.folders });
  },

  saveTag: async (tag) => {
    const saved = await invoke<Tag>("save_tag", { tag });
    set((s) => ({
      tags: s.tags.some((t) => t.id === saved.id) ? s.tags.map((t) => (t.id === saved.id ? saved : t)) : [...s.tags, saved],
    }));
    return saved;
  },

  deleteTag: async (id) => {
    await invoke("delete_tag", { id });
    set((s) => ({
      tags: s.tags.filter((t) => t.id !== id),
      servers: s.servers.map((sv) => (sv.tag_ids?.includes(id) ? { ...sv, tag_ids: sv.tag_ids.filter((t) => t !== id) } : sv)),
      filters: { servers: withoutTag(s.filters.servers, id), services: withoutTag(s.filters.services, id) },
    }));
  },

  saveFolder: async (folder) => {
    const saved = await invoke<Folder>("save_folder", { folder });
    set((s) => ({
      folders: s.folders.some((f) => f.id === saved.id) ? s.folders.map((f) => (f.id === saved.id ? saved : f)) : [...s.folders, saved],
    }));
    return saved;
  },

  deleteFolder: async (id) => {
    await invoke("delete_folder", { id });
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      servers: s.servers.map((sv) => (sv.folder_id === id ? { ...sv, folder_id: null } : sv)),
      filters: { servers: withoutFolder(s.filters.servers, id), services: withoutFolder(s.filters.services, id) },
    }));
  },

  toggleFavorite: async (kind, id) => {
    const favorite = await invoke<boolean>("toggle_favorite", { kind, id });
    if (kind === "server") {
      set((s) => ({ servers: s.servers.map((sv) => (sv.id === id ? { ...sv, favorite } : sv)) }));
    }
    return favorite;
  },

  setFilters: (scope, patch) => set((s) => ({ filters: { ...s.filters, [scope]: { ...s.filters[scope], ...patch } } })),
  clearFilters: (scope) => set((s) => ({ filters: { ...s.filters, [scope]: EMPTY_FILTERS } })),
  setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
}));
