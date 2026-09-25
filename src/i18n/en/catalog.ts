import type { Dict } from "..";

export const catalog: Dict["catalog"] = {
  categories: {
    home: "Home automation",
    media: "Media",
    network: "Network",
    infrastructure: "Infrastructure",
    monitoring: "Monitoring",
    storage: "Storage",
    apps: "Applications",
  },
  hostPlaceholder: "address",
  help: {
    noAuth: "No credentials required.",
    webUi: "Checks that the web interface responds.",
    homeAssistant: "Profile → Security → Long-lived access tokens → Create token.",
    arrApiKey: "Settings → General → API Key.",
    pihole: "No credentials required (checks that the interface responds).",
    adguard: "Username and password of the AdGuard interface.",
    traefik: "Requires ping to be enabled (--ping=true).",
    opnsense: "System → Access → Users → API keys: the key as username, the secret as password.",
    proxmoxVe: "Datacenter → Permissions → API Tokens. Secret: PVEAPIToken=user@pam!name=token-uuid",
    pbs: "Configuration → Access Control → API Token. Secret: PBSAPIToken=user@pbs!name:token-uuid",
    truenas: "User menu → API Keys → Add.",
    nextcloud: "No credentials required; fails if maintenance mode is on.",
    paperless: "Profile → API token. Secret: Token followed by the token (e.g. Token 0123abcd…).",
    custom: "Custom service: any URL, with authentication and reading a JSON value if needed.",
  },
};
