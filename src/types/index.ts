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
  // ── Organisation ──────────────────────────────────────────────────────────
  /** Identifiants de tags (voir `Tag`) */
  tag_ids?: string[];
  /** Dossier d'affichage (un seul), distinct des groupes */
  folder_id?: string | null;
  favorite?: boolean;
  /** Informations libres, non chiffrées : jamais de secret */
  custom_fields?: CustomField[];
  // ── Authentification SSH par clé (1.2) ──
  /** Absente d'un ancien serveur = mot de passe */
  auth_method?: AuthMethod;
  ssh_key_id?: string | null;
  /** Serveur de la liste servant d'hôte de rebond */
  jump_host_id?: string | null;
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
  // ── Organisation : absent = inchangé lors d'une modification ─────────────
  tag_ids?: string[];
  /** "" = sans dossier */
  folder_id?: string;
  favorite?: boolean;
  custom_fields?: CustomField[];
  // ── Authentification SSH par clé (1.2) ──
  /** Absente = méthode, clé et rebond inchangés côté Rust */
  auth_method?: AuthMethod;
  ssh_key_id?: string | null;
  jump_host_id?: string | null;
  /** Efface le mot de passe enregistré (méthode clé) */
  clear_password?: boolean;
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
  /** Modules masqués de la barre latérale */
  hidden_modules: string[];
  /** Écran d'accueil déjà passé */
  onboarding_done: boolean;
  // ── Mise à jour automatique de l'application (1.5) ──
  /** Rechercher une nouvelle version au démarrage */
  check_updates: boolean;
  /** Langue de l'interface */
  language: "fr" | "en";
  /** Interrupteur global des alertes (Alertes → en haut de page) : quand désactivé, plus
   * aucune règle ne se déclenche, quel que soit son état individuel. */
  alerts_enabled: boolean;
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

/** Rétention de la base d'historique (history.db), en jours */
export interface HistorySettings {
  raw_days: number;
  hourly_days: number;
  event_days: number;
}

export interface AppSettings {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  network: NetworkSettings;
  history: HistorySettings;
}

// ─── Import/Export ───────────────────────────────────────────────────────────

