# Fonctionnalités

Ce guide détaille chaque module de Server Power Manager. Les modules affichés
dans la barre latérale dépendent du choix fait au premier lancement, modifiable
dans **Paramètres → Général → Modules**.

## Serveurs & groupes

### Serveurs

**Serveurs → Ajouter** ouvre le formulaire d'ajout : nom, IP, adresse MAC,
authentification SSH (voir [ssh.md](ssh.md)), type d'OS. La commande d'arrêt
est pré-remplie selon l'OS choisi et reste modifiable.

- **Icônes** : chaque serveur a une icône, choisie parmi une bibliothèque
  d'icônes (Lucide), recherchable, avec une **couleur** personnalisable ; une
  image personnalisée (PNG/SVG) peut aussi être importée.
- **Recherche** : le champ de recherche de la page Serveurs filtre par nom, IP,
  OS, notes, champ personnalisé ou tag.
- **Favoris** : un bouton marque un serveur en favori (utile pour le filtrer
  rapidement dans les listes et le retrouver dans la barre latérale — voir
  [interface.md](interface.md#favoris)).
- **Tags et dossiers** : accessibles via le bouton **Organiser**, communs aux
  serveurs et aux services. Un serveur peut porter plusieurs tags colorés,
  mais un seul dossier à la fois (« Sans dossier » par défaut).
- **Champs personnalisés** : emplacement, numéro de série, ou tout autre champ
  libre ajouté à un serveur.
- **Wake-on-LAN** : envoie un magic packet à l'adresse MAC enregistrée
  (broadcast personnalisable par serveur).
- **Arrêt / redémarrage** : exécutés par SSH, avec confirmation affichant la
  commande exacte qui sera lancée.

### Groupes

**Groupes → Créer un groupe** : nom, icône, sélection des serveurs membres.
Un groupe permet des actions en un clic sur tous ses membres :

| Action | Effet |
|---|---|
| Ping | Ping de tous les serveurs du groupe |
| WoL tout | Wake-on-LAN à tous les serveurs du groupe |
| Tout éteindre | Arrêt SSH de tous les serveurs du groupe |

## Dashboard

Page d'accueil : nombre de serveurs en ligne, cartes serveur avec statut,
raccourcis d'actions et bouton *Rafraîchir*. Un serveur peut être ajouté
directement depuis le dashboard si aucun n'existe encore.

## Ressources

Supervision CPU / RAM / disques via SSH, rafraîchie à intervalle réglable
(**Paramètres → Réseau → Intervalle du monitoring**). Chaque carte affiche :

- la charge (par cœur ou moyenne selon l'OS) ;
- l'utilisation RAM et par pool/disque (« Pool {name} », « Disque système ») ;
- un mini-graphique d'historique (« Historique ») ;
- le temps de fonctionnement (« en marche depuis… ») ;
- des capteurs de température si disponibles.

Un serveur hors ligne affiche « Serveur hors ligne » plutôt que des valeurs
obsolètes ; le monitoring peut être désactivé globalement dans
**Paramètres → Réseau**.

## Réseau

Page en lecture seule qui combine ping et table ARP pour lister les appareils
du réseau local de tes serveurs.

1. Clique sur **Scanner** pour lancer un balayage.
2. Les appareils répondant au ping sont listés, avec leur adresse MAC si elle
   a pu être trouvée ; le bouton **Renseigner** propose d'enregistrer une MAC
   détectée sur un serveur existant qui n'en a pas encore (rend le
   Wake-on-LAN possible).

### Vue Liste / Vue Graphe

Un sélecteur bascule entre **Liste** et **Graphe**. La vue graphe (façon
Obsidian) affiche une topologie interactive :

- glisse le fond pour te déplacer, la molette pour zoomer, un nœud pour le
  déplacer ou cliquer dessus ;
- chaque nœud a un type : Serveur, Appareil détecté, Passerelle, Point d'accès
  Wi-Fi, Switch, Sous-réseau, Internet ;
- un clic sur un nœud ouvre un **panneau de détails** : type, état, IP, MAC,
  fabricant, type d'appareil, latence, dernière apparition, chemin de
  connexion, et pour un serveur relié par un hôte de rebond SSH, l'indication
  « via l'hôte de rebond ».

### Construire la topologie (« Connecté via… »)

Par défaut, chaque appareil se rattache à la passerelle réseau. Le champ
**Connecté via…** du panneau de détails permet de choisir un parent différent
pour reconstruire la vraie hiérarchie physique (Box → Switch → machines) :
sélectionne par exemple un switch pour dire qu'un serveur y est branché plutôt
que directement sur la box.

- **Switch/point d'accès virtuel** : le bouton *Ajouter un switch/AP virtuel*
  crée un nœud qui ne correspond à aucun appareil détecté (utile pour
  représenter un switch non managé, invisible sur le réseau). Il se supprime
  avec *Supprimer ce nœud virtuel*.
- **Point d'accès Wi-Fi** : si le PC qui exécute l'application est connecté en
  Wi-Fi, l'application ajoute automatiquement un nœud « Point d'accès »
  nommé d'après le SSID (ou l'adresse BSSID) du réseau.
- **Sauts jusqu'à Internet** : le nombre de sauts avant d'atteindre Internet
  (déduit d'un traceroute léger) s'affiche sur les nœuds concernés, avec une
  icône d'avertissement si le chemin est anormalement long.
- Un appareil détecté peut être **ajouté comme serveur** directement depuis le
  graphe, ou ouvrir la fiche du serveur existant qui lui correspond.

## Docker

**Docker** liste les conteneurs d'un serveur choisi (l'accès se fait par SSH ;
Docker doit être installé et dans le PATH de l'utilisateur SSH utilisé). Pour
chaque conteneur : démarrer, arrêter, redémarrer, et consulter les dernières
lignes de logs.

> **Astuce**
> Si un hôte Docker n'apparaît pas, vérifie qu'il est bien ajouté comme
> serveur dans **Serveurs**.

## Console SSH

Terminal SSH intégré, avec les identifiants déjà enregistrés pour chaque
serveur.

1. Choisis un serveur pour ouvrir une session.
2. Chaque session ouvre un **onglet** ; plusieurs sessions peuvent tourner en
   parallèle. *Reconnecter* relance une session fermée.

### Commandes mémorisées (snippets)

Le bouton **Commandes** ouvre le menu des commandes mémorisées : elles
s'**insèrent** dans le terminal actif sans s'exécuter automatiquement — il
faut valider avec Entrée. De nouvelles commandes peuvent être créées (nom +
commande) directement depuis ce menu. Des extensions communautaires peuvent
aussi en ajouter, voir [../extensions.md](../extensions.md).

## Tâches en lot

Exécute un script ou un playbook Ansible sur plusieurs serveurs à la fois,
avec la sortie en direct et réponse aux questions interactives (dpkg, apt).

### Script

1. Écris le script dans le champ *Script*.
2. Choisis les cibles (serveurs et/ou groupes).
3. Choisis le mode d'exécution : **En parallèle** ou **Un par un**, avec
   l'option *S'arrêter à la première erreur*.
4. *Exécuter* lance la tâche ; une confirmation rappelle si le script modifie
   le système des serveurs ciblés.
5. La tâche peut être **enregistrée** sous un nom pour être relancée plus
   tard ; des modèles courants sont proposés (espace disque, mises à jour
   disponibles, redémarrage requis, services en échec, version du noyau, mise
   à jour des paquets Debian/Proxmox, nettoyage des images Docker inutilisées).

Pendant l'exécution, l'application détecte les invites interactives (fichier
de configuration modifié, changement de version de paquet…) et propose des
réponses adaptées (garder sa version, voir le diff, continuer/quitter).

### Playbooks Ansible

Un onglet dédié permet de choisir un **hôte Ansible** (à ajouter d'abord dans
Serveurs), un dossier de playbooks, puis de lister les fichiers `.yml`
disponibles. Chaque playbook peut être **simulé** (`--check --diff`, aucune
modification) ou **exécuté pour de vrai**, avec une limite optionnelle
(`--limit`).

### Lot intelligent (Smart Batch)

Un troisième mode, *Action intelligente*, adapte automatiquement la commande à
exécuter à l'OS de chaque cible.

1. Bascule le *Type* sur **Action intelligente**.
2. Clique sur **Détecter les OS** : chaque serveur ciblé est sondé par SSH
   (lecture d'`/etc/os-release`, ou `uname -s`/`sw_vers` sur macOS/BSD, ou
   PowerShell sur Windows) ; le résultat (« Debian 12 », « Windows Server
   2022 »…) est mis en cache 10 minutes.
3. Choisis une **action** :

   | Action | Effet |
   |---|---|
   | Mettre à jour la liste des paquets | `apt-get update`, `dnf makecache`, `pacman -Sy`… selon l'OS |
   | Mettre à niveau le système | `apt upgrade`, `dnf upgrade`, `winget upgrade --all`… |
   | Installer un paquet | demande un nom de paquet |
   | Redémarrer un service | demande un nom de service (`systemctl restart`, `rc-service`, `brew services restart`, `Restart-Service`…) |
   | Nettoyer le cache des paquets | `apt-get clean`, `dnf clean all`… |
   | Redémarrer si nécessaire | ne redémarre que si l'OS indique qu'un redémarrage est requis |

   Les familles d'OS reconnues sont : Debian/Ubuntu (apt), Fedora/RHEL/CentOS/
   Rocky/AlmaLinux (dnf/yum), openSUSE/SLES (zypper), Arch/Manjaro (pacman),
   Alpine (apk), macOS (brew), Windows (winget/choco). Un OS non reconnu est
   simplement **ignoré** pour cette action (message d'erreur explicite), sans
   bloquer les autres cibles.

4. Coche **Adapter les variables du script à l'OS de chaque cible** pour
   utiliser un script libre contenant des **variables de gabarit**, résolues
   pour chaque cible selon son OS détecté :

   | Variable | Résolution |
   |---|---|
   | `{{pkg_update}}` | commande de rafraîchissement de la liste des paquets |
   | `{{pkg_upgrade}}` | commande de mise à niveau complète |
   | `{{pkg_install nom}}` | installation du paquet `nom` |
   | `{{pkg_clean}}` | nettoyage du cache des paquets |
   | `{{service_restart nom}}` | redémarrage du service `nom` |
   | `{{reboot_if_required}}` | redémarrage conditionnel |
   | `{{os_id}}` | identifiant de l'OS détecté (ex. `debian`, `windows`) |
   | `{{os_version}}` | numéro de version détecté |

   Des **blocs conditionnels** par famille d'OS sont aussi disponibles, sur un
   seul niveau (pas d'imbrication) :

   ```
   {{#if debian}}sudo apt-get install -y htop{{/if}}
   {{#if !debian}}echo "pas Debian"{{/if}}
   ```

   Familles reconnues dans les blocs `{{#if …}}` : `debian`, `redhat`, `suse`,
   `arch`, `alpine`, `mac`, `windows`.

5. **Aperçu** affiche la commande réellement résolue pour chaque cible avant
   de lancer quoi que ce soit ; les cibles en échec de détection sont
   signalées (« ignoré : … ») et **exclues** de l'exécution.
6. **Lancer** exécute la commande résolue sur chaque cible valide, après
   confirmation.

## Mises à jour

Page de **consultation seule** : analyse chaque serveur pour lister les
paquets en attente (dont ceux de sécurité), les redémarrages requis, l'âge du
cache apt, et les conteneurs Docker tournant sur une image dépassée par
rapport à celle déjà téléchargée localement (pas de mise à jour réelle
lancée depuis cette page : c'est un état des lieux). Sur un cluster Proxmox,
une incohérence de version de noyau entre nœuds est signalée.

## Historique

Journal persistant (SQLite) des événements : coupures, redémarrages, actions
lancées depuis l'app, disponibilité et latence des serveurs/services, courbes
de ressources. Conservé par défaut 7 jours en détail et 90 jours en agrégats
horaires (réglable dans **Paramètres → Historique**). Il ne contient aucun
secret : uniquement des mesures, des noms affichés et des messages
d'événements.

## Logs

Journaux systemd **centralisés dans Grafana Loki** (l'app ne collecte pas les
logs elle-même : Loki doit déjà recevoir les journaux via Promtail ou Alloy,
avec un label `host`/`hostname`). Après avoir configuré Loki dans
**Paramètres → Intégrations**, la page permet de filtrer par :

- niveau (Erreurs / Avertissements+ / Infos+ / Tout) ;
- hôte, unité systemd, période ;
- texte recherché ;
- mode **Direct** (flux en continu) ou fenêtre **« Autour de la dernière
  coupure »** (10 min avant → 5 min après le dernier événement de coupure
  détecté).

## Alertes

Notifie en cas de problème, même fenêtre fermée (via la zone de notification
Windows et/ou un canal push).

- **Interrupteur global « Alertes activées »** : quand il est désactivé,
  **aucune** alerte n'est envoyée, quel que soit l'état de chaque règle
  individuelle.
- Chaque règle a son propre interrupteur *Activer/Désactiver*.

### Créer une règle

**Nouvelle règle** ouvre le formulaire :

| Champ | Détail |
|---|---|
| Nom | libre |
| Condition | Serveur hors ligne, CPU élevé, RAM élevée, Disque presque plein, Température CPU, Action échouée, Service injoignable (sonde) |
| Seuil / Durée | selon la condition (ex. « CPU > 80 % pendant 5 min ») |
| S'applique à | Tous les serveurs, des groupes, ou des serveurs précis |
| Délai minimal entre deux alertes (cooldown) | évite le spam de notifications répétées |
| Canaux | Notification Windows, et/ou Push (téléphone) |

### Canaux

- **Notifications Windows** : natives, activées/désactivées globalement dans
  Paramètres.
- **Push téléphone** : nécessite au moins un canal configuré dans
  **Paramètres → Intégrations** — ntfy, Discord ou Telegram (voir
  [Intégrations](#intégrations) ci-dessous). Sans canal configuré, l'option
  l'indique clairement plutôt que d'échouer silencieusement.

Un bouton **Tester** envoie une notification de test sur les canaux
configurés. La page affiche aussi les **dernières alertes** déclenchées.

## Planificateur

Programme des allumages, extinctions et redémarrages.

1. **Nouvelle tâche** : nom, action (Allumer/Éteindre/Redémarrer), heure,
   jours (préréglages Semaine / Week-end / Tous, ou sélection manuelle),
   cible (serveurs ou groupes).
2. Choisis le **mode d'exécution** :

   | Mode | Fonctionnement |
   |---|---|
   | Par l'app | Tant que l'application est ouverte (même réduite dans la zone de notification) |
   | Sur le serveur (cron) | Crée directement un cronjob sur le serveur Linux ciblé — fonctionne même app fermée |

   Le mode *cron* utilise l'heure du serveur et la commande d'arrêt déjà
   configurée pour ce serveur ; un `sudo` sans mot de passe est nécessaire
   côté serveur. Le réveil (Wake-on-LAN) est toujours envoyé par l'app : un
   serveur éteint ne peut évidemment pas exécuter un cron.

3. *Exécuter maintenant* lance la tâche immédiatement, en dehors de sa
   planification (le résultat apparaît dans l'Historique).

> **Astuce**
> Active le **démarrage automatique** de l'application (Paramètres →
> Général) pour ne pas manquer une tâche planifiée en mode « Par l'app ».

Une section **Cron des serveurs** affiche, en lecture seule (hors tâches
créées par l'app), le contenu de la crontab de l'utilisateur SSH ainsi que
`/etc/crontab` et `/etc/cron.d` — pratique pour repérer une entrée
« orpheline » (créée par l'app pour une tâche depuis supprimée) et la retirer.

## Proxmox

Gère un ou plusieurs clusters Proxmox VE via un jeton d'API (créé dans
*Datacenter → Permissions → API Tokens*, avec au minimum les rôles
`PVEVMAdmin` pour piloter les VM et `PVEDatastoreUser` pour l'espace disque
des clones).

- **Santé du cluster** : état du quorum, nœuds en ligne/hors ligne, espace
  disque système, stockages (partagés ou non), santé SMART des disques.
- **Vider un nœud** (« Drain ») avant maintenance : propose une migration de
  tous les invités démarrés vers une cible compatible.
- **VM / conteneurs (CT)** : démarrer, arrêter, redémarrer, suspendre.
- **Snapshots** : créer, restaurer, cloner une VM/CT à partir d'un snapshot.
- **Migration** : à chaud (live) si possible, ou avec redémarrage sur la
  cible ; nécessite un stockage de même nom sur les deux nœuds (idéalement
  partagé : NFS/iSCSI) et aucun disque local non partagé.
- **Interface web** : un lien ouvre directement l'interface Proxmox
  correspondante (voir aussi *Onglets web* ci-dessous).

## Sauvegardes

Cette page suit les **jobs de sauvegarde Proxmox (vzdump)** : liste les jobs
planifiés, les invités couverts ou non par un job, la dernière archive lisible
pour chaque invité, et permet de lancer une sauvegarde immédiate vers un
stockage choisi (snapshot, compression zstd). Elle nécessite une connexion
Proxmox déjà configurée dans la page **Proxmox**.

> Ne pas confondre avec la **sauvegarde chiffrée `.spmbackup`** de la
> configuration de l'application elle-même, décrite dans
> [demarrage.md](demarrage.md#sauvegarde-et-restauration-spmbackup).

## Onglets web

Ouvre les interfaces web de tes services Proxmox ou TrueNAS **directement
dans l'application**, sous forme d'onglets, sans changer de fenêtre. Le bouton
*Ouvrir une interface web* propose les interfaces connues (déduites des
connexions Proxmox et des serveurs marqués TrueNAS) ; chaque onglet peut être
fermé indépendamment.

## Verrouillage / sécurité

**Paramètres → Sécurité** protège l'accès à l'application (et, avec un mot de
passe maître, aux secrets eux-mêmes).

| Méthode | Comportement |
|---|---|
| Aucun | comportement par défaut, pas de verrouillage |
| PIN | 4 à 12 chiffres, propre à Server Power Manager |
| Windows Hello | visage, empreinte ou PIN Windows ; un PIN de secours de l'app reste disponible si Hello échoue |

- **Verrouillage automatique** après une durée d'inactivité configurable, ou
  quand la session Windows se verrouille (<kbd>Win</kbd>+<kbd>L</kbd>, mise en
  veille), détecté uniquement sous Windows.
- **Verrouiller maintenant** : bouton dans les Paramètres, dans la barre
  latérale, ou raccourci <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>L</kbd>.
- Pendant le verrouillage : la collecte de ressources, les sondes qui portent
  un secret, les notifications dont le canal contient un secret, et les
  tâches planifiées d'arrêt/redémarrage sont **suspendues** ; le ping simple
  continue.

### Mot de passe maître (optionnel)

En plus de PIN/Windows Hello, un **mot de passe maître** peut chiffrer la clé
qui protège tous les secrets (Argon2id + AES-256-GCM), au lieu de la laisser
lisible dans le Gestionnaire d'identification Windows.

> **Attention**
> Avec un mot de passe maître actif, l'application démarre **verrouillée** et
> seul ce mot de passe la déverrouille — PIN et Windows Hello ne peuvent plus
> déchiffrer la clé. **Un mot de passe maître oublié rend tous les secrets
> définitivement irrécupérables** : aucune récupération n'est possible.

## Intégrations

**Paramètres → Intégrations** centralise les services externes, groupés par
catégorie. Les secrets saisis sont chiffrés avec la clé maître.

| Catégorie | Intégrations |
|---|---|
| Notifications | ntfy, Discord (webhook), Telegram (bot) |
| Supervision | Zabbix, Loki (logs), Home Assistant |
| Infrastructure | Nginx Proxy Manager, TrueNAS, Proxmox Backup Server, OPNsense, MikroTik |

Détails utiles pour la configuration :

- **ntfy** : indique le serveur, un topic (idéalement difficile à deviner) et
  éventuellement un jeton pour un topic protégé ; installe l'app ntfy sur ton
  téléphone et abonne-toi au même topic.
- **Discord** : URL de webhook (Paramètres du salon → Intégrations →
  Webhooks → Nouveau webhook).
- **Telegram** : jeton de bot créé via **@BotFather**, plus le Chat ID du
  destinataire.
- **Zabbix** : nécessite Zabbix ≥ 5.4 et un utilisateur avec droits d'écriture
  sur les groupes d'hôtes (pour créer des fenêtres de maintenance).
- **Loki** : les logs doivent déjà être envoyés à Loki (Promtail/Alloy) avec
  un label `host` ou `hostname`.
- **TrueNAS** : clé API (menu utilisateur → API Keys → Add) ; expose pools
  ZFS, datasets et SMART sans passer par SSH.
- **Home Assistant** : jeton d'accès longue durée (Profil → Sécurité →
  Jetons d'accès longue durée) ; chaque événement du homelab est publié comme
  type d'événement `server_manager_event`, exploitable dans tes automatisations.

Un bouton *Enregistrer et tester* valide la connexion immédiatement après la
sauvegarde.
