import type { Dict } from "..";

export const modules: Dict["modules"] = {
  power: { label: "Shutdown / startup", description: "Power the whole lab off or on in the right order" },
  resources: { label: "Resources", description: "Real-time CPU, RAM and disks of your servers" },
  services: {
    label: "Services",
    description: "Monitor any web service (Home Assistant, Jellyfin, Pi-hole… catalog)",
  },
  console: { label: "SSH console", description: "Built-in SSH terminal with tabs" },
  history: { label: "History", description: "Log of outages, restarts and actions" },
  alerts: { label: "Alerts", description: "ntfy, Discord, Telegram… notifications" },
  network: { label: "Network", description: "Local network devices and MAC addresses" },
  docker: { label: "Docker", description: "Containers and images on Docker hosts" },
  batch: { label: "Batch tasks", description: "One script on several servers, Ansible playbooks" },
  updates: { label: "Updates", description: "Pending apt packages and outdated containers" },
  logs: { label: "Logs", description: "Logs centralized in Grafana Loki" },
  scheduler: { label: "Scheduler", description: "Scheduled tasks and cron jobs on your servers" },
  proxmox: { label: "Proxmox", description: "Proxmox VE cluster: VMs, containers, backups, migration" },
  web: { label: "Web tabs", description: "Web interfaces of your services inside the app" },
};
