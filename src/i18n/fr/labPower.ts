/** Arrêt / démarrage ordonné du lab (les étapes et avertissements viennent du backend) */
export const labPower = {
  title: "Arrêt / démarrage du lab",
  subtitle: "Tout éteindre ou tout rallumer dans le bon ordre : le pare-feu en dernier à l'arrêt, en premier au démarrage",
  shutdownAll: "Arrêt complet",
  startupAll: "Démarrage complet",
  simulate: "Simuler",
  simulateHint: "« Simuler » ne fait que lire l'état (API Proxmox, ping) et affiche ce qui serait fait — rien n'est exécuté.",
  actions: {
    shutdownServer: "Arrêt SSH de {server}",
    wakeServer: "Wake-on-LAN de {server}, puis attente du ping",
    shutdownGuests: "Arrêt propre de {guests}",
    startGuests: "Démarrage de {guests}",
  },
  executeTitle: "Exécution réelle",
  /** Suivi de la phrase de confirmation, elle-même traduite (le backend accepte chaque langue) */
  executeHint: "Pour lancer vraiment la séquence, recopie",
  phraseShutdown: "ÉTEINDRE LE LAB",
  phraseStartup: "DÉMARRER LE LAB",
  confirmAria: "Phrase de confirmation",
  cancelAfterStep: "Annuler après l'étape en cours",
  execute: "Exécuter",
};
