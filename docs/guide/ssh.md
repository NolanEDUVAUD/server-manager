# Authentification SSH

Server Power Manager se connecte à tes serveurs par SSH pour l'arrêt/
redémarrage, la console, les tâches en lot, le monitoring de ressources, etc.
Ce guide détaille les trois méthodes d'authentification disponibles, la
configuration d'un agent SSH sous Windows, le déploiement de clé, l'hôte de
rebond et le dépannage.

## Les trois méthodes

Le formulaire d'un serveur propose un choix **Authentification SSH** :

| Méthode | Fonctionnement |
|---|---|
| **Mot de passe** | Mot de passe enregistré, chiffré par la clé maître de l'application. |
| **Clé de l'app** | Clé SSH gérée dans **Paramètres → Clés SSH** ; la clé privée reste chiffrée dans l'app et n'est jamais exportée. |
| **Agent SSH** | Utilise les clés déjà chargées dans l'agent OpenSSH de Windows (`ssh-add`) ou dans Pageant (PuTTY). L'app ne stocke ni ne voit jamais la clé elle-même. |

> **Astuce — que choisir ?**
> - **Agent SSH** : pratique si tu as déjà un agent avec tes clés (partagé
>   avec d'autres outils comme Git ou WinSCP) ; l'app ne stocke rien.
> - **Clé de l'app** : la clé est chiffrée par la clé maître et gérée dans
>   l'application — le plus simple si tu n'as pas déjà d'agent.
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

## Agent SSH sous Windows

Un agent SSH garde les clés privées déchiffrées **en mémoire** et signe
l'authentification à ta place : l'app ne voit ni ne stocke jamais la clé
elle-même.

### Agent OpenSSH de Windows

Dans un **PowerShell en administrateur** :

```powershell
Get-Service ssh-agent | Set-Service -StartupType Automatic
Start-Service ssh-agent
ssh-add C:\chemin\vers\ta_cle
```

### Pageant (PuTTY)

1. Lance **Pageant**.
2. Dans son icône de la zone de notification, choisis **Add Key**.
3. Sélectionne ta clé `.ppk` (convertis d'abord une clé OpenSSH avec
   **PuTTYgen** si nécessaire).

### Tester l'agent

Dans le formulaire du serveur (méthode *Agent SSH*), le bouton **Tester
l'agent** interroge chaque source disponible et affiche :

- le nombre de clés trouvées par source (« ssh-agent (SSH_AUTH_SOCK) : 2
  clés », « Pageant : 1 clé »…) ;
- si une source est joignable mais vide : *« … : joignable, mais aucune clé
  chargée (ssh-add) »* ;
- si aucun agent n'est joignable du tout : *« Aucun agent SSH joignable »*,
  avec une astuce adaptée à la plateforme.

## Déployer une clé sur un serveur

Depuis la fiche d'un serveur, **Déployer une clé SSH** ajoute la clé publique
choisie à `~/.ssh/authorized_keys` du serveur, en se connectant avec la
méthode d'authentification actuelle du serveur (mot de passe, clé de l'app ou
agent).

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
| *Aucune clé chargée (ssh-add)* | L'agent répond mais aucune clé n'y est chargée | Charge une clé avec `ssh-add` (OpenSSH) ou *Add Key* (Pageant) |
| *Aucun agent SSH joignable* | Ni `SSH_AUTH_SOCK`, ni l'agent OpenSSH de Windows, ni Pageant ne répondent | Démarre le service `ssh-agent` ou lance Pageant, puis réessaie |
| *signature refusée par l'agent* | La clé est chargée mais le serveur distant refuse la signature | Vérifie que la clé publique correspondante est bien dans `authorized_keys` du serveur |
| *… : aucune clé acceptée par le serveur* | Les clés de l'agent ne correspondent à aucune clé autorisée sur le serveur | Déploie la bonne clé publique sur le serveur, ou choisis la bonne clé |
| *agent OpenSSH de Windows absent* | Le service `ssh-agent` de Windows n'est pas démarré | `Start-Service ssh-agent` (voir plus haut) |
| *Pageant non lancé* | Méthode Agent SSH choisie mais Pageant n'est pas actif | Lance Pageant et ajoute ta clé |
| *L'hôte de rebond de … n'existe plus* | Le serveur configuré comme rebond a été supprimé | Choisis un autre rebond, ou repasse en connexion directe |
| *… et … passent l'un par l'autre* (boucle de rebond) | Deux serveurs se désignent mutuellement comme rebond | Corrige la configuration de l'un des deux serveurs |
| *… ne peut pas être son propre hôte de rebond* | Un serveur se désigne lui-même comme rebond | Choisis un autre serveur, ou aucun |
| *Aucune clé SSH choisie pour … : modifie le serveur* | Méthode « Clé de l'app » sélectionnée sans clé choisie | Choisis une clé dans le formulaire du serveur |
| Connexion par clé refusée après déploiement | Droits incorrects sur le serveur, ou `PubkeyAuthentication` désactivé | Vérifie `~/.ssh` (700), `authorized_keys` (600), et que `PubkeyAuthentication yes` est actif dans la configuration `sshd` du serveur |

> **Astuce**
> Le serveur garde toujours sa méthode d'authentification actuelle tant que le
> déploiement d'une nouvelle clé n'a pas été vérifié avec succès : rien ne
> casse une connexion qui fonctionne déjà.
