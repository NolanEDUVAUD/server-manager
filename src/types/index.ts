// ── Types miroir des structs Rust ──────────────────────────────────────────

export type OsType = "Linux" | "Windows" | "Proxmox" | "TrueNAS" | "ESXi";

export interface Server {
  id: string;
  name: string;
  ip: string;
  mac_address: string;
  ssh_user: string;
  /** Mot de passe chiffré (ne jamais afficher en clair) */
  ssh_password: string;
  ssh_port: number;
  shutdown_command: string;
  reboot_command: string;
  os_type: OsType;
  icon?: string | null;
  notes?: string | null;
}

export interface ServerPayload {
  name: string;
  ip: string;
  mac_address: string;
  ssh_user: string;
  /** Mot de passe en clair (sera chiffré côté Rust) */
  ssh_password: string;
  ssh_port: number;
  shutdown_command?: string;
  reboot_command?: string;
  os_type: OsType;
  icon?: string | null;
  notes?: string | null;
}

export interface Group {
  id: string;
  name: string;
  server_ids: string[];
  icon?: string | null;
}

// ─── Thème ───────────────────────────────────────────────────────────────────

export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  colors: Record<string, string>;
}

export type Density = 'Compact' | 'Normal' | 'Comfortable';

// ─── AppSettings v2 ──────────────────────────────────────────────────────────

export interface GeneralSettings {
  start_minimized: boolean;
  auto_start: boolean;
  notifications: boolean;
  /** Fermer la fenêtre la réduit dans la zone de notification */
  close_to_tray: boolean;
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
  proxmox_poll_interval_secs: number;
  proxmox_timeout_secs: number;
  metrics_enabled: boolean;
  metrics_interval_secs: number;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  network: NetworkSettings;
}

// ─── Import/Export ───────────────────────────────────────────────────────────

export interface ImportSummary {
  servers_count: number;
  groups_count: number;
  settings_present: boolean;
  config_version: string;
  exported_at: string | null;
}

export interface PingResult {
  server_id: string;
  online: boolean;
  latency_ms: number | null;
}

export interface SshResult {
  success: boolean;
  output: string;
  error: string | null;
}

// ── Status en temps réel (stocké dans le store frontend) ─────────────────
export interface ServerStatus {
  online: boolean;
  latency_ms: number | null;
  last_checked: number; // timestamp ms
}

// ── Toast notifications ───────────────────────────────────────────────────
export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// ── OS metadata ───────────────────────────────────────────────────────────
export const OS_ICONS: Record<OsType, string> = {
  Linux: "🐧",
  Windows: "🪟",
  Proxmox: "🔷",
  TrueNAS: "💾",
  ESXi: "⚙️",
};

export const OS_COLORS: Record<OsType, string> = {
  Linux: "#f59e0b",
  Windows: "#0078d4",
  Proxmox: "#e11d48",
  TrueNAS: "#0ea5e9",
  ESXi: "#8b5cf6",
};

export const DEFAULT_SSH_PORT = 22;

export const OS_TYPES: OsType[] = ["Linux", "Windows", "Proxmox", "TrueNAS", "ESXi"];

// ─── Proxmox ───────────────────────────────────────────────────────────────

export type VmType = "qemu" | "lxc";
export type VmAction = "start" | "stop" | "shutdown" | "reboot" | "suspend";

export interface ProxmoxConnection {
  id: string;
  name: string;
  api_url: string;
  token_id: string;
  /** Toujours vide côté frontend — jamais transmis en clair */
  token_secret: string;
  verify_tls: boolean;
}

export interface ProxmoxConnectionPayload {
  name: string;
  api_url: string;
  token_id: string;
  token_secret: string;
  verify_tls: boolean;
}

export interface ProxmoxVm {
  vmid: number;
  name: string;
  node: string;
  vm_type: VmType;
  status: string;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
}

export interface ProxmoxSnapshot {
  name: string;
  description: string;
  snaptime: number | null;
}

// ─── Onglets web intégrés ──────────────────────────────────────────────────

export interface DashboardTab {
  label: string;
  connectionId: string;
  url: string;
  title: string;
}

// ─── Monitoring des ressources ──────────────────────────────────────────────

export interface DiskUsage {
  name: string;
  mount: string;
  fs_type: string;
  total_bytes: number;
  used_bytes: number;
}

export interface TempSensor {
  chip: string;
  label: string;
  celsius: number;
}

export interface ServerMetrics {
  cpu_percent: number;
  mem_total_bytes: number;
  mem_used_bytes: number;
  uptime_secs: number;
  load_avg: [number, number, number];
  disks: DiskUsage[];
  temperatures: TempSensor[];
  cpu_temp_celsius: number | null;
}

/** Point d'historique en mémoire (CPU et RAM en %) */
export interface MetricsSample {
  t: number;
  cpu: number;
  mem: number;
}

// ─── Console SSH ────────────────────────────────────────────────────────────

export type TerminalStatus = "connecting" | "open" | "closed";

export interface TerminalSession {
  /** Clé côté frontend, stable entre les reconnexions */
  key: string;
  serverId: string;
  title: string;
  /** Identifiant de session côté Rust, défini une fois connecté */
  sessionId?: string;
  status: TerminalStatus;
  closedReason?: string;
  /** Incrémenté à chaque reconnexion pour relancer la connexion du terminal */
  attempt: number;
}

// ─── Historique des événements ──────────────────────────────────────────────

export type EventKind = "Offline" | "Online" | "Wake" | "Shutdown" | "Reboot" | "VmAction" | "Container" | "Failure" | "Alert";

