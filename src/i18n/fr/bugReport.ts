/** Paramètres → Signaler un problème : formulaire de rapport de bug */
export const bugReport = {
  title: "Signaler un problème",
  intro:
    "Décris le problème rencontré : une issue pré-remplie s'ouvrira sur GitHub, que tu pourras relire et modifier avant de l'envoyer.",
  fields: {
    title: "Titre",
    titlePlaceholder: "Résumé court du problème",
    description: "Description",
    descriptionPlaceholder: "Que se passe-t-il ?",
    steps: "Étapes pour reproduire",
    stepsPlaceholder: "1. …\n2. …\n3. …",
    expected: "Comportement attendu",
    actual: "Comportement observé",
  },
  includeSystemInfo: "Inclure les informations système",
  includeSystemInfoHelp:
    "Version de l'application, système d'exploitation, langue et modules activés. Jamais d'adresse IP, d'identifiants, de clés ni de noms d'hôte.",
  send: "Envoyer sur GitHub",
  sendHelp: "Ouvre une issue pré-remplie dans ton navigateur : rien n'est publié sans ta confirmation sur GitHub.",
  copy: "Copier le rapport",
  copied: "Rapport copié dans le presse-papier",
  openFailed: "Impossible d'ouvrir le navigateur",
  titleRequired: "Le titre est obligatoire",
};
