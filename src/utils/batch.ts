/** Motifs de commandes qui modifient le système (heuristique d'avertissement) */
const MODIFYING = [
  /\bapt(-get)?\s+(-\S+\s+)*(upgrade|full-upgrade|dist-upgrade|install|remove|purge|autoremove)\b/,
  /\b(dnf|yum|apk|pacman)\s+(-\S+\s+)*(upgrade|update|install|remove|-S|-R)\b/,
  /\brm\s+-/,
  // Commande (pas un chemin comme /var/run/reboot-required)
  /(?<![\w/-])(shutdown|reboot|poweroff|halt)(?![\w-])/,
  /\bsystemctl\s+(restart|stop|start|disable|enable|reload)\b/,
  /\bdocker\s+(rm|rmi|stop|restart|kill|system\s+prune|image\s+prune|compose\s+(down|up|pull))\b/,
  /\b(qm|pct)\s+(stop|shutdown|start|reboot|destroy|rollback|migrate)\b/,
  /\bzfs\s+(destroy|rollback)\b/,
  /\bzpool\s+(destroy|scrub|clear|offline)\b/,
  /\b(mkfs|dd|fdisk|parted|wipefs)\b/,
  /\bchmod\b|\bchown\b|\bsed\s+-i\b|>\s*\/(etc|boot|usr)\//,
];

/** Le script semble-t-il modifier le système ? (sert à renforcer la confirmation) */
export function looksModifying(script: string): boolean {
  return MODIFYING.some((re) => re.test(script));
}

export interface BatchTemplate {
  name: string;
  script: string;
}

/** Modèles proposés ; les modifiants sont identifiés par looksModifying() */
export const TEMPLATES: BatchTemplate[] = [
  { name: "Espace disque", script: "df -h -x tmpfs -x devtmpfs" },
  { name: "Mises à jour disponibles", script: "apt list --upgradable 2>/dev/null | tail -n +2" },
  { name: "Redémarrage requis ?", script: "[ -f /var/run/reboot-required ] && echo 'Redémarrage requis' || echo 'Non'" },
  { name: "Services en échec", script: "systemctl --failed --no-legend || true" },
  { name: "Version du noyau", script: "uname -r" },
  { name: "Mettre à jour les paquets (Debian/Proxmox)", script: "export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get -y full-upgrade" },
  { name: "Nettoyer les images Docker inutilisées", script: "docker image prune -af" },
];