export interface AppEvent {
  id: string;
  /** Horodatage en millisecondes */
  ts: number;
  kind: EventKind;
  server_id: string | null;
  target: string;
  message: string;
}

export interface ServerEventStats {
  server_id: string;
  outages: number;
  downtime_ms: number;
}

// ─── Planificateur ──────────────────────────────────────────────────────────

export type ScheduleAction = "Wake" | "Shutdown" | "Reboot";

/** App : exécutée par l'app tant qu'elle tourne · Cron : installée dans le crontab du serveur */
export type ScheduleMode = "App" | "Cron";

export interface Schedule {
  /** Vide pour une nouvelle tâche (généré côté Rust) */
  id: string;
  name: string;
  enabled: boolean;
  action: ScheduleAction;
  mode: ScheduleMode;
  target: { kind: "Server" | "Group"; id: string };
  /** 0 = lundi … 6 = dimanche */
  days: number[];
  /** « HH:MM », heure locale */
  time: string;
  last_run: number | null;
}

export interface ScheduleSaveReport {
  schedule: Schedule;
  /** Serveurs dont le crontab n'a pas pu être mis à jour */
  cron_errors: string[];
}

export interface CronEntry {
  source: string;
  schedule: string;
  user: string | null;
  command: string;
  managed_id: string | null;
}

// ─── Docker ─────────────────────────────────────────────────────────────────

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  cpu_percent: number | null;
  mem_percent: number | null;
  mem_usage: string | null;
}

export interface DockerHost {
  available: boolean;
  containers: DockerContainer[];
}

// ─── Intégrations ───────────────────────────────────────────────────────────

export type IntegrationKind =
  | "Zabbix" | "Loki" | "Npm" | "TrueNas" | "HomeAssistant"
  | "OpnSense" | "MikroTik" | "Ntfy" | "Discord" | "Telegram" | "Pbs";

export interface IntegrationView {
  kind: IntegrationKind;
  enabled: boolean;
  url: string;
  username: string;
  /** Le secret n'est jamais renvoyé : seulement sa présence */
  has_secret: boolean;
  verify_tls: boolean;
  extra: Record<string, string>;
}

// ─── Alertes ────────────────────────────────────────────────────────────────

export type AlertCondition =
  | { type: "Offline"; minutes: number }
  | { type: "CpuAbove"; percent: number; minutes: number }
  | { type: "RamAbove"; percent: number; minutes: number }
  | { type: "DiskAbove"; percent: number }
  | { type: "TempAbove"; celsius: number; minutes: number }
  | { type: "ActionFailed" }
  | { type: "ProbeDown"; minutes: number };

export type AlertTarget = { kind: "All" } | { kind: "Server"; id: string } | { kind: "Group"; id: string };

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  condition: AlertCondition;
  target: AlertTarget;
  notify_desktop: boolean;
  notify_push: boolean;
  cooldown_minutes: number;
}

// ─── Sondes de services ─────────────────────────────────────────────────────

export type ProbeKind =
  | { type: "Http"; url: string; expect_status: number | null; keyword: string | null }
  | { type: "Tcp"; host: string; port: number }
  | { type: "TlsExpiry"; host: string; port: number; warn_days: number };

export interface Probe {
  id: string;
  name: string;
  enabled: boolean;
  kind: ProbeKind;
  server_id: string | null;
  interval_secs: number;
  verify_tls: boolean;
}

export interface ProbeResult {
  probe_id: string;
  ok: boolean;
  latency_ms: number | null;
  detail: string;
  checked_at: number;
  cert_days_left: number | null;
  uptime_percent: number;
}

// ─── Santé du cluster Proxmox ───────────────────────────────────────────────

export interface ClusterHealth {
  name: string;
  quorate: boolean;
  nodes: { name: string; online: boolean; cpu_percent: number; mem_percent: number; disk_percent: number; uptime_secs: number }[];
  storages: {
    name: string; plugin: string; shared: boolean; content: string;
    available_on: string[]; unavailable_on: string[];
    used_percent: number | null; total_bytes: number | null;
  }[];
  disks: { node: string; devpath: string; model: string; health: string; life_left_percent: number | null; size_bytes: number; kind: string }[];
  ha: string[];
  warnings: string[];
}

// ─── Sauvegardes Proxmox ────────────────────────────────────────────────────

export interface BackupReport {
  jobs: {
    id: string; enabled: boolean; schedule: string; schedule_text: string; storage: string;
    storage_available: boolean; next_run: number | null; all_guests: boolean; vmids: number[];
  }[];
  guests: { vmid: number; name: string; node: string; kind: string; covered: boolean; last_backup: number | null; last_backup_size: number | null }[];
  tasks: { node: string; vmid: string | null; start: number; end: number | null; status: string; ok: boolean }[];
  backup_storages: Record<string, string[]>;
  unreadable_storages: string[];
  warnings: string[];
}

// ─── Migration Proxmox ──────────────────────────────────────────────────────

export interface MigrationPlan {
  running: boolean;
  targets: { node: string; allowed: boolean; reasons: string[] }[];
  local_disks: string[];
  notes: string[];
}

// ─── Arrêt / démarrage ordonnés du lab ──────────────────────────────────────

export interface LabGuest { vmid: number; name: string; node: string; kind: string; running: boolean }

export type LabAction =
  | { type: "ShutdownServer"; server_id: string }
  | { type: "WakeServer"; server_id: string }
  | { type: "ShutdownGuests"; guests: LabGuest[] }
  | { type: "StartGuests"; guests: LabGuest[] };

export interface LabPlan {
  steps: { title: string; detail: string; actions: LabAction[] }[];
  warnings: string[];
}

export interface LabProgress { step: number; status: "running" | "done" | "error" | "cancelled"; message: string }
