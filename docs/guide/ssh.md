# Authentification SSH

Server Power Manager se connecte à tes serveurs par SSH pour l'arrêt/
redémarrage, la console, les tâches en lot, le monitoring de ressources, etc.
Ce guide détaille les deux méthodes d'authentification disponibles, le
déploiement de clé, l'hôte de rebond et le dépannage.

## Les deux méthodes

Le formulaire d'un serveur propose un choix **Authentification SSH** :

| Méthode | Fonctionnement |
|---|---|
| **Mot de passe** | Mot de passe enregistré, chiffré par la clé maître de l'application. |
| **Clé de l'app** | Clé SSH gérée dans **Paramètres → Clés SSH** ; la clé privée reste chiffrée dans l'app et n'est jamais exportée. |

> **Astuce — que choisir ?**
> - **Clé de l'app** : la clé est chiffrée par la clé maître et gérée dans
>   l'application — le plus simple, et le plus sûr (jamais rejouable, ne
>   dépend pas de la politique de mot de passe du serveur).
> - **Mot de passe** : le plus rapide à mettre en place, mais le moins sûr
>   (rejouable, dépend de la politique du serveur).

Si aucune clé n'est enregistrée, l'application le rappelle : *« Aucune clé SSH
enregistrée : crée ou importe une clé dans Paramètres → Clés SSH »*.

Les **clés d'hôte** de chaque serveur sont mémorisées à la première connexion,
puis vérifiées à chaque connexion suivante (y compris pour chaque saut via un
hôte de rebond).

## Clés SSH gérées par l'app

Dans **Paramètres → Clés SSH** :

- génère une paire **ed25519** directement dans l'app (recommandé — voir
  l'avis de sécurité sur RSA dans le README), ou importe une clé existante au
  format OpenSSH ou PuTTY (`.ppk`) ;
- seule la **clé publique** est jamais affichée ou exportable ; la clé privée
  reste chiffrée par la clé maître ;
- **Déployer la clé sur un serveur en un clic** : voir la section suivante.

## Déployer une clé sur un serveur

Depuis la fiche d'un serveur, **Déployer une clé SSH** ajoute la clé publique
choisie à `~/.ssh/authorized_keys` du serveur, en se connectant avec la
méthode d'authentification actuelle du serveur (mot de passe ou clé de l'app).

1. Choisis la clé à déployer.
2. L'app crée `~/.ssh` (droits 700) et `authorized_keys` (droits 600) s'ils
   n'existent pas ; la ligne n'est jamais ajoutée deux fois si elle est déjà
   présente.
3. La connexion par clé est ensuite **vérifiée automatiquement**.
4. En cas de succès, l'app propose de **basculer** le serveur sur cette clé
   pour toutes ses connexions futures (tu peux aussi garder la méthode
   actuelle).

> **Attention — cas particuliers**
> - **Windows (serveur cible)** : le déploiement automatique est impossible.
>   OpenSSH y lit `C:\ProgramData\ssh\administrators_authorized_keys` pour les
>   comptes administrateurs : copie la clé publique depuis Paramètres → Clés
>   SSH et ajoute-la toi-même.
> - **ESXi** : impossible aussi — les clés se trouvent dans
>   `/etc/ssh/keys-<utilisateur>/authorized_keys`. Ajoute la clé publique
>   depuis l'interface ESXi.
> - **TrueNAS** : le middleware peut régénérer `authorized_keys` ; ajoute
>   aussi la clé dans *Identifiants → Utilisateurs* pour qu'elle soit
>   conservée après une régénération.

## Hôte de rebond (jump host)

Un serveur peut être configuré pour passer par un **hôte de rebond** :
la connexion transite par ce serveur intermédiaire (tunnel SSH), et la clé
d'hôte de chaque saut est vérifiée indépendamment.

- Un seul niveau de rebond est autorisé : un serveur qui sert déjà de rebond à
  d'autres ne peut pas lui-même passer par un rebond.
- Un serveur ne peut pas être son propre hôte de rebond, ni créer une boucle
  (deux serveurs qui se rebondissent mutuellement).

## Dépannage

| Message | Cause | À faire |
|---|---|---|
| *… cette machine utilisait l'agent SSH, qui n'est plus pris en charge* | Un serveur enregistré avant la version qui a retiré l'agent SSH utilisait encore cette méthode | Choisis un mot de passe ou une clé dans les paramètres de ce serveur |
| *L'hôte de rebond de … n'existe plus* | Le serveur configuré comme rebond a été supprimé | Choisis un autre rebond, ou repasse en connexion directe |
| *… et … passent l'un par l'autre* (boucle de rebond) | Deux serveurs se désignent mutuellement comme rebond | Corrige la configuration de l'un des deux serveurs |
| *… ne peut pas être son propre hôte de rebond* | Un serveur se désigne lui-même comme rebond | Choisis un autre serveur, ou aucun |
| *Aucune clé SSH choisie pour … : modifie le serveur* | Méthode « Clé de l'app » sélectionnée sans clé choisie | Choisis une clé dans le formulaire du serveur |
| Connexion par clé refusée après déploiement | Droits incorrects sur le serveur, ou `PubkeyAuthentication` désactivé | Vérifie `~/.ssh` (700), `authorized_keys` (600), et que `PubkeyAuthentication yes` est actif dans la configuration `sshd` du serveur |

> **Astuce**
> Le serveur garde toujours sa méthode d'authentification actuelle tant que le
> déploiement d'une nouvelle clé n'a pas été vérifié avec succès : rien ne
> casse une connexion qui fonctionne déjà.
