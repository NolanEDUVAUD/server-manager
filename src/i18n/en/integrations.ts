import type { Dict } from "..";

export const integrations: Dict["integrations"] = {
  title: "Integrations",
  intro: "External services used by the app. Secrets are encrypted with the master key (Windows Credential Manager).",
  categories: {
    notifications: "Notifications",
    supervision: "Monitoring",
    infrastructure: "Infrastructure",
  },
  status: {
    configured: "configured",
    disabled: "disabled",
    notConfigured: "not configured",
  },
  secretSaved: "Secret saved",
  keepEmpty: " (leave empty = unchanged)",
  enabled: "Enabled",
  tlsHint: "Uncheck for a self-signed certificate",
  verifyTls: "Verify TLS certificate",
  save: "Save",
  saveAndTest: "Save and test",
  password: "Password",
  zabbix: {
    url: "Zabbix URL",
    secret: "API token",
    secretPlaceholder: "Administration → API tokens → Create",
    help: "Zabbix ≥ 5.4. A user with write access to host groups, to create maintenance periods.",
  },
  loki: {
    url: "Loki URL",
    username: "User (optional)",
    usernamePlaceholder: "if Loki is behind authentication",
    secret: "Password (optional)",
    help: "Logs must be sent to Loki (Promtail / Alloy) with a host or hostname label.",
  },
  npm: {
    url: "Web interface URL",
    username: "Account email",
    help: "A dedicated read-only account is enough. NPM has no API token: the password is encrypted with the master key.",
  },
  truenas: {
    url: "TrueNAS URL",
    secret: "API key",
    secretPlaceholder: "User menu → API Keys → Add",
    help: "ZFS pools, datasets and SMART through the REST API — no SSH needed.",
  },
  pbs: {
    url: "PBS URL",
    username: "Token (user@realm!name)",
    secret: "Token secret",
    help: "Optional: only if you have a Proxmox Backup Server.",
  },
  homeAssistant: {
    url: "Home Assistant URL",
    secret: "Long-lived access token",
    secretPlaceholder: "Profile → Security → Long-lived access tokens",
    help: "Every homelab event is published to Home Assistant (type server_manager_event) for your automations.",
  },
  opnsense: {
    url: "OPNsense URL",
    username: "API key",
    usernamePlaceholder: "System → Access → Users → API keys",
    secret: "API secret",
    help: "Traffic and interface status.",
  },
  mikrotik: {
    url: "Router URL",
    username: "User",
    help: "RouterOS v7 with the REST API (www-ssl service enabled).",
  },
  ntfy: {
    url: "ntfy server",
    topic: "Topic",
    topicPlaceholder: "homelab-x7q2k9 (hard to guess)",
    secret: "Token (optional)",
    secretPlaceholder: "for a protected topic",
    help: "Install the ntfy app on your phone and subscribe to the same topic.",
  },
  discord: {
    secret: "Webhook URL",
    help: "Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.",
  },
  telegram: {
    secret: "Bot token",
    chatId: "Chat ID",
    help: "Create a bot with @BotFather, send it a message, then get your chat_id.",
  },
};
