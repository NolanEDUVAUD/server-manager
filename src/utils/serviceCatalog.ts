import { Probe, ProbeAuth } from "../types";

/**
 * Catalogue de services auto-hébergés courants : chaque entrée pré-remplit une sonde
 * HTTP générique (URL, authentification, valeur JSON à lire). Tout reste modifiable,
 * et n'importe quel autre service s'ajoute avec « Service personnalisé ».
 */
export interface ServicePreset {
  id: string;
  name: string;
  category: "Domotique" | "Médias" | "Réseau" | "Infrastructure" | "Supervision" | "Stockage" | "Applications";
  https: boolean;
  port: number;
  path: string;
  auth: ProbeAuth;
  keyword?: string;
  jsonPath?: string;
  jsonExpect?: string;
  /** Où trouver le jeton / quoi saisir comme secret */
  help: string;
}

const none: ProbeAuth = { type: "None" };

export const SERVICE_CATALOG: ServicePreset[] = [
  // Domotique
  { id: "home-assistant", name: "Home Assistant", category: "Domotique", https: false, port: 8123, path: "/api/", auth: { type: "Bearer" }, jsonPath: "message", jsonExpect: "API running.", help: "Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton." },
  // Médias
  { id: "jellyfin", name: "Jellyfin", category: "Médias", https: false, port: 8096, path: "/health", auth: none, keyword: "Healthy", help: "Aucun identifiant requis." },
  { id: "plex", name: "Plex", category: "Médias", https: false, port: 32400, path: "/identity", auth: none, keyword: "MediaContainer", help: "Aucun identifiant requis." },
  { id: "immich", name: "Immich", category: "Médias", https: false, port: 2283, path: "/api/server/ping", auth: none, jsonPath: "res", jsonExpect: "pong", help: "Aucun identifiant requis." },
  { id: "sonarr", name: "Sonarr", category: "Médias", https: false, port: 8989, path: "/api/v3/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "Settings → General → API Key." },
  { id: "radarr", name: "Radarr", category: "Médias", https: false, port: 7878, path: "/api/v3/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "Settings → General → API Key." },
  { id: "prowlarr", name: "Prowlarr", category: "Médias", https: false, port: 9696, path: "/api/v1/system/status", auth: { type: "Header", name: "X-Api-Key" }, jsonPath: "version", help: "Settings → General → API Key." },
  // Réseau
  { id: "pihole", name: "Pi-hole", category: "Réseau", https: false, port: 80, path: "/admin/", auth: none, keyword: "Pi-hole", help: "Aucun identifiant requis (vérifie que l'interface répond)." },
  { id: "adguard", name: "AdGuard Home", category: "Réseau", https: false, port: 80, path: "/control/status", auth: { type: "Basic", username: "admin" }, jsonPath: "running", jsonExpect: "true", help: "Identifiant et mot de passe de l'interface AdGuard." },
  { id: "npm", name: "Nginx Proxy Manager", category: "Réseau", https: false, port: 81, path: "/api/", auth: none, jsonPath: "status", jsonExpect: "OK", help: "Aucun identifiant requis." },
  { id: "traefik", name: "Traefik", category: "Réseau", https: false, port: 8080, path: "/ping", auth: none, keyword: "OK", help: "Nécessite ping activé (--ping=true)." },
  { id: "opnsense", name: "OPNsense", category: "Réseau", https: true, port: 443, path: "/api/core/firmware/status", auth: { type: "Basic", username: "" }, help: "System → Access → Users → API keys : la clé en identifiant, le secret en mot de passe." },
  { id: "pfsense", name: "pfSense", category: "Réseau", https: true, port: 443, path: "/", auth: none, keyword: "pfSense", help: "Vérifie que l'interface web répond." },
  // Infrastructure
  { id: "proxmox-ve", name: "Proxmox VE", category: "Infrastructure", https: true, port: 8006, path: "/api2/json/version", auth: { type: "Header", name: "Authorization" }, jsonPath: "data.version", help: "Datacenter → Permissions → API Tokens. Secret : PVEAPIToken=utilisateur@pam!nom=uuid-du-jeton" },
  { id: "pbs", name: "Proxmox Backup Server", category: "Infrastructure", https: true, port: 8007, path: "/api2/json/version", auth: { type: "Header", name: "Authorization" }, jsonPath: "data.version", help: "Configuration → Access Control → API Token. Secret : PBSAPIToken=utilisateur@pbs!nom:uuid-du-jeton" },
  { id: "portainer", name: "Portainer", category: "Infrastructure", https: true, port: 9443, path: "/api/system/status", auth: none, jsonPath: "Version", help: "Aucun identifiant requis." },
  { id: "truenas", name: "TrueNAS", category: "Stockage", https: true, port: 443, path: "/api/v2.0/system/info", auth: { type: "Bearer" }, jsonPath: "version", help: "Menu utilisateur → API Keys → Add." },
  { id: "synology", name: "Synology DSM", category: "Stockage", https: true, port: 5001, path: "/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth", auth: none, jsonPath: "success", jsonExpect: "true", help: "Aucun identifiant requis." },
  { id: "minio", name: "MinIO", category: "Stockage", https: false, port: 9000, path: "/minio/health/live", auth: none, help: "Aucun identifiant requis." },
  { id: "unraid", name: "Unraid", category: "Stockage", https: false, port: 80, path: "/login", auth: none, keyword: "Unraid", help: "Vérifie que l'interface web répond." },
  // Supervision
  { id: "grafana", name: "Grafana", category: "Supervision", https: false, port: 3000, path: "/api/health", auth: none, jsonPath: "database", jsonExpect: "ok", help: "Aucun identifiant requis." },
  { id: "prometheus", name: "Prometheus", category: "Supervision", https: false, port: 9090, path: "/-/healthy", auth: none, keyword: "Healthy", help: "Aucun identifiant requis." },
  { id: "loki", name: "Grafana Loki", category: "Supervision", https: false, port: 3100, path: "/ready", auth: none, keyword: "ready", help: "Aucun identifiant requis." },
  { id: "influxdb", name: "InfluxDB", category: "Supervision", https: false, port: 8086, path: "/health", auth: none, jsonPath: "status", jsonExpect: "pass", help: "Aucun identifiant requis." },
  { id: "uptime-kuma", name: "Uptime Kuma", category: "Supervision", https: false, port: 3001, path: "/", auth: none, help: "Vérifie que l'interface web répond." },
  { id: "zabbix", name: "Zabbix", category: "Supervision", https: false, port: 80, path: "/zabbix/", auth: none, keyword: "Zabbix", help: "Vérifie que l'interface web répond." },
  // Applications
  { id: "nextcloud", name: "Nextcloud", category: "Applications", https: true, port: 443, path: "/status.php", auth: none, jsonPath: "maintenance", jsonExpect: "false", help: "Aucun identifiant requis ; passe en erreur si le mode maintenance est actif." },
  { id: "vaultwarden", name: "Vaultwarden", category: "Applications", https: true, port: 443, path: "/alive", auth: none, help: "Aucun identifiant requis." },
  { id: "gitea", name: "Gitea / Forgejo", category: "Applications", https: false, port: 3000, path: "/api/healthz", auth: none, jsonPath: "status", jsonExpect: "pass", help: "Aucun identifiant requis." },
  { id: "paperless", name: "Paperless-ngx", category: "Applications", https: false, port: 8000, path: "/api/", auth: { type: "Header", name: "Authorization" }, help: "Profil → jeton d'API. Secret : Token suivi du jeton (ex. Token 0123abcd…)." },
];

/** Sonde prête à compléter à partir d'un modèle du catalogue et de l'adresse du service */
export function probeFromPreset(p: ServicePreset, host: string, serverId: string | null): Probe {
  const scheme = p.https ? "https" : "http";
  const defaultPort = p.https ? 443 : 80;
  const h = host.trim() || "adresse";
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