export interface ImportSummary {
  servers_count: number;
  groups_count: number;
  settings_present: boolean;
  config_version: string;
  exported_at: string | null;
  // ── Organisation ──
  tags_count?: number;
  folders_count?: number;
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

/** Disponibilité d'un serveur d'après l'historique des pings */
export interface ServerUptime {
  server_id: string;
  checks: number;
  online: number;
  uptime_percent: number;
  avg_latency_ms: number | null;
}

/** État de la base d'historique locale */
export interface HistoryInfo {
  path: string | null;
  persistent: boolean;
  size_bytes: number;
  schema_version: number;
  events: number;
  ping_samples: number;
  probe_samples: number;
  metric_samples: number;
  hourly_rows: number;
  oldest_ts: number | null;
  warning: string | null;
}

export interface PruneReport {
  raw_rows: number;
  hourly_rows: number;
  events: number;
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
  | { type: "Http"; url: string; expect_status: number | null; keyword: string | null; json_path?: string | null; json_expect?: string | null }
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
  auth: ProbeAuth;
  /** Un secret chiffré est enregistré (sa valeur n'est jamais renvoyée) */
  has_secret?: boolean;
  // ── Organisation ──────────────────────────────────────────────────────────
  tag_ids?: string[];
  folder_id?: string | null;
  favorite?: boolean;
}

/** Authentification HTTP d'une sonde ; le secret est saisi à part et chiffré côté Rust */
export type ProbeAuth =
  | { type: "None" }
  | { type: "Basic"; username: string }
  | { type: "Bearer" }
  | { type: "Header"; name: string };

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

// ─── Découverte réseau ──────────────────────────────────────────────────────

/** Type d'appareil deviné (fabricant OUI + nom) — voir `discovery::guess_device_kind` côté Rust */
export type DeviceKind = "router" | "switch" | "access_point" | "server" | "nas" | "phone" | "tv" | "printer" | "iot" | "unknown";

export interface NetworkDevice {
  ip: string;
  mac: string | null;
  /** Carte réseau virtuelle (VM, conteneur) : WoL inutile */
  virtual_nic: string | null;
  known_server: string | null;
  /** Fabricant deviné à partir de l'OUI de la MAC (absent d'un ancien scan mis en cache) */
  vendor?: string | null;
  device_kind?: DeviceKind | null;
}

// ─── Routage, Wi-Fi, traceroute (topologie du graphe réseau) ────────────────

export interface RouteEntry {
  destination: string;
  mask: string | null;
  gateway: string | null;
  interface: string | null;
  metric: number | null;
}

export interface WlanInfo {
  ssid: string | null;
  bssid: string | null;
  signal_percent: number | null;
  channel: number | null;
  band: string | null;
}

export interface TracerouteHop {
  hop: number;
  ip: string | null;
  rtt_ms: number | null;
}

// ─── Commandes mémorisées ───────────────────────────────────────────────────

export interface Snippet { id: string; name: string; command: string }

// ─── Tâches en lot / Ansible ────────────────────────────────────────────────

export type BatchMode = "Parallel" | "Sequential";

export interface BatchTask { id: string; name: string; script: string; server_ids: string[]; mode: BatchMode; stop_on_error: boolean }

export interface AnsibleConfig { server_id: string; dir: string }

export type BatchUpdate =
  | { type: "Started"; run_id: string; server_id: string }
  | { type: "Output"; run_id: string; server_id: string; chunk: string }
  | { type: "Finished"; run_id: string; server_id: string; ok: boolean; detail: string; duration_ms: number }
  | { type: "Skipped"; run_id: string; server_id: string; reason: string }
  | { type: "Done"; run_id: string; ok_count: number; failed_count: number };

// ─── Lot intelligent (F2) : détection de l'OS et actions portables ─────────

/** Action de haut niveau, résolue par le backend selon l'OS détecté de chaque cible */
export type SmartAction =
  | { type: "UpdatePackages" }
  | { type: "UpgradeSystem" }
  | { type: "InstallPackage"; name: string }
  | { type: "RestartService"; name: string }
  | { type: "CleanPackageCache" }
  | { type: "RebootIfRequired" };

export type SmartSource = { type: "Action"; value: SmartAction } | { type: "Script"; value: string };

export interface TargetOsView { server_id: string; name: string; label: string | null; error: string | null }

export interface SmartPreview { server_id: string; name: string; os_label: string | null; command: string | null; skip_reason: string | null }

// ─── Centre de mises à jour ─────────────────────────────────────────────────

export interface UpdateReport {
  apt_available: boolean;
  packages: { name: string; new_version: string; old_version: string; security: boolean }[];
  security_count: number;
  reboot_required: boolean;
  kernel: string;
  lists_age_days: number | null;
  stale_containers: { name: string; image: string }[];
}

export interface ServerUpdates { server_id: string; name: string; report: UpdateReport | null; error: string | null }

// ─── Logs Loki ──────────────────────────────────────────────────────────────

export interface LogEntry { ts: number; line: string; unit: string; priority: number | null }

// ─── Organisation : tags, dossiers, champs personnalisés ────────────────────

export interface Tag {
  /** Vide à la création (généré côté Rust) */
  id: string;
  name: string;
  /** « #rrggbb » */
  color: string;
}

export interface Folder {
  /** Vide à la création (généré côté Rust) */
  id: string;
  name: string;
}

/** Information libre d'un serveur (emplacement, numéro de série…). Non chiffrée. */
export interface CustomField {
  key: string;
  value: string;
}

/** Élément organisable : serveur ou service (sonde) */
export type ItemKind = "server" | "probe";

// ─── Mise à jour automatique de l'application (1.5) ─────────────────────────

/** Réponse de `app_update_info` (sans accès réseau) */
export interface AppUpdateInfo {
  /** Clé publique de signature embarquée : sinon les mises à jour sont désactivées */
  configured: boolean;
  current_version: string;
}

/** Réponse de `app_update_check` */
export interface AppUpdateCheck {
  configured: boolean;
  available: boolean;
  version: string | null;
  current_version: string;
  /** Date de publication (RFC 3339) */
  date: string | null;
  /** Notes nettoyées et tronquées côté Rust, à afficher en texte uniquement */
  notes: string | null;
}

/** Réponse de `check_github_release` (F1) : indépendante de l'updater signé, fonctionne
 *  même sans clé publique embarquée. */
export interface GithubUpdateCheck {
  current_version: string;
  available: boolean;
  latest_version: string;
  name: string;
  notes: string | null;
  html_url: string;
  /** Date de publication (RFC 3339 ou format GitHub), telle que renvoyée par l'API */
  published_at: string | null;
}

export type AppUpdatePhase = "downloading" | "verifying" | "installing";

/** Événement `app-update-progress` */
export interface AppUpdateProgress {
  phase: AppUpdatePhase;
  downloaded: number;
  total: number | null;
}

// ─── Verrouillage de l'application (1.3) ────────────────────────────────────

/** Windows Hello s'utilise toujours avec un PIN de secours */
export type LockMethod = "None" | "Pin" | "Hello";

/** Vue du verrouillage renvoyée par le backend : jamais de hash ni de secret */
export interface LockStatus {
  /** Au moins un moyen de déverrouiller : le verrouillage est actif */
  enabled: boolean;
  locked: boolean;
  method: LockMethod;
  has_pin: boolean;
  master_password: boolean;
  /** 0 = jamais */
  idle_minutes: number;
  lock_on_session_lock: boolean;
  hello_available: boolean;
  /** Détection du verrouillage de la session Windows (Windows uniquement) */
  session_detection: boolean;
  /** Attente imposée avant le prochain essai (ms) */
  retry_after_ms: number;
}

export interface LockConfigPayload {
  method: LockMethod;
  idle_minutes: number;
  lock_on_session_lock: boolean;
}

// ─── Sauvegarde chiffrée (.spmbackup, 1.4) ──────────────────────────────────

/** Aperçu d'une sauvegarde déchiffrée, avant restauration */
export interface BackupSummary {
  app_version: string;
  created_at: string;
  servers: number;
  groups: number;
  probes: number;
  proxmox_connections: number;
  integrations: number;
  schedules: number;
}

export type BackupFrequency = "Daily" | "Weekly";

/** Réglages de la sauvegarde automatique (la phrase de passe n'est jamais renvoyée) */
export interface BackupConfig {
  enabled: boolean;
  folder: string;
  frequency: BackupFrequency;
  keep: number;
  last_run: number | null;
  last_error: string | null;
}

export interface BackupConfigView extends BackupConfig {
  has_passphrase: boolean;
}

// ─── Authentification SSH par clé (1.2) ─────────────────────────────────────

export type AuthMethod = "Password" | "Key";

/** Clé SSH de l'app : la clé privée n'est jamais envoyée au frontend */
export interface SshKeyView {
  id: string;
  name: string;
  algorithm: string;
  /** Ligne authorized_keys : « ssh-ed25519 AAAA… commentaire » */
  public_key: string;
  /** « SHA256:… » */
  fingerprint: string;
  /** Millisecondes */
  created_at: number;
  has_private_key: boolean;
}

/** Fichier de clé choisi, décrit avant son import (sans phrase de passe) */
export interface KeyFileInfo {
  file_name: string;
  format: string;
  encrypted: boolean;
  algorithm: string | null;
  comment: string | null;
}

export interface DeployReport {
  /** false : la clé était déjà dans authorized_keys */
  added: boolean;
  /** Une connexion par clé a réussi juste après */
  verified: boolean;
  detail: string | null;
}
