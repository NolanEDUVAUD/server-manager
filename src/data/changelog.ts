/** Entrée du journal des modifications */
export interface ChangelogEntry {
  version: string;
  date: string; // Format YYYY-MM-DD
  items: {
    fr: string[];
    en: string[];
  };
}

/** Liste des versions avec leurs modifications (ordre décroissant) */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.0",
    date: "2025-09-26",
    items: {
      fr: [
        "Barre latérale personnalisable : favoris, ordre des onglets, largeur et densité",
        "Version affichée en haut de la barre latérale",
        "Onglets Mise à jour, Signaler un problème et Soutenir le projet dans À propos",
        "Système d'extensions pour étendre les thèmes et les fonctionnalités",
        "Vue graphe du réseau pour visualiser les connexions",
        "Saisies conservées entre les pages (brouillons temporaires)",
        "Correctifs : alertes, menus déroulants, icônes",
        "Retrait de l'onglet Services (intégré aux serveurs)",
        "Contrat de licence utilisateur final (EULA)",
      ],
      en: [
        "Customizable sidebar: favorites, tab order, width, and density",
        "Version displayed at the top of the sidebar",
        "Update, Report Issue, and Support tabs in About settings",
        "Extension system to extend themes and features",
        "Network graph view to visualize connections",
        "Form inputs retained between pages (temporary drafts)",
        "Fixes: alerts, dropdowns, icons",
        "Removed Services tab (integrated into servers)",
        "End-user license agreement (EULA)",
      ],
    },
  },
  {
    version: "0.3.0",
    date: "2025-06-01",
    items: {
      fr: [
        "Amélioration de la stabilité et performance globale de l'application",
      ],
      en: [
        "Improved application stability and overall performance",
      ],
    },
  },
];
