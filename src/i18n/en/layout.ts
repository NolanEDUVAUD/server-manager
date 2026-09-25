import type { Dict } from "..";

export const layout: Dict["layout"] = {
  nav: {
    dashboard: "Dashboard",
    servers: "Servers",
    groups: "Groups",
    power: "Shutdown / startup",
    resources: "Resources",
    services: "Services",
    network: "Network",
    docker: "Docker",
    console: "Console",
    batch: "Batch tasks",
    updates: "Updates",
    history: "History",
    logs: "Logs",
    alerts: "Alerts",
    scheduler: "Scheduler",
    proxmox: "Proxmox",
    backups: "Backups",
    web: "Web tabs",
    settings: "Settings",
  },
  lock: "Lock",
  lockNowTitle: "Lock now ({combo})",
  onlineTitle: "{online}/{total} online",
  onlineSuffix: "/{total} online",
};
