import type { Dict } from "..";

export const resources: Dict["resources"] = {
  title: "Resources",
  subtitle: "CPU, RAM and disks over SSH · refreshed every {seconds} s",
  disabled: "Monitoring disabled",
  disabledNotice: "Resource monitoring is disabled. Enable it in",
  settingsNetwork: "Settings → Network",
  noServers: "No servers configured.",
  sparkline: "History",
  card: {
    unsupported: "Monitoring not available for {os}",
    offline: "Server offline",
    collecting: "Collecting…",
    load: "load {values}",
    pool: "Pool {name}",
    systemDisk: "System disk",
    uptime: "up for {duration}",
    sensor: "{label}: {celsius} °C",
  },
};
