import type { Dict } from "..";

export const network: Dict["network"] = {
  title: "Network",
  subtitle: "Devices on the local network (ping + ARP table) — read only",
  scan: "Scan",
  scanning: "Scanning…",
  macFound: "MAC found for {servers} (none saved): Wake-on-LAN will become possible.",
  fill: "Fill in",
  empty: "Run a scan to list the devices on your servers' network.",
  devices: { one: "{count} device responds to ping", other: "{count} devices respond to ping" },
  macsFilled: { one: "{count} MAC address filled in", other: "{count} MAC addresses filled in" },
  serverAdded: "{name} added",
  serverError: "{name}: {message}",
  // ── Graph view (Obsidian-like) ────────────────────────────────────────────
  viewList: "List",
  viewGraph: "Graph",
  gateway: "Gateway",
  graphHint: "Drag the background to pan, scroll to zoom, drag a node to move it or click it.",
  statusOnline: "Online",
  statusOffline: "Offline",
  statusUnknown: "Unknown",
  nodeServer: "Server",
  nodeDevice: "Detected device",
  nodeGateway: "Gateway",
  nodeDetails: {
    type: "Type",
    status: "Status",
    ip: "IP address",
    mac: "MAC address",
    jumpVia: "Via jump host",
  },
  closeDetails: "Close",
};
