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
