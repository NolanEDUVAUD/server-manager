import type { Dict } from "..";

export const logs: Dict["logs"] = {
  title: "Logs",
  subtitle: "systemd journals centralized in Loki",
  configureBefore: "Set up Loki in",
  configureLink: "Settings → Integrations",
  levels: {
    errors: "Errors",
    warnings: "Warnings +",
    info: "Info +",
    all: "All",
  },
  host: "Host",
  notInApp: "not in app",
  level: "Level",
  range: "Period",
  unit: "Unit",
  allUnits: "All units",
  searchPlaceholder: "Search…",
  searchLabel: "Search text",
  live: "Live",
  aroundOutage: "Around the last outage",
  aroundOutageHint: "10 min before → 5 min after the last outage",
  window: "Window: {start} → {end}",
  backToLive: "back to live",
  empty: "No entries for these criteria.",
};
