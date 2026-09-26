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
    version: "0.4.1",
    date: "2026-09-27",
    items: {
      fr: [
        "Bêta : merci de signaler tout problème depuis Paramètres → Signaler un problème",
        "Glisser-déposer des onglets et des favoris réparé sous Windows",
        "Menus déroulants : ne se ferment plus quand on fait défiler leur contenu",
        "Alertes : interrupteur général « Alertes activées »",
        "Mise à jour : recherche sur GitHub et confirmation avant toute installation",
        "Signaler un problème : ouverture du navigateur réparée",
        "Authentification SSH simplifiée : mot de passe ou clé gérée par l'application",
        "Tâches en lot intelligentes : OS détecté sur chaque cible, commandes adaptées et aperçu avant exécution",
        "Graphe réseau : Wi-Fi, sous-réseaux, traceroute, détails des appareils et topologie éditable",
        "Icônes de serveur : recherche, catégories et couleurs",
        "Tutoriel de présentation au premier lancement, fenêtre des nouveautés après une mise à jour",
        "Contrat de licence à accepter dans l'application",
      ],
      en: [
        "Beta: please report any issue from Settings → Report a problem",
        "Tab and favorites drag & drop fixed on Windows",
        "Dropdown menus no longer close when scrolling their content",
        "Alerts: global \"Alerts enabled\" switch",
        "Updates: GitHub check and confirmation before any install",
        "Report a problem: opening the browser fixed",
        "Simplified SSH authentication: password or an app-managed key",
        "Smart batch tasks: OS detected on each target, adapted commands and preview before running",
        "Network graph: Wi-Fi, subnets, traceroute, device details and editable topology",
        "Server icons: search, categories and colors",
        "Guided tour on first launch, what's new window after an update",
        "License agreement to accept in the app",
      ],
    },
  },
  {
    version: "0.4.0",
    date: "2026-09-26",
    items: {
      fr: [
        "Barre latérale personnalisable : favoris, ordre des onglets, largeur et densité",
        "Version affichée en haut de la barre latérale",
        "Onglets Mise à jour, Signaler un problème et Soutenir le développement dans les Paramètres",
        "Système d'extensions pour étendre les thèmes et les fonctionnalités",
        "Vue graphe du réseau pour visualiser les connexions",
        "Saisies conservées entre les pages (brouillons temporaires)",
        "Correctifs : alertes, menus déroulants, icônes",
        "Retrait de l'onglet Services",
        "Contrat de licence utilisateur final (EULA)",
      ],
      en: [
        "Customizable sidebar: favorites, tab order, width, and density",
        "Version displayed at the top of the sidebar",
        "Update, Report a problem and Support tabs in Settings",
        "Extension system to extend themes and features",
        "Network graph view to visualize connections",
        "Form inputs retained between pages (temporary drafts)",
        "Fixes: alerts, dropdowns, icons",
        "Removed the Services tab",
        "End-user license agreement (EULA)",
      ],
    },
  },
  {
    version: "0.3.0",
    date: "2026-09-25",
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
