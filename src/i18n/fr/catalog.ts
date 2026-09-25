/** Catalogue de services auto-hébergés (utils/serviceCatalog.ts) : catégories et conseils */
export const catalog = {
  categories: {
    home: "Domotique",
    media: "Médias",
    network: "Réseau",
    infrastructure: "Infrastructure",
    monitoring: "Supervision",
    storage: "Stockage",
    apps: "Applications",
  },
  /** Mis à la place de l'hôte dans l'URL quand aucune adresse n'est saisie */
  hostPlaceholder: "adresse",
  help: {
    noAuth: "Aucun identifiant requis.",
    webUi: "Vérifie que l'interface web répond.",
    homeAssistant: "Profil → Sécurité → Jetons d'accès longue durée → Créer un jeton.",
    arrApiKey: "Settings → General → API Key.",
    pihole: "Aucun identifiant requis (vérifie que l'interface répond).",
    adguard: "Identifiant et mot de passe de l'interface AdGuard.",
    traefik: "Nécessite ping activé (--ping=true).",
    opnsense: "System → Access → Users → API keys : la clé en identifiant, le secret en mot de passe.",
    proxmoxVe: "Datacenter → Permissions → API Tokens. Secret : PVEAPIToken=utilisateur@pam!nom=uuid-du-jeton",
    pbs: "Configuration → Access Control → API Token. Secret : PBSAPIToken=utilisateur@pbs!nom:uuid-du-jeton",
    truenas: "Menu utilisateur → API Keys → Add.",
    nextcloud: "Aucun identifiant requis ; passe en erreur si le mode maintenance est actif.",
    paperless: "Profil → jeton d'API. Secret : Token suivi du jeton (ex. Token 0123abcd…).",
    custom: "Service personnalisé : n'importe quelle URL, avec authentification et lecture d'une valeur JSON si besoin.",
  },
};
