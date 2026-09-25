/** Page Historique : types d'événements, jours, disponibilité */
export const events = {
  kinds: {
    offline: "Hors ligne",
    online: "En ligne",
    wake: "Wake-on-LAN",
    shutdown: "Arrêt",
    reboot: "Redémarrage",
    vmAction: "Action VM",
    container: "Docker",
    alert: "Alerte",
    failure: "Échec",
  },
  /** En-tête de journée */
  today: "Aujourd'hui",
  yesterday: "Hier",
  /** Dans une phrase (« Hors ligne · aujourd'hui 14:02:10 ») */
  todayInline: "aujourd'hui",
  yesterdayInline: "hier",
  title: "Historique",
  subtitle: "Pertes de connexion et actions sur tes serveurs",
  count: { one: "{count} événement", other: "{count} événements" },
  clear: "Effacer",
  noEvent: "Aucun événement",
  outages: { one: "{count} coupure", other: "{count} coupures" },
  offlineFor: "{duration} hors ligne",
  statsDays: "{days} j",
  pingsTitle: "{online} ping(s) réussi(s) sur {checks}",
  uptime: "dispo {percent}",
  allServers: "Tous les serveurs",
  allTypes: "Tous les types",
  empty: "Aucun événement pour l'instant : ils apparaissent dès qu'un serveur change d'état ou qu'une action est lancée.",
  clearTitle: "Effacer l'historique",
  clearMessage:
    "Tous les événements (coupures, retours en ligne, actions, échecs) seront supprimés définitivement. Les mesures de disponibilité (pings) sont conservées selon la rétention choisie dans Paramètres → Historique. Continuer ?",
};
