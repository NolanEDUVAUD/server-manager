/** Une ligne du journal des modifications */
export interface ChangelogItem {
  fr: string;
  en: string;
  /**
   * Identifiant optionnel d'une étape du tutoriel (voir src/utils/tour.ts) : quand présent,
   * le bouton « Découvrir » de la fenêtre « Quoi de neuf ? » rejoue le tour sur cette étape.
   */
  tourStep?: string;
}

/** Entrée du journal des modifications */
export interface ChangelogEntry {
  version: string;
  date: string; // Format YYYY-MM-DD
  items: ChangelogItem[];
}

/** Liste des versions avec leurs modifications (ordre décroissant) */
export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.4.1",
    date: "2026-09-27",
    items: [
      { fr: "Bêta : merci de signaler tout problème depuis Paramètres → Signaler un problème", en: "Beta: please report any issue from Settings → Report a problem" },
      { fr: "Glisser-déposer des onglets et des favoris réparé sous Windows", en: "Tab and favorites drag & drop fixed on Windows", tourStep: "customization" },
      { fr: "Menus déroulants : ne se ferment plus quand on fait défiler leur contenu", en: "Dropdown menus no longer close when scrolling their content" },
      { fr: "Alertes : interrupteur général « Alertes activées »", en: "Alerts: global \"Alerts enabled\" switch", tourStep: "alerts" },
      { fr: "Mise à jour : recherche sur GitHub et confirmation avant toute installation", en: "Updates: GitHub check and confirmation before any install", tourStep: "settings" },
      { fr: "Signaler un problème : ouverture du navigateur réparée", en: "Report a problem: opening the browser fixed" },
      { fr: "Agent SSH : chaque clé est essayée, délai maximal, bouton « Tester l'agent » et aide détaillée", en: "SSH agent: every key is tried, timeout, \"Test the agent\" button and detailed help" },
      { fr: "Tâches en lot intelligentes : OS détecté sur chaque cible, commandes adaptées et aperçu avant exécution", en: "Smart batch tasks: OS detected on each target, adapted commands and preview before running", tourStep: "batch" },
      { fr: "Graphe réseau : Wi-Fi, sous-réseaux, traceroute, détails des appareils et topologie éditable", en: "Network graph: Wi-Fi, subnets, traceroute, device details and editable topology", tourStep: "network" },
      { fr: "Icônes de serveur : recherche, catégories et couleurs", en: "Server icons: search, categories and colors" },
      { fr: "Tutoriel de présentation au premier lancement, fenêtre des nouveautés après une mise à jour", en: "Guided tour on first launch, what's new window after an update" },
      { fr: "Contrat de licence à accepter dans l'application", en: "License agreement to accept in the app" },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-26",
    items: [
      { fr: "Barre latérale personnalisable : favoris, ordre des onglets, largeur et densité", en: "Customizable sidebar: favorites, tab order, width, and density", tourStep: "customization" },
      { fr: "Version affichée en haut de la barre latérale", en: "Version displayed at the top of the sidebar" },
      { fr: "Onglets Mise à jour, Signaler un problème et Soutenir le développement dans les Paramètres", en: "Update, Report a problem and Support tabs in Settings", tourStep: "settings" },
      { fr: "Système d'extensions pour étendre les thèmes et les fonctionnalités", en: "Extension system to extend themes and features" },
      { fr: "Vue graphe du réseau pour visualiser les connexions", en: "Network graph view to visualize connections", tourStep: "network" },
      { fr: "Saisies conservées entre les pages (brouillons temporaires)", en: "Form inputs retained between pages (temporary drafts)" },
      { fr: "Correctifs : alertes, menus déroulants, icônes", en: "Fixes: alerts, dropdowns, icons" },
      { fr: "Retrait de l'onglet Services", en: "Removed the Services tab" },
      { fr: "Contrat de licence utilisateur final (EULA)", en: "End-user license agreement (EULA)" },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-25",
    items: [
      { fr: "Amélioration de la stabilité et performance globale de l'application", en: "Improved application stability and overall performance" },
    ],
  },
];
