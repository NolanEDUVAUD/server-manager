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

/** Réponse rapide proposée pour une question détectée dans la sortie */
export interface PromptChoice {
  label: string;
  /** Texte envoyé au serveur (retour à la ligne compris) */
  send: string;
  hint?: string;
}

export interface DetectedPrompt {
  question: string;
  choices: PromptChoice[];
}

/**
 * Détecte une question en attente à la fin de la sortie d'une commande.
 * Seule la dernière ligne compte : si la commande a écrit autre chose après,
 * c'est qu'elle n'attend plus de réponse.
 */
export function detectPrompt(output: string): DetectedPrompt | null {
  const last = output.replace(/\r/g, "").split("\n").pop()?.trim() ?? "";
  if (!last) return null;

  // dpkg : fichier de configuration modifié localement (Y/I/N/O/D/Z)
  if (/\(Y\/I\/N\/O\/D\/Z\)/i.test(last)) {
    const file = /Configuration file '([^']+)'/.exec(output.slice(-2000))?.[1];
    return {
      question: file ? `Fichier de configuration modifié : ${file}` : last,
      choices: [
        { label: "Garder ma version", send: "N\n", hint: "N — choix par défaut, conserve la configuration actuelle" },
        { label: "Version du paquet", send: "Y\n", hint: "Y — remplace par la version du mainteneur" },
        { label: "Voir les différences", send: "D\n", hint: "D — affiche le diff (q pour quitter)" },
      ],
    };
  }

  // Oui/non : [Y/n], [y/N], [O/n] (apt en français), (yes/no)
  const yn = /\[([YyOo])\/([Nn])\]\s*\??$|\(yes\/no(?:\/\[fingerprint\])?\)\??\s*$/.exec(last);
  if (yn) {
    const yes = yn[1] ? yn[1].toLowerCase() : "yes";
    const no = yn[2] ? "n" : "no";
    return { question: last, choices: [{ label: "Oui", send: `${yes}\n` }, { label: "Non", send: `${no}\n` }] };
  }

  // Pager (ex. après « D » de dpkg) ou « Press [ENTER] to continue »
  if (/^:$|\(END\)$|press \[?enter\]?/i.test(last)) {
    return { question: last, choices: [{ label: "Continuer", send: "\n" }, { label: "Quitter (q)", send: "q" }] };
  }

  // Question générique : la ligne se termine par « ? » ou « : » sans retour à la ligne
  if (!output.endsWith("\n") && /[?:]\s*$/.test(last)) return { question: last, choices: [] };
  return null;
}
