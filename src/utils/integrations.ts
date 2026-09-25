import { IntegrationKind } from "../types";
import type { TKey } from "../i18n";

/**
 * Champ d'une intégration : libellé traduit (clé), et exemple affiché dans le champ,
 * soit une valeur technique telle quelle (`placeholder`), soit un texte traduit (`placeholderKey`).
 * Les clés sont résolues à l'affichage, jamais ici.
 */
export interface FieldText {
  label: TKey;
  placeholder: string;
  placeholderKey?: TKey;
}

export interface FieldSpec {
  /** Libellé du champ URL (absent = pas d'URL pour ce service) */
  url?: FieldText;
  username?: FieldText;
  secret?: FieldText;
  extra?: ({ key: string } & FieldText)[];
  /** Case « vérifier le certificat TLS » pertinente (services en HTTPS auto-signé) */
  tls?: boolean;
  help: TKey;
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
      url: { label: "integrations.zabbix.url", placeholder: "http://192.168.1.x/zabbix" },
      secret: { label: "integrations.zabbix.secret", placeholder: "", placeholderKey: "integrations.zabbix.secretPlaceholder" },
      help: "integrations.zabbix.help",
    },
  },
  {
    kind: "Loki", name: "Loki", category: "Supervision",
    fields: {
      url: { label: "integrations.loki.url", placeholder: "http://192.168.1.x:3100" },
      username: { label: "integrations.loki.username", placeholder: "", placeholderKey: "integrations.loki.usernamePlaceholder" },
      secret: { label: "integrations.loki.secret", placeholder: "" },
      help: "integrations.loki.help",
    },
  },
  {
    kind: "Npm", name: "Nginx Proxy Manager", category: "Infrastructure",
    fields: {
      url: { label: "integrations.npm.url", placeholder: "http://192.168.1.x:81" },
      username: { label: "integrations.npm.username", placeholder: "admin@example.com" },
      secret: { label: "integrations.password", placeholder: "" },
      help: "integrations.npm.help",
    },
  },
  {
    kind: "TrueNas", name: "TrueNAS", category: "Infrastructure",
    fields: {
      url: { label: "integrations.truenas.url", placeholder: "https://192.168.1.x" },
      secret: { label: "integrations.truenas.secret", placeholder: "", placeholderKey: "integrations.truenas.secretPlaceholder" },
      tls: true,
      help: "integrations.truenas.help",
    },
  },
  {
    kind: "Pbs", name: "Proxmox Backup Server", category: "Infrastructure",
    fields: {
      url: { label: "integrations.pbs.url", placeholder: "https://192.168.1.x:8007" },
      username: { label: "integrations.pbs.username", placeholder: "root@pam!servermanager" },
      secret: { label: "integrations.pbs.secret", placeholder: "" },
      tls: true,
      help: "integrations.pbs.help",
    },
  },
  {
    kind: "HomeAssistant", name: "Home Assistant", category: "Infrastructure",
    fields: {
      url: { label: "integrations.homeAssistant.url", placeholder: "http://192.168.1.x:8123" },
      secret: { label: "integrations.homeAssistant.secret", placeholder: "", placeholderKey: "integrations.homeAssistant.secretPlaceholder" },
      help: "integrations.homeAssistant.help",
    },
  },
  {
    kind: "OpnSense", name: "OPNsense", category: "Infrastructure",
    fields: {
      url: { label: "integrations.opnsense.url", placeholder: "https://192.168.1.1" },
      username: { label: "integrations.opnsense.username", placeholder: "", placeholderKey: "integrations.opnsense.usernamePlaceholder" },
      secret: { label: "integrations.opnsense.secret", placeholder: "" },
      tls: true,
      help: "integrations.opnsense.help",
    },
  },
  {
    kind: "MikroTik", name: "MikroTik", category: "Infrastructure",
    fields: {
      url: { label: "integrations.mikrotik.url", placeholder: "https://192.168.1.1" },
      username: { label: "integrations.mikrotik.username", placeholder: "api-read" },
      secret: { label: "integrations.password", placeholder: "" },
      tls: true,
      help: "integrations.mikrotik.help",
    },
  },
  {
    kind: "Ntfy", name: "ntfy", category: "Notifications",
    fields: {
      url: { label: "integrations.ntfy.url", placeholder: "https://ntfy.sh" },
      extra: [{ key: "topic", label: "integrations.ntfy.topic", placeholder: "", placeholderKey: "integrations.ntfy.topicPlaceholder" }],
      secret: { label: "integrations.ntfy.secret", placeholder: "", placeholderKey: "integrations.ntfy.secretPlaceholder" },
      help: "integrations.ntfy.help",
    },
  },
  {
    kind: "Discord", name: "Discord", category: "Notifications",
    fields: {
      secret: { label: "integrations.discord.secret", placeholder: "https://discord.com/api/webhooks/…" },
      help: "integrations.discord.help",
    },
  },
  {
    kind: "Telegram", name: "Telegram", category: "Notifications",
    fields: {
      secret: { label: "integrations.telegram.secret", placeholder: "123456:ABC… (via @BotFather)" },
      extra: [{ key: "chat_id", label: "integrations.telegram.chatId", placeholder: "via @userinfobot" }],
      help: "integrations.telegram.help",
    },
  },
];
