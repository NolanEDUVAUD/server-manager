import { DashboardTab, ProxmoxConnection, Server } from "../types";

export interface WebTarget extends DashboardTab {
  kind: "Proxmox" | "TrueNAS";
}

/** Hôte d'une URL, ou null si elle est invalide. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Interfaces web ouvrables en onglet : les connexions Proxmox configurées, puis
 * l'interface déduite des serveurs Proxmox (port 8006) et TrueNAS (port 80).
 */
export function webTargets(servers: Server[], connections: ProxmoxConnection[]): WebTarget[] {
  const targets: WebTarget[] = connections.map((c) => ({
    label: c.id,
    connectionId: c.id,
    url: c.api_url,
    title: c.name,
    kind: "Proxmox",
  }));
  const covered = new Set(connections.map((c) => hostOf(c.api_url)));

  for (const s of servers) {
    if (covered.has(s.ip)) continue;
    const url =
      s.os_type === "Proxmox" ? `https://${s.ip}:8006/`
      : s.os_type === "TrueNAS" ? `http://${s.ip}/`
      : null;
    if (!url) continue;
    targets.push({
      // Préfixe : l'id serveur ne doit pas pouvoir entrer en collision avec un id de connexion
      label: `srv-${s.id}`,
      connectionId: s.id,
      url,
      title: s.name,
      kind: s.os_type as WebTarget["kind"],
    });
  }
  return targets;
}
