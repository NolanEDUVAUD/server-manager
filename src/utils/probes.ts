import { Probe, ProbeKind, Server } from "../types";
import { t } from "../i18n";

export function describeProbe(kind: ProbeKind): string {
  switch (kind.type) {
    case "Http": return `${kind.url}${kind.expect_status ? ` → ${kind.expect_status}` : ""}${kind.keyword ? ` · ${t("probes.keyword", { keyword: kind.keyword })}` : ""}`;
    case "Tcp": return `TCP ${kind.host}:${kind.port}`;
    case "TlsExpiry": return t("probes.tlsExpiry", { host: kind.host, port: kind.port, days: kind.warn_days });
  }
}

/**
 * Sondes proposées à partir des serveurs, sans doublon avec l'existant :
 * interface web + certificat pour Proxmox, interface web pour TrueNAS.
 */
export function suggestProbes(servers: Server[], existing: Probe[]): Probe[] {
  const key = (k: ProbeKind) => JSON.stringify(k);
  const taken = new Set(existing.map((p) => key(p.kind)));
  const base = { id: "", enabled: true, interval_secs: 60, verify_tls: false, auth: { type: "None" } as const };
  const out: Probe[] = [];
  for (const s of servers) {
    if (s.os_type === "Proxmox") {
      out.push({ ...base, name: t("probes.suggestion.proxmoxUi", { server: s.name }), server_id: s.id, kind: { type: "Http", url: `https://${s.ip}:8006/`, expect_status: null, keyword: null } });
      out.push({ ...base, name: t("probes.suggestion.certificate", { server: s.name }), server_id: s.id, interval_secs: 3600, kind: { type: "TlsExpiry", host: s.ip, port: 8006, warn_days: 14 } });
    }
    if (s.os_type === "TrueNAS") {
      out.push({ ...base, name: t("probes.suggestion.truenasUi", { server: s.name }), server_id: s.id, kind: { type: "Http", url: `http://${s.ip}/`, expect_status: null, keyword: null } });
    }
  }
  return out.filter((p) => !taken.has(key(p.kind)));
}

/** Risques d'exposition du secret d'une sonde authentifiée, à afficher dans le formulaire */
export function authWarnings(p: Probe): string[] {
  if (p.auth.type === "None" || p.kind.type !== "Http") return [];
  const url = p.kind.url.trim().toLowerCase();
  if (url.startsWith("http://")) return [t("probes.warnings.plainHttp")];
  if (!p.verify_tls) return [t("probes.warnings.unverifiedTls")];
  return [];
}
