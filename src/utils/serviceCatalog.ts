import { Probe, ProbeAuth } from "../types";
import { t, TKey } from "../i18n";

export type ServiceCategory = "home" | "media" | "network" | "infrastructure" | "monitoring" | "storage" | "apps";

/** Libellé traduit de chaque catégorie (résolu à l'affichage avec t()) */
export const CATEGORY_LABELS: Record<ServiceCategory, TKey> = {
  home: "catalog.categories.home",
  media: "catalog.categories.media",
  network: "catalog.categories.network",
  infrastructure: "catalog.categories.infrastructure",
  monitoring: "catalog.categories.monitoring",
  storage: "catalog.categories.storage",
  apps: "catalog.categories.apps",
};

/**
 * Catalogue de services auto-hébergés courants : chaque entrée pré-remplit une sonde
 * HTTP générique (URL, authentification, valeur JSON à lire). Tout reste modifiable,
 * et n'importe quel autre service s'ajoute avec « Service personnalisé ».
 */
export interface ServicePreset {
  id: string;
  name: string;
  category: ServiceCategory;
  https: boolean;
  port: number;
  path: string;
  auth: ProbeAuth;
  keyword?: string;
  jsonPath?: string;
  jsonExpect?: string;
  /** Où trouver le jeton / quoi saisir comme secret (clé de traduction, résolue à l'affichage) */
  help: TKey;
}

const none: ProbeAuth = { type: "None" };

