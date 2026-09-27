# Démarrage

Ce guide couvre l'installation, le premier lancement, les mises à jour, la
désinstallation et la sauvegarde/restauration de la configuration.

## Installation

Server Power Manager est une application Windows. Télécharge l'installateur de
la [dernière version](https://github.com/NolanEDUVAUD/server-manager/releases/latest) :

| Fichier | Usage |
|---|---|
| `ServerPowerManager_x.y.z_x64-setup.exe` | Installateur recommandé, sans droits administrateur |
| `ServerPowerManager_x.y.z_x64.msi` | Pour un déploiement MSI |

> **Attention**
> L'installateur n'est pas signé par un certificat commercial. Si Windows
> SmartScreen s'affiche (« Windows a protégé votre ordinateur »), clique sur
> *Informations complémentaires*, puis *Exécuter quand même*.

### Étapes

1. Lance l'installateur téléchargé.
2. Accepte le **contrat de licence utilisateur final (EULA)** affiché pendant
   l'installation. Le contrat interdit notamment toute monétisation de
   l'application sans l'accord écrit préalable de l'auteur (voir
   [CONTRIBUTING.md](../CONTRIBUTING.md)).
3. Laisse l'installation se terminer, puis lance l'application.

Le contrat est rédigé en anglais. L'application le fait aussi accepter au premier
lancement (et à nouveau si son texte change) ; il reste consultable à tout moment
depuis **Paramètres → À propos → Contrat de licence (EULA)**.

## Premier lancement

Au tout premier démarrage, un **écran d'accueil** s'affiche :

1. Une phrase rappelle que les mots de passe et jetons sont chiffrés, avec une
   clé gardée dans le **Gestionnaire d'identification Windows**.
2. Choisis les **modules** à afficher dans la barre latérale (un bouton *Tout*
   les sélectionne tous). Rien n'est perdu si tu changes d'avis : ce choix se
   modifie à tout moment dans **Paramètres → Général → Modules**.

| Module | Description |
|---|---|
| Arrêt / démarrage | Éteindre ou rallumer tout le lab dans le bon ordre |
| Ressources | CPU, RAM et disques des serveurs en temps réel |
| Console SSH | Terminal SSH intégré avec onglets |
| Historique | Journal des coupures, redémarrages et actions |
| Alertes | Notifications ntfy, Discord, Telegram… |
| Réseau | Appareils du réseau local et adresses MAC |
| Docker | Conteneurs et images des hôtes Docker |
| Tâches en lot | Un script sur plusieurs serveurs, playbooks Ansible |
| Mises à jour | Paquets apt en attente et conteneurs dépassés |
| Logs | Journaux centralisés dans Grafana Loki |
| Planificateur | Tâches programmées et cronjobs sur les serveurs |
| Proxmox | Cluster Proxmox VE : VM, conteneurs, sauvegardes, migration |
| Onglets web | Interfaces web des services dans l'application |

3. Clique sur **Commencer**.

### Tour de présentation

Un petit tour guidé s'affiche ensuite, page par page (bienvenue, serveurs et
groupes, dashboard et supervision, console SSH, tâches en lot, réseau,
personnalisation, paramètres). Utilise *Suivant* / *Précédent*, ou *Passer*
pour l'ignorer.

> **Astuce**
> Le tutoriel peut être revu à tout moment depuis
> **Paramètres → À propos → Revoir le tutoriel**.

### Ajouter ton premier serveur

1. **Serveurs → Ajouter** : nom, IP, adresse MAC, utilisateur et mot de passe
   (ou clé) SSH, type d'OS. La commande d'arrêt est pré-remplie selon l'OS et
   reste modifiable.
2. **Wake-on-LAN** : active le WoL dans le BIOS/UEFI et sur la carte réseau de
   chaque machine. Un broadcast personnalisé peut être défini par serveur.
3. **Arrêt SSH** : l'utilisateur doit pouvoir exécuter la commande d'arrêt
   (par exemple via `sudo` sans mot de passe pour `shutdown`). La clé d'hôte
   de chaque serveur est mémorisée à la première connexion, puis vérifiée
   ensuite.
4. **Proxmox** (optionnel) : crée un jeton d'API (*Datacenter → Permissions →
   API Tokens*) et renseigne-le dans l'app.
5. **Paramètres → Intégrations** (optionnel) : notifications ntfy, Discord,
   Telegram, Loki, etc. — voir [fonctionnalites.md](fonctionnalites.md).

## Mises à jour

L'application peut se mettre à jour elle-même, avec vérification de
signature.

### Vérification automatique

Dans **Paramètres → Mise à jour** :

| Réglage | Effet |
|---|---|
| *Vérifier les mises à jour au démarrage* | Activé par défaut. Recherche silencieuse à l'ouverture de l'app. |
| *Rechercher des mises à jour* | Recherche manuelle immédiate. |
| *Afficher la bannière* | Affiche à nouveau la bannière de mise à jour en haut de la fenêtre si elle a été fermée. |

