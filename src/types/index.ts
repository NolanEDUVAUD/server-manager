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

export type EventKind = "Offline" | "Online" | "Wake" | "Shutdown" | "Reboot" | "VmAction" | "Container" | "Failure";

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
