/** Paramètres → Historique : base locale et rétention */
export const retention = {
  title: "Historique",
  intro:
    "Les pings, contrôles de services, relevés de ressources et événements sont enregistrés dans une base locale. Ils survivent au redémarrage de l'application et ne contiennent aucun mot de passe ni jeton.",
  database: "Base d'historique",
  refreshLabel: "Actualiser l'état de la base",
  reading: "Lecture de la base…",
  readError: "Impossible de lire l'état de la base : {message}",
  size: "Taille",
  inMemory: "en mémoire",
  events: "Événements",
  rawSamples: "Mesures détaillées",
  hourlyRows: "Agrégats horaires",
  since: "Depuis le",
  noData: "aucune donnée pour l'instant",
  fields: {
    raw: { label: "Mesures détaillées (jours)", help: "Chaque ping, contrôle de service et relevé CPU / RAM" },
    hourly: { label: "Agrégats horaires (jours)", help: "Disponibilité, latence et ressources résumées heure par heure" },
    events: { label: "Événements (jours)", help: "Coupures, retours en ligne, arrêts, échecs…" },
  },
  errors: {
    raw: "Mesures détaillées : entre 1 et 31 jours",
    hourly: "Agrégats horaires : entre 7 et 730 jours",
    hourlyShorter: "Les agrégats horaires doivent être conservés au moins aussi longtemps que les mesures détaillées",
    events: "Événements : entre 7 et 3 650 jours",
  },
  saved: "Rétention enregistrée : elle s'applique à la prochaine purge (toutes les heures)",
  pruned: "Purge effectuée : {raw} mesure(s), {hourly} agrégat(s), {events} événement(s) supprimés",
  applyNow: "Appliquer maintenant",
  saveFirst: "Sauvegarde d'abord la nouvelle rétention",
  confirmTitle: "Appliquer la rétention maintenant",
  confirmMessage:
    "Seront supprimés définitivement : les mesures détaillées de plus de {raw} jour(s), les agrégats horaires de plus de {hourly} jours et les événements de plus de {events} jours. Continuer ?",
};
