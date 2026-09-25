/** Page Docker : conteneurs des serveurs via SSH */
export const docker = {
  subtitle: "Conteneurs de tes serveurs via SSH · un serveur absent ? Ajoute ta VM Docker dans « Serveurs »",
  pickServer: "Choisis un serveur pour voir ses conteneurs.",
  notInstalled: "Docker n'est pas installé sur ce serveur (ou pas dans le PATH de l'utilisateur SSH).",
  noContainers: "Aucun conteneur sur ce serveur.",
  containers: { one: "{count} conteneur", other: "{count} conteneurs" },
  badge: {
    offline: "hors ligne",
    error: "erreur",
    noDocker: "pas de Docker",
  },
  start: "Démarrer",
  stop: "Arrêter",
  restart: "Redémarrer",
  started: "{name} : démarré",
  stopped: "{name} : arrêté",
  restarted: "{name} : redémarré",
  logs: {
    button: "Logs",
    title: "Logs · {name}",
    lastLines: "{count} dernières lignes",
    noOutput: "(aucune sortie)",
  },
};
