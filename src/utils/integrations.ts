import { IntegrationKind } from "../types";

export interface FieldSpec {
  /** Libellé du champ URL (absent = pas d'URL pour ce service) */
  url?: { label: string; placeholder: string };
  username?: { label: string; placeholder: string };
  secret?: { label: string; placeholder: string };
  extra?: { key: string; label: string; placeholder: string }[];
  /** Case « vérifier le certificat TLS » pertinente (services en HTTPS auto-signé) */
  tls?: boolean;
  help: string;
}

export interface IntegrationSpec {
  kind: IntegrationKind;
  name: string;
  category: "Supervision" | "Infrastructure" | "Notifications";
  fields: FieldSpec;
}

/** Description de chaque intégration : champs à saisir et aide pour obtenir les identifiants */
export const INTEGRATIONS: IntegrationSpec[] = [
  {
    kind: "Zabbix", name: "Zabbix", category: "Supervision",
    fields: {
      url: { label: "URL de Zabbix", placeholder: "http://192.168.1.x/zabbix" },
      secret: { label: "Jeton API", placeholder: "Administration → Jetons API → Créer" },
      help: "Zabbix ≥ 5.4. Utilisateur avec droits d'écriture sur les groupes d'hôtes pour créer les maintenances.",
    },
  },
  {
    kind: "Loki", name: "Loki", category: "Supervision",
    fields: {
      url: { label: "URL de Loki", placeholder: "http://192.168.1.x:3100" },
      username: { label: "Utilisateur (optionnel)", placeholder: "si Loki est derrière une authentification" },
      secret: { label: "Mot de passe (optionnel)", placeholder: "" },
      help: "Les logs doivent être envoyés à Loki (Promtail / Alloy) avec un label host ou hostname.",
    },
  },
  {
    kind: "Npm", name: "Nginx Proxy Manager", category: "Infrastructure",
    fields: {
      url: { label: "URL de l'interface", placeholder: "http://192.168.1.x:81" },
      username: { label: "E-mail du compte", placeholder: "admin@example.com" },
      secret: { label: "Mot de passe", placeholder: "" },
      help: "Un compte dédié en lecture suffit. NPM n'a pas de jeton API : le mot de passe est chiffré avec la clé maître.",
    },
  },
  {
    kind: "TrueNas", name: "TrueNAS", category: "Infrastructure",
    fields: {
      url: { label: "URL de TrueNAS", placeholder: "https://192.168.1.x" },
      secret: { label: "Clé API", placeholder: "Menu utilisateur → API Keys → Add" },
      tls: true,
      help: "Pools ZFS, datasets et SMART via l'API REST — ne nécessite pas le SSH.",
    },
  },
  {
    kind: "Pbs", name: "Proxmox Backup Server", category: "Infrastructure",
    fields: {
      url: { label: "URL de PBS", placeholder: "https://192.168.1.x:8007" },
      username: { label: "Jeton (user@realm!nom)", placeholder: "root@pam!servermanager" },
      secret: { label: "Secret du jeton", placeholder: "" },
      tls: true,
      help: "Optionnel : seulement si tu as un Proxmox Backup Server.",
    },
  },
  {
    kind: "HomeAssistant", name: "Home Assistant", category: "Infrastructure",
    fields: {
      url: { label: "URL de Home Assistant", placeholder: "http://192.168.1.x:8123" },
      secret: { label: "Jeton d'accès longue durée", placeholder: "Profil → Sécurité → Jetons d'accès longue durée" },
      help: "Chaque événement du homelab est publié dans Home Assistant (type server_manager_event) pour tes automatisations.",
    },
  },
  {
    kind: "OpnSense", name: "OPNsense", category: "Infrastructure",
    fields: {
      url: { label: "URL d'OPNsense", placeholder: "https://192.168.1.1" },
      username: { label: "Clé API", placeholder: "Système → Accès → Utilisateurs → Clés API" },
      secret: { label: "Secret API", placeholder: "" },
      tls: true,
      help: "Trafic et état des interfaces.",
    },
  },
  {
    kind: "MikroTik", name: "MikroTik", category: "Infrastructure",
    fields: {
      url: { label: "URL du routeur", placeholder: "https://192.168.1.1" },
      username: { label: "Utilisateur", placeholder: "api-read" },
      secret: { label: "Mot de passe", placeholder: "" },
      tls: true,
      help: "RouterOS v7 avec l'API REST (service www-ssl activé).",
    },
  },
  {
    kind: "Ntfy", name: "ntfy", category: "Notifications",
    fields: {
      url: { label: "Serveur ntfy", placeholder: "https://ntfy.sh" },
      extra: [{ key: "topic", label: "Topic", placeholder: "homelab-x7q2k9 (difficile à deviner)" }],
      secret: { label: "Jeton (optionnel)", placeholder: "pour un topic protégé" },
      help: "Installe l'app ntfy sur ton téléphone et abonne-toi au même topic.",
    },
  },
  {
    kind: "Discord", name: "Discord", category: "Notifications",
    fields: {
      secret: { label: "URL du webhook", placeholder: "https://discord.com/api/webhooks/…" },
      help: "Paramètres du salon → Intégrations → Webhooks → Nouveau webhook → Copier l'URL.",
    },
  },
  {
    kind: "Telegram", name: "Telegram", category: "Notifications",
    fields: {
      secret: { label: "Jeton du bot", placeholder: "123456:ABC… (via @BotFather)" },
      extra: [{ key: "chat_id", label: "Chat ID", placeholder: "via @userinfobot" }],
      help: "Crée un bot avec @BotFather, envoie-lui un message, puis récupère ton chat_id.",
    },
  },
];
