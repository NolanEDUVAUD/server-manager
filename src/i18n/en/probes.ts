import type { Dict } from "..";

export const probes: Dict["probes"] = {
  keyword: "“{keyword}”",
  tlsExpiry: "Certificate {host}:{port} (alert < {days} d)",
  suggestion: {
    proxmoxUi: "{server} · Proxmox interface",
    certificate: "{server} · certificate",
    truenasUi: "{server} · TrueNAS interface",
  },
  warnings: {
    plainHttp: "Unencrypted HTTP: the secret travels in clear text over the network. Use https:// if the service supports it.",
    unverifiedTls: "Certificate not verified: someone on the network could intercept the secret.",
  },
};