export const SERVICE_CATALOG: ServicePreset[] = [
  // Domotique
  { id: "home-assistant", name: "Home Assistant", category: "home", https: false, port: 8123, path: "/api/", auth: { type: "Bearer" }, jsonPath: "message", jsonExpect: "API running.", help: "catalog.help.homeAssistant" },
  // Médias
  { id: "jellyfin", name: "Jellyfin", category: "media", https: false, port: 8096, path: "/health", auth: none, keyword: "Healthy", help: "catalog.help.noAuth" },
  { id: "plex", name: "Plex", category: "media", https: false, port: 32400, path: "/identity", auth: none, keyword: "MediaContainer", help: "catalog.help.noAuth" },
  { id: "immich", name: "Immich", category: "media", https: false, port: 2283, path: "/api/server/ping", auth: none, jsonPath: "res", jsonExpect: "pong", help: "catalog.help.noAuth" },
  { id: "sonarr", name: "Sonarr", category: "media", https: false, port: 8989, path: "/api/v3/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "catalog.help.arrApiKey" },
  { id: "radarr", name: "Radarr", category: "media", https: false, port: 7878, path: "/api/v3/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "catalog.help.arrApiKey" },
  { id: "prowlarr", name: "Prowlarr", category: "media", https: false, port: 9696, path: "/api/v1/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "catalog.help.arrApiKey" },
  // Réseau
  { id: "pihole", name: "Pi-hole", category: "network", https: false, port: 80, path: "/admin/", auth: none, keyword: "Pi-hole", help: "catalog.help.pihole" },
  { id: "adguard", name: "AdGuard Home", category: "network", https: false, port: 80, path: "/control/status", auth: { type: "Basic", username: "admin" }, jsonPath: "running", jsonExpect: "true", help: "catalog.help.adguard" },
  { id: "npm", name: "Nginx Proxy Manager", category: "network", https: false, port: 81, path: "/api/", auth: none, jsonPath: "status", jsonExpect: "OK", help: "catalog.help.noAuth" },
  { id: "traefik", name: "Traefik", category: "network", https: false, port: 8080, path: "/ping", auth: none, keyword: "OK", help: "catalog.help.traefik" },
  { id: "opnsense", name: "OPNsense", category: "network", https: true, port: 443, path: "/api/core/firmware/status", auth: { type: "Basic", username: "" }, help: "catalog.help.opnsense" },
  { id: "pfsense", name: "pfSense", category: "network", https: true, port: 443, path: "/", auth: none, keyword: "pfSense", help: "catalog.help.webUi" },
  // Infrastructure
  { id: "proxmox-ve", name: "Proxmox VE", category: "infrastructure", https: true, port: 8006, path: "/api2/json/version", auth: { type: "Header", name: "Authorization" }, jsonPath: "data.version", help: "catalog.help.proxmoxVe" },
  { id: "pbs", name: "Proxmox Backup Server", category: "infrastructure", https: true, port: 8007, path: "/api2/json/version", auth: { type: "Header", name: "Authorization" }, jsonPath: "data.version", help: "catalog.help.pbs" },
  { id: "portainer", name: "Portainer", category: "infrastructure", https: true, port: 9443, path: "/api/system/status", auth: none, jsonPath: "Version", help: "catalog.help.noAuth" },
  { id: "truenas", name: "TrueNAS", category: "storage", https: true, port: 443, path: "/api/v2.0/system/info", auth: { type: "Bearer" }, jsonPath: "version", help: "catalog.help.truenas" },
  { id: "synology", name: "Synology DSM", category: "storage", https: true, port: 5001, path: "/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth", auth: none, jsonPath: "success", jsonExpect: "true", help: "catalog.help.noAuth" },
  { id: "minio", name: "MinIO", category: "storage", https: false, port: 9000, path: "/minio/health/live", auth: none, help: "catalog.help.noAuth" },
  { id: "unraid", name: "Unraid", category: "storage", https: false, port: 80, path: "/login", auth: none, keyword: "Unraid", help: "catalog.help.webUi" },
  // Supervision
  { id: "grafana", name: "Grafana", category: "monitoring", https: false, port: 3000, path: "/api/health", auth: none, jsonPath: "database", jsonExpect: "ok", help: "catalog.help.noAuth" },
  { id: "prometheus", name: "Prometheus", category: "monitoring", https: false, port: 9090, path: "/-/healthy", auth: none, keyword: "Healthy", help: "catalog.help.noAuth" },
  { id: "loki", name: "Grafana Loki", category: "monitoring", https: false, port: 3100, path: "/ready", auth: none, keyword: "ready", help: "catalog.help.noAuth" },
  { id: "influxdb", name: "InfluxDB", category: "monitoring", https: false, port: 8086, path: "/health", auth: none, jsonPath: "status", jsonExpect: "pass", help: "catalog.help.noAuth" },
  { id: "uptime-kuma", name: "Uptime Kuma", category: "monitoring", https: false, port: 3001, path: "/", auth: none, help: "catalog.help.webUi" },
  { id: "zabbix", name: "Zabbix", category: "monitoring", https: false, port: 80, path: "/zabbix/", auth: none, keyword: "Zabbix", help: "catalog.help.webUi" },
  // Applications
  { id: "nextcloud", name: "Nextcloud", category: "apps", https: true, port: 443, path: "/status.php", auth: none, jsonPath: "maintenance", jsonExpect: "false", help: "catalog.help.nextcloud" },
  { id: "vaultwarden", name: "Vaultwarden", category: "apps", https: true, port: 443, path: "/alive", auth: none, help: "catalog.help.noAuth" },
  { id: "gitea", name: "Gitea / Forgejo", category: "apps", https: false, port: 3000, path: "/api/healthz", auth: none, jsonPath: "status", jsonExpect: "pass", help: "catalog.help.noAuth" },
  { id: "paperless", name: "Paperless-ngx", category: "apps", https: false, port: 8000, path: "/api/", auth: { type: "Header", name: "Authorization" }, help: "catalog.help.paperless" },
];

/** Sonde prête à compléter à partir d'un modèle du catalogue et de l'adresse du service */
export function probeFromPreset(p: ServicePreset, host: string, serverId: string | null): Probe {
  const scheme = p.https ? "https" : "http";
  const defaultPort = p.https ? 443 : 80;
  const h = host.trim() || t("catalog.hostPlaceholder");
  const url = `${scheme}://${h}${p.port === defaultPort ? "" : `:${p.port}`}${p.path}`;
  return {
    id: "",
    name: p.name,
    enabled: true,
    server_id: serverId,
    interval_secs: 60,
    // Avec des identifiants, le certificat est vérifié : sinon un intermédiaire pourrait
    // intercepter le jeton. Sans identifiants, on tolère les certificats auto-signés.
    verify_tls: p.auth.type !== "None",
    auth: p.auth,
    kind: { type: "Http", url, expect_status: null, keyword: p.keyword ?? null, json_path: p.jsonPath ?? null, json_expect: p.jsonExpect ?? null },
  };
}
