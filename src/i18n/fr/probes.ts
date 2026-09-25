/** Description, suggestions et avertissements des sondes (utils/probes.ts) */
export const probes = {
  keyword: "« {keyword} »",
  tlsExpiry: "Certificat {host}:{port} (alerte < {days} j)",
  suggestion: {
    proxmoxUi: "{server} · interface Proxmox",
    certificate: "{server} · certificat",
    truenasUi: "{server} · interface TrueNAS",
  },
  warnings: {
    plainHttp: "HTTP sans chiffrement : le secret circule en clair sur le réseau. Préfère https:// si le service le permet.",
    unverifiedTls: "Certificat non vérifié : un intermédiaire sur le réseau pourrait intercepter le secret.",
  },
};
