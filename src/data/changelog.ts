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
    version: "0.4.2",
    date: "2026-09-28",
    items: [
      { fr: "Bêta : merci de signaler tout problème depuis Paramètres → Signaler un problème", en: "Beta: please report any issue from Settings → Report a problem" },
      { fr: "Tutoriel interactif au premier lancement, avec un mini-exemple pour chaque onglet", en: "Interactive tour on first launch, with a mini example for each tab" },
      { fr: "Icône « i » sur chaque onglet : survole-la pour savoir à quoi il sert", en: "\"i\" icon on each tab: hover it to learn what the tab is for" },
      { fr: "Paramètres déplacés en bas de la barre latérale ; la mise en page se règle dans Paramètres → Apparence", en: "Settings moved to the bottom of the sidebar; layout options are in Settings → Appearance", tourStep: "settings" },
      { fr: "Tâches en lot repensées : un seul écran en 3 étapes (cibles, quoi exécuter, lancement) avec aperçu avant exécution", en: "Redesigned batch tasks: a single 3-step screen (targets, what to run, launch) with a preview before running", tourStep: "batch" },
      { fr: "Authentification SSH simplifiée : mot de passe ou clé gérée par l'application (l'agent SSH est retiré)", en: "Simplified SSH authentication: password or an app-managed key (SSH agent removed)" },
      { fr: "Nouvelle icône de l'application", en: "New application icon" },
      { fr: "Contrat de licence réécrit en anglais, à accepter de nouveau", en: "License agreement rewritten in English, to be accepted again" },
    ],
  },
  {
    version: "0.4.1",
    date: "2026-09-27",
    items: [
      { fr: "Glisser-déposer des onglets et des favoris réparé sous Windows", en: "Tab and favorites drag & drop fixed on Windows", tourStep: "customization" },
      { fr: "Menus déroulants : ne se ferment plus quand on fait défiler leur contenu", en: "Dropdown menus no longer close when scrolling their content" },
      { fr: "Alertes : interrupteur général « Alertes activées »", en: "Alerts: global \"Alerts enabled\" switch", tourStep: "alerts" },
      { fr: "Mise à jour : recherche sur GitHub et confirmation avant toute installation", en: "Updates: GitHub check and confirmation before any install", tourStep: "settings" },
      { fr: "Signaler un problème : ouverture du navigateur réparée", en: "Report a problem: opening the browser fixed" },
      { fr: "Tâches en lot intelligentes : OS détecté sur chaque cible et commandes adaptées", en: "Smart batch tasks: OS detected on each target and adapted commands", tourStep: "batch" },
      { fr: "Graphe réseau : Wi-Fi, sous-réseaux, traceroute, détails des appareils et topologie éditable", en: "Network graph: Wi-Fi, subnets, traceroute, device details and editable topology", tourStep: "network" },
      { fr: "Icônes de serveur : recherche, catégories et couleurs", en: "Server icons: search, categories and colors" },
      { fr: "Fenêtre des nouveautés après une mise à jour", en: "What's new window after an update" },
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