### Comment ça marche

1. L'application lit le manifeste `latest.json` de la dernière release
   publiée sur GitHub.
2. Si une version plus récente existe, une **bannière** affiche son numéro et
   ses notes de version. **Rien n'est installé sans confirmation.**
3. En cliquant sur *Installer et redémarrer*, une boîte de dialogue récapitule
   ce qui va se passer : téléchargement depuis GitHub, **vérification de la
   signature** avec la clé publique intégrée à l'application (un paquet non
   signé ou modifié est refusé), puis remplacement et redémarrage
   automatiques.
4. Une barre de progression détaille les étapes : préparation, téléchargement,
   vérification de la signature, installation.

> **Attention**
> Les tâches en cours (consoles SSH, tâches en lot, arrêt/démarrage du lab…)
> sont interrompues pendant l'installation de la mise à jour.

Si la mise à jour automatique n'est pas disponible pour l'installation en
cours (paquet non signé pour cette version, par exemple), la page de la
version s'ouvre dans le navigateur pour une installation manuelle : rien
n'est alors téléchargé ni modifié automatiquement par l'application.

### Quoi de neuf ?

Après une mise à jour installée, une fenêtre **« Quoi de neuf dans la version
X »** peut s'afficher au lancement suivant pour résumer les nouveautés.

## Désinstallation

Utilise le désinstallateur Windows habituel (*Paramètres → Applications*, ou
le raccourci créé par l'installateur NSIS/MSI). La désinstallation ne
supprime pas automatiquement le dossier de données (voir ci-dessous) : les
serveurs, groupes et paramètres restent disponibles si l'application est
réinstallée plus tard.

## Emplacement des données

Toute la configuration est stockée localement, dans :

```
%APPDATA%\com.homelab.server-manager\
```

| Fichier / élément | Contenu |
|---|---|
| `data.json` | Serveurs, groupes, paramètres, tags, dossiers, intégrations (secrets chiffrés) |
| `history.db` | Historique SQLite : événements, ping, contrôles de services, métriques de ressources |
| Gestionnaire d'identification Windows | Clé maître qui chiffre tous les secrets (AES-256-GCM) |

Voir la section *Données et sécurité* du [README](../../README.md) pour le
détail du modèle de chiffrement.

## Sauvegarde et restauration (`.spmbackup`)

Depuis **Paramètres → Configuration → Sauvegarde chiffrée**, toute la
configuration (y compris les secrets) peut être exportée dans un fichier
`.spmbackup`, protégé par une **phrase de passe** (Argon2id + AES-256-GCM, en-
tête authentifié). Sans cette phrase de passe, le fichier est illisible :
personne ne peut le récupérer, y compris l'auteur de l'application.

### Exporter une sauvegarde manuelle

1. **Paramètres → Configuration → Sauvegarde chiffrée**.
2. Saisis une phrase de passe (12 caractères minimum ; une phrase de
   plusieurs mots est plus sûre et plus facile à retenir) et confirme-la.
3. Clique sur *Exporter une sauvegarde chiffrée…* et choisis où enregistrer le
   fichier `.spmbackup`.

### Restaurer une sauvegarde

1. Toujours dans **Paramètres → Configuration → Sauvegarde chiffrée**, section
   *Restaurer une sauvegarde*.
2. Choisis le fichier `.spmbackup`, saisis la phrase de passe utilisée à
   l'export.
3. Un récapitulatif s'affiche (nombre de serveurs, groupes, services,
   connexions Proxmox, intégrations, tâches planifiées, date et version de la
   sauvegarde) avant de confirmer.

> **Attention**
> Restaurer remplace **toute** la configuration actuelle. Une copie de la
> configuration précédente est conservée à côté des données
> (`data.json.before-restore.bak`). Le verrouillage et la sauvegarde
> automatique propres à ce PC ne sont pas affectés par la restauration.

### Sauvegarde automatique

La même section permet d'activer une **sauvegarde automatique** vers un
dossier (disque externe, NAS monté…) :

- fréquence quotidienne ou hebdomadaire ;
- nombre de sauvegardes conservées (rotation) ;
- la phrase de passe est elle-même chiffrée par la clé maître de l'app, donc
  jamais stockée en clair sur le disque ;
- aucune sauvegarde automatique n'est effectuée pendant que l'application est
  verrouillée (voir [fonctionnalites.md](fonctionnalites.md#verrouillage--sécurité)).

Un export JSON simple (sans secrets) est également disponible dans
**Paramètres → Configuration → Exporter la configuration** : pratique pour
partager une configuration sans divulguer de mot de passe, mais les secrets
devront être ressaisis après un import.
