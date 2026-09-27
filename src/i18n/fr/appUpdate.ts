/** Mise à jour automatique de l'application : bannière et Paramètres → Général */
export const appUpdate = {
  notConfigured: "Mises à jour automatiques non configurées pour cette version",
  banner: {
    label: "Mise à jour disponible",
    installed: "installée : {version}",
    published: "publiée le {date}",
    notes: "Notes de version",
    retry: "Réessayer l'installation",
    later: "Plus tard",
  },
  available: "Version {version} disponible",
  install: "Installer et redémarrer",
  openDownload: "Ouvrir la page de téléchargement",
  confirmTitle: "Installer la version {version} ?",
  confirmMessage:
    "La version {version} va être téléchargée depuis GitHub, puis sa signature sera vérifiée avec la clé publique intégrée à l'application : un paquet non signé ou modifié est refusé.\n\nSi la signature est valide, l'installateur remplacera l'application puis la redémarrera automatiquement. Tes serveurs et ta configuration sont conservés.\n\nLes tâches en cours dans l'application (consoles SSH, tâches en lot, arrêt ou démarrage du lab…) seront interrompues.",
  confirmMessageUnsigned:
    "La mise à jour automatique n'est pas disponible pour cette installation : la page de la version {version} va s'ouvrir dans ton navigateur, où tu pourras télécharger et installer l'installateur toi-même. Rien n'est téléchargé ni modifié automatiquement.",
  progress: {
    preparing: "Préparation du téléchargement…",
    downloadingPercent: "Téléchargement… {percent} %",
    downloadingBytes: "Téléchargement… {size}",
    verifying: "Vérification de la signature…",
    installing: "Installation… l'application va redémarrer",
  },
  settings: {
    title: "Mises à jour de l'application",
    installedVersion: "Version installée",
    checkOnStartup: "Vérifier les mises à jour au démarrage",
    checkOnStartupHelp:
      "Rien n'est installé sans ta confirmation ; chaque version est signée et vérifiée avant installation.",
    checkNow: "Rechercher des mises à jour",
    checking: "Recherche en cours…",
    upToDate: "L'application est à jour",
    upToDateVersion: "L'application est à jour (version {version})",
    showBanner: "Afficher la bannière",
    seeBanner: ": voir la bannière en haut de la fenêtre",
    checkFailed: "Recherche impossible",
    releaseNotes: "Notes de version",
    viewReleases: "Voir les releases sur GitHub",
    lastChecked: "Dernière recherche : {time}",
    neverChecked: "Aucune recherche pour l'instant",
    openFailed: "Impossible d'ouvrir le navigateur",
    autoInstallAvailable: "Installation automatique et signée disponible",
    autoInstallUnavailable: "La version sera ouverte sur GitHub : installation manuelle",
  },
};
