import type { Dict } from "..";

export const dashboard: Dict["dashboard"] = {
  title: "Dashboard",
  noServers: "No servers configured",
  onlineSummary: { one: "{online} / {count} server online", other: "{online} / {count} servers online" },
  refresh: "Refresh",
  statServers: "Servers",
  emptyHint: "Add your first server to start managing it",
  addServer: "Add server",
  added: "Server \"{name}\" added",
  updated: "Server \"{name}\" updated",
  deleted: "Server \"{name}\" deleted",
  deleteTitle: "Delete {name}",
  deleteMessage: "This cannot be undone. The server will be removed from all groups.",
};
