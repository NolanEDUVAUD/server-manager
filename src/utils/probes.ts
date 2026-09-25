import { Probe, ProbeKind, Server } from "../types";

export function describeProbe(kind: ProbeKind): string {
  switch (kind.type) {
    case "Http": return `${kind.url}${kind.expect_status ? ` → ${kind.expect_status}` : ""}${kind.keyword ? ` · « ${kind.keyword} »` : ""}`;
    case "Tcp": return `TCP ${kind.host}:${kind.port}`;
    case "TlsExpiry": return `Certificat ${kind.host}:${kind.port} (alerte < ${kind.warn_days} j)`;
  }
}

/**
 * Sondes proposées à partir des serveurs, sans doublon avec l'existant :
 * interface web + certificat pour Proxmox, interface web pour TrueNAS.
 */
export function suggestProbes(servers: Server[], existing: Probe[]): Probe[] {
  const key = (k: ProbeKind) => JSON.stringify(k);
  const taken = new Set(existing.map((p) => key(p.kind)));
  const base = { id: "", enabled: true, interval_secs: 60, verify_tls: false };
  const out: Probe[] = [];
  for (const s of servers) {
    if (s.os_type === "Proxmox") {
      out.push({ ...base, name: `${s.name} · interface Proxmox`, server_id: s.id, kind: { type: "Http", url: `https://${s.ip}:8006/`, expect_status: null, keyword: null } });
      out.push({ ...base, name: `${s.name} · certificat`, server_id: s.id, interval_secs: 3600, kind: { type: "TlsExpiry", host: s.ip, port: 8006, warn_days: 14 } });
    }
    if (s.os_type === "TrueNAS") {
      out.push({ ...base, name: `${s.name} · interface TrueNAS`, server_id: s.id, kind: { type: "Http", url: `http://${s.ip}/`, expect_status: null, keyword: null } });
    }
  }
  return out.filter((p) => !taken.has(key(p.kind)));
}
