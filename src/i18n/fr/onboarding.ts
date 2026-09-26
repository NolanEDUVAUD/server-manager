/** Écran d'accueil du premier lancement */
export const onboarding = {
  welcome: "Bienvenue dans Server Power Manager",
  intro: "Choisis ce que tu veux voir dans la barre latérale. Tout reste modifiable dans Paramètres → Général.",
  security: "Mots de passe et jetons sont chiffrés, avec une clé gardée dans le Gestionnaire d'identification Windows.",
  all: "Tout",
  start: "Commencer",
};

/** Tour de présentation interactif (coach-marks sur la vraie barre latérale) */
export const tour = {
  dialogLabel: "Tutoriel interactif",
  steps: {
    welcome: {
      title: "Bienvenue !",
      text: "Server Power Manager centralise vos serveurs et services pour une gestion simplifiée. Ce tutoriel présente rapidement chaque onglet en s'appuyant sur votre propre barre latérale.",
    },
    dashboard: {
      title: "Dashboard",
      text: "Vue d'ensemble de vos serveurs : statut, ressources utilisées et alertes actives, en un coup d'oeil.",
    },
    servers: {
      title: "Serveurs",
      text: "Ajoutez vos serveurs et réveillez-les à distance grâce au Wake-on-LAN, directement depuis leur carte.",
    },
    console: {
      title: "Console",
      text: "Terminal intégré : exécutez des commandes mémorisées sur vos serveurs directement depuis l'application.",
    },
    batch: {
      title: "Tâches en lot",
      text: "Lancez une même action sur plusieurs serveurs à la fois : la commande réelle s'adapte à l'OS de chaque cible.",
    },
    network: {
      title: "Réseau",
      text: "Scannez votre réseau et visualisez la topologie, de la box jusqu'à chaque machine connectée.",
    },
    alerts: {
      title: "Alertes",
      text: "Soyez prévenu quand un serveur passe hors ligne ou dépasse un seuil de ressources, par notification.",
    },
    customization: {
      title: "Favoris & personnalisation",
      text: "Glissez un onglet dans la zone Favoris pour l'épingler en haut de la barre latérale, dans l'ordre que vous voulez.",
    },
    settings: {
      title: "Paramètres",
      text: "Retrouvez ici les mises à jour, le signalement de problèmes et le soutien au projet.",
    },
  },
  prev: "Précédent",
  next: "Suivant",
  skip: "Passer le tutoriel",
  done: "Terminé",
  try: "Essayer",
  progress: "{current} / {total}",
  examples: {
    servers: {
      name: "srv-plex",
      wol: "Réveiller (WoL)",
      offline: "Hors ligne",
      online: "En ligne",
    },
    dashboard: {
      onlineLabel: "En ligne",
      cpuLabel: "CPU",
      ramLabel: "RAM",
    },
    console: {
      command: "uptime",
      output: "14:21 up 14 jours, charge moyenne : 0.08, 0.05, 0.01",
    },
    batch: {
      action: "Mettre à jour",
      debian: "Debian",
      alpine: "Alpine",
      windows: "Windows",
      target1: "srv-web",
      target2: "srv-nas",
      target3: "pc-win",
    },
    network: {
      box: "Box",
      switch: "Switch",
      machine1: "PC 1",
      machine2: "PC 2",
    },
    alerts: {
      toggleLabel: "Alertes activées",
      toastTitle: "Serveur hors ligne",
      toastMessage: "srv-nas ne répond plus",
    },
    customization: {
      tabLabel: "Console",
      favoritesLabel: "Favoris",
    },
  },
};

/** Modal « Quoi de neuf ? » */
export const whatsNew = {
  title: "Nouveautés de la version {version}",
  close: "Fermer",
  newBadge: "Nouveau",
  discover: "Découvrir",
};
