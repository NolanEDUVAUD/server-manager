/** Authentification SSH d'un serveur (méthode, clé, rebond) et déploiement de clé */
export const sshAuth = {
  methods: {
    password: "Mot de passe",
    passwordHint: "Mot de passe enregistré, chiffré par la clé maître.",
    key: "Clé de l'app",
    keyHint: "Clé SSH gérée dans Paramètres → Clés SSH (la clé privée reste chiffrée dans l'app).",
  },
  warnNoKeys: "Aucune clé SSH enregistrée : crée ou importe une clé dans Paramètres → Clés SSH.",
  warnChooseKey: "Choisis la clé à utiliser.",
  warnKeyDeleted: "La clé choisie a été supprimée : choisis-en une autre.",
  blockedWindows:
    "Déploiement automatique impossible sur Windows : OpenSSH y lit C:\\ProgramData\\ssh\\administrators_authorized_keys pour les administrateurs. Copie la clé publique (Paramètres → Clés SSH) et ajoute-la à la main.",
  blockedEsxi:
    "Déploiement automatique impossible sur ESXi : les clés se trouvent dans /etc/ssh/keys-<utilisateur>/authorized_keys. Ajoute la clé publique depuis l'interface ESXi.",
  truenasWarning:
    "Sur TrueNAS, le middleware peut régénérer authorized_keys : ajoute aussi la clé dans Identifiants → Utilisateurs pour qu'elle soit conservée.",
  summaryKey: "Clé « {name} »",
  summaryKeyDeleted: "Clé supprimée",
  summaryVia: "{text} · via {jump}",
  // Champs du formulaire serveur
  title: "Authentification SSH",
  methodAria: "Méthode d'authentification SSH",
  appKey: "Clé de l'app",
  loadingKeys: "Chargement des clés…",
  chooseKey: "— Choisir une clé —",
  keyDeleted: "Clé supprimée",
  clearPassword: "Effacer le mot de passe enregistré pour ce serveur",
  jumpHost: "Hôte de rebond (optionnel)",
  jumpNone: "Aucun (connexion directe)",
  jumpMissing: "Rebond indisponible — à changer",
  jumpDependents: "Ce serveur sert de rebond à {servers} : il ne peut pas passer lui-même par un rebond (un seul niveau).",
  jumpHelp: "La connexion passe par ce serveur (tunnel SSH) ; la clé d'hôte de chaque saut est vérifiée.",
  // Déploiement d'une clé
  deploy: {
    via: {
      password: "le mot de passe enregistré",
      key: "la clé de l'app actuelle",
    },
    title: "Déployer une clé sur {name}",
    close: "Fermer",
    runningTitle: "Déploiement sur {name}",
    running: "Ajout de la clé puis vérification de la connexion par clé…",
    wait: "Patiente…",
    added: "La clé a été ajoutée",
    alreadyPresent: "La clé était déjà présente",
    doneTitle: "Clé déployée",
    doneMessage: "{added} et la connexion par clé fonctionne.",
    verified: "Connexion par clé vérifiée",
    switchTitle: "Utiliser la clé pour {name} ?",
    switchMessage:
      "{added} dans ~/.ssh/authorized_keys de {target} et la connexion par clé fonctionne.\n\nBasculer {name} sur la clé « {key} » pour toutes les connexions de l'app ?",
    useKey: "Utiliser la clé",
    keepMethod: "Garder la méthode actuelle",
    deployedOn: "Clé déployée sur {name}",
    switched: "{name} utilise maintenant la clé « {key} »",
    failedTitle: "Connexion par clé refusée",
    failedMessage:
      "{added}, mais la connexion par clé a échoué : {detail}.\n\nVérifie les droits de ~/.ssh (700) et d'authorized_keys (600), et que PubkeyAuthentication est actif dans sshd. Le serveur garde sa méthode actuelle.",
    unknownReason: "raison inconnue",
    noKeys: "Aucune clé SSH enregistrée : génère ou importe une clé dans Paramètres → Clés SSH.",
    explain:
      "La clé publique choisie sera ajoutée à ~/.ssh/authorized_keys de {target}, en se connectant avec {via}{jump}.\n~/.ssh (700) et authorized_keys (600) sont créés s'ils n'existent pas ; la ligne n'est jamais ajoutée deux fois. La connexion par clé est ensuite vérifiée.",
    viaJump: " (via l'hôte de rebond)",
    confirm: "Déployer la clé",
    keyToDeploy: "Clé à déployer",
  },
};
