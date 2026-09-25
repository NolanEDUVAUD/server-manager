import type { Dict } from "..";

export const docker: Dict["docker"] = {
  subtitle: "Containers on your servers over SSH · server missing? Add your Docker VM under “Servers”",
  pickServer: "Choose a server to see its containers.",
  notInstalled: "Docker is not installed on this server (or not in the SSH user's PATH).",
  noContainers: "No containers on this server.",
  containers: { one: "{count} container", other: "{count} containers" },
  badge: {
    offline: "offline",
    error: "error",
    noDocker: "no Docker",
  },
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  started: "{name}: started",
  stopped: "{name}: stopped",
  restarted: "{name}: restarted",
  logs: {
    button: "Logs",
    title: "Logs · {name}",
    lastLines: "last {count} lines",
    noOutput: "(no output)",
  },
};
