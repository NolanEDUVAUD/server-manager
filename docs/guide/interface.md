# Interface

Ce guide décrit la barre latérale, la palette de commandes, les raccourcis
clavier, les thèmes et les langues.

## Barre latérale

La barre latérale liste les pages activées (modules) : Dashboard, Serveurs,
Groupes, Arrêt / démarrage, Ressources, Réseau, Docker, Console, Tâches en
lot, Mises à jour, Historique, Logs, Alertes, Planificateur, Proxmox,
Sauvegardes, Onglets web, Paramètres.

- Le **numéro de version** de l'application est affiché dans la barre
  latérale.
- Un compteur **« X/Y en ligne »** indique combien de serveurs répondent.
- Un bouton **Verrouiller** est disponible si le verrouillage est configuré
  (voir [fonctionnalites.md](fonctionnalites.md#verrouillage--sécurité)).

### Favoris

- **Glisse un onglet** de la barre latérale vers la zone *Favoris* pour
  l'épingler en haut.
- Si aucun favori n'est défini, la zone affiche *« Glissez un onglet ici »*.
- Un bouton dédié permet d'ajouter (*Ajouter aux favoris*) ou de retirer
  (*Retirer des favoris*) un onglet.

### Réorganiser les onglets

Les onglets de la barre latérale se réorganisent par **glisser-déposer**. Le
bouton **Réinitialiser l'ordre des onglets** (dans *Personnaliser*, voir
ci-dessous) remet l'ordre par défaut.

### Redimensionner la barre latérale

La barre latérale se redimensionne en faisant glisser son bord droit.
**Double-clique** sur le bord pour revenir à la largeur par défaut.

### Personnaliser

Le bouton **Personnaliser** ouvre un panneau d'apparence rapide :

| Réglage | Valeurs |
|---|---|
| Densité des pages | Compact / Normal / Spacieux |
| Réinitialiser l'ordre des onglets | remet l'ordre de la barre latérale par défaut |

D'autres réglages d'apparence (luminosité, taille de police, thème) se
trouvent dans **Paramètres → Apparence**.

## Palette de commandes

<kbd>Ctrl</kbd>+<kbd>K</kbd> ouvre (ou ferme) la **palette de commandes** :
recherche de pages et d'actions sur un serveur précis (réveiller, arrêter,
redémarrer, ouvrir une console, pinger, modifier).

- <kbd>↑</kbd> / <kbd>↓</kbd> déplacent la sélection, <kbd>Entrée</kbd>
  exécute l'action sélectionnée.
- Toute action qui agit sur une machine (arrêt, redémarrage, Wake-on-LAN…)
  demande une **confirmation** avant exécution, avec le détail de la commande
  SSH exécutée le cas échéant.
- Le champ accepte une recherche approximative (le placeholder donne
  l'exemple « cons mini », « arr mini » pour ouvrir une console ou lancer un
  arrêt sur un serveur nommé « mini »).
- <kbd>Échap</kbd> ferme la palette.

## Raccourcis clavier

L'aide s'ouvre avec <kbd>?</kbd> (ou l'action *Afficher les raccourcis
clavier* dans la palette). Elle est générée depuis la même table que le
gestionnaire clavier (`src/utils/shortcuts.ts`), qui est donc la source de
vérité pour cette liste.

| Raccourci | Action |
|---|---|
| <kbd>Ctrl</kbd>+<kbd>K</kbd> | Ouvrir ou fermer la palette de commandes |
| <kbd>↑</kbd> <kbd>↓</kbd> <kbd>Entrée</kbd> | Dans la palette : sélectionner et exécuter une action |
| <kbd>Échap</kbd> | Fermer la palette, l'aide des raccourcis ou une confirmation |
| <kbd>Ctrl</kbd>+<kbd>Maj</kbd>+<kbd>L</kbd> | Verrouiller l'application maintenant |
| <kbd>?</kbd> | Afficher l'aide des raccourcis |
| <kbd>/</kbd> | Aller à la recherche (page courante) |
| <kbd>g</kbd> puis <kbd>d</kbd> | Aller au Dashboard |
| <kbd>g</kbd> puis <kbd>s</kbd> | Aller aux Serveurs |
| <kbd>g</kbd> puis <kbd>c</kbd> | Aller à la Console |
| <kbd>g</kbd> puis <kbd>p</kbd> | Aller aux Paramètres |

Les raccourcis à une touche (<kbd>?</kbd>, <kbd>/</kbd>, les séquences
<kbd>g</kbd>+lettre) sont ignorés pendant la saisie dans un champ de texte, et
dans la console SSH — pour ne jamais interférer avec ce que tu tapes.
<kbd>Ctrl</kbd>+<kbd>K</kbd> et <kbd>Échap</kbd>, en revanche, fonctionnent
même en train de taper.

> **Astuce**
> La séquence à deux touches (<kbd>g</kbd> puis une lettre) doit être tapée
> dans la seconde et demie qui suit la première touche, sinon elle est
> oubliée.

## Thèmes et langue

**Paramètres → Apparence** propose les thèmes suivants : One Half Dark,
Fluent, Gruvbox Dark, Nord, Dracula, Catppuccin Mocha, Tokyo Night, ou un
thème personnalisé (créé en copiant un thème existant puis en ajustant ses
couleurs). Les extensions communautaires peuvent aussi ajouter des thèmes,
voir [../extensions.md](../extensions.md).

**Paramètres → Général** permet de choisir la langue : français (par défaut)
ou anglais.

## Bannière de soutien

Une bannière discrète peut proposer de soutenir le développement du projet ou
de mettre une étoile sur GitHub (boutons *Soutenir* / *Plus tard* / *Ne plus
afficher*). Voir aussi
[signaler-un-probleme.md](signaler-un-probleme.md#soutenir-le-projet).

## Persistance de la saisie

Le texte en cours de saisie dans un formulaire (par exemple un script de
tâche en lot) est conservé lorsque tu changes de page puis reviens, tant que
l'application reste ouverte — pratique pour comparer une valeur affichée sur
une autre page sans perdre ce que tu étais en train d'écrire.
