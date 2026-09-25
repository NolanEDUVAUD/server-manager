/** Page Mises à jour : paquets, redémarrages requis, images dépassées */
export const updates = {
  title: "Mises à jour",
  subtitle: "Paquets en attente, redémarrages requis, conteneurs sur une image dépassée — consultation seule",
  scan: "Analyser",
  kernelMismatch: "Noyaux différents entre les nœuds Proxmox : {list}",
  intro: "Lance une analyse (lecture seule : lit le cache apt et l'état Docker de chaque serveur).",
  packages: { one: "{count} paquet", other: "{count} paquets" },
  security: "{count} de sécurité",
  rebootRequired: "redémarrage requis",
  listsAge: "liste apt vieille de {days} j",
  showPackages: "Voir les paquets",
  staleContainers: {
    one: "{count} conteneur sur une image dépassée",
    other: "{count} conteneurs sur une image dépassée",
  },
  staleHelpBefore: "L'image plus récente est déjà téléchargée : il suffit de recréer le conteneur (",
  staleHelpAfter: "dans le dossier du projet).",
  prepare: "Préparer la mise à jour de {name}",
};
