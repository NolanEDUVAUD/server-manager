# Organisation — tags, dossiers, favoris, champs personnalisés, filtres, palette et raccourcis — Design

Date : 2026-09-25 · Fonctionnalité 1.7 · Branche : `feature/v2`

## Objectif
Retrouver vite un serveur ou un service quand le homelab grossit : les étiqueter (tags colorés), les ranger
(un dossier par élément), mettre en avant ceux qu'on utilise tout le temps (favoris), noter des informations
libres par serveur (emplacement, numéro de série, fin de garantie…), puis filtrer et agir au clavier.

Les **dossiers** servent au rangement et à l'affichage ; les **groupes** existants restent l'outil des
actions en lot (WoL, arrêt, ping d'un groupe). Un serveur a au plus un dossier mais peut appartenir à
plusieurs groupes.

## Modèle de données (`src-tauri/src/organisation.rs`)
- `Tag { id, name, color }` : nom de 1 à 32 caractères (espaces de bord retirés, pas de caractère de
  contrôle), unique sans tenir compte de la casse ; couleur `#rrggbb` (normalisée en minuscules).
  200 tags au plus.
- `Folder { id, name }` : nom de 1 à 40 caractères, unique sans tenir compte de la casse ; 100 dossiers au
  plus. Un seul espace de dossiers, partagé par les serveurs et les services (un dossier « Maison » peut
  contenir les deux).
- `CustomField { key, value }` : clé de 1 à 40 caractères, valeur de 500 caractères au plus, 20 champs par
  serveur au plus, clés uniques sans tenir compte de la casse, pas de caractère de contrôle.
- `AppData` (bloc « Organisation » en fin de struct) : `tags`, `folders`.
- `Server` (bloc « Organisation » en fin de struct) : `tag_ids`, `folder_id`, `favorite`, `custom_fields`.
- `Probe` (champs de données seulement, en fin de struct) : `tag_ids`, `folder_id`, `favorite`.
- Tous les nouveaux champs sont en `#[serde(default)]` : un ancien `data.json` se charge sans eux.
- `ServerPayload` : `tag_ids`, `folder_id`, `favorite`, `custom_fields` optionnels. `None` = inchangé lors
  d'une modification (un formulaire qui ne connaît pas ces champs ne les efface pas) ; `folder_id = ""` =
  retirer le dossier.

Les références sont toujours assainies côté Rust : identifiants de tags inconnus ignorés, doublons retirés,
dossier inconnu remplacé par « sans dossier ».

## Commandes Tauri (`commands/organisation.rs`)
| Commande | Rôle |
|---|---|
| `get_organisation()` | `{ tags, folders }` |
| `save_tag(tag)` | crée (`id` vide) ou modifie un tag |
| `delete_tag(id)` | supprime le tag et le retire de tous les serveurs et services |
| `save_folder(folder)` | crée (`id` vide) ou renomme un dossier |
| `delete_folder(id)` | supprime le dossier ; ses éléments passent « sans dossier » (ils ne sont pas supprimés) |
| `toggle_favorite(kind, id)` | bascule le favori d'un serveur (`server`) ou d'un service (`probe`), renvoie le nouvel état |

`update_server` / `add_server` acceptent les nouveaux champs ; `save_probe` assainit les tags et le dossier
de la sonde reçue.

## Import / export
Tags, dossiers, favoris et champs personnalisés ne sont pas des secrets : ils voyagent dans
`export_config` (copie d'`AppData` sans secrets) et dans `export_full_config` (`tags`, `folders` au niveau
racine, champs d'organisation dans chaque serveur).
- Import (`import_config`, `import_full_config` + `apply_import_config`) : tout est revalidé (tags et
  dossiers invalides écartés, champs personnalisés invalides retirés, références assainies).
- Fusion : un tag ou dossier importé dont le nom existe déjà est rattaché à l'existant (les serveurs
  importés sont réécrits vers l'identifiant local) ; les autres sont ajoutés dans la limite des plafonds.
- Remplacement : tags et dossiers remplacés, puis références des services (non remplacés) assainies.
- Fichier importé limité à 10 Mo.

## Frontend
- `src/utils/filters.ts` (pur, testé) : critères combinés — texte (nom, IP, OS, notes, valeurs des champs
  personnalisés, noms des tags ; plusieurs mots = ET ; sans casse ni accents), tags (plusieurs = ET),
  dossier (un dossier précis ou « sans dossier »), favoris seulement, statut en ligne / hors ligne (un
  statut inconnu ne correspond à aucun des deux). Tri stable favoris d'abord, regroupement par dossier
  (dossiers par ordre alphabétique, « Sans dossier » à la fin).
- `src/utils/organisation.ts` (pur, testé) : validation miroir (couleur, longueurs), couleur de texte
  lisible sur un fond de tag, détection des clés qui ressemblent à un secret (password, mot de passe,
  token, secret, api key, clé privée…).
- Store : `tags`, `folders`, actions CRUD, `toggleFavorite`, état des filtres par page (`servers`,
  `services`) conservé en mémoire pour la session.
- Pages Serveurs et Services : barre de filtres, affichage par dossier (un niveau), favoris en tête, étoile,
  tags sur les cartes, état vide « Aucun résultat pour ces filtres » + « Effacer les filtres ».
  Gestion des tags et dossiers dans une fenêtre « Organiser » (suppression avec confirmation qui dit ce
  qui va se passer).
- Formulaire serveur : tags, dossier, champs personnalisés (avertissement « non chiffrés » permanent, et
  avertissement renforcé si une clé ressemble à un secret). Formulaire de sonde : tags et dossier.
- Palette (Ctrl+K) : pour chaque serveur, « Réveiller », « Arrêter », « Redémarrer », « Ouvrir la console
  sur », « Pinger », « Modifier ». Réveil, arrêt et redémarrage passent par `ConfirmDialog` avec un texte
  précis (commande exécutée, adresse) et réutilisent les actions du store.
- Raccourcis : table unique `src/utils/shortcuts.ts` lue par le gestionnaire clavier (`useShortcuts`) et par
  l'aide (`?`). Existant avant cette version : Ctrl+K, Échap (palette), ↑ ↓ Entrée (palette). Nouveaux :
  `?` (aide), `/` (recherche de la page), `g` puis `d` / `s` / `v` / `c` / `p` (aller au tableau de bord,
  aux serveurs, aux services, à la console, aux paramètres), Échap ferme aussi l'aide et les confirmations.
  Les raccourcis à une touche sont ignorés dans les champs de saisie (et donc dans la console SSH).

## Sécurité
- Aucun secret : l'interface le dit à côté des champs personnalisés et avertit si une clé ressemble à un
  secret. Les valeurs ne sont jamais envoyées à un shell.
- Toutes les entrées sont validées côté Rust (tailles, nombre, couleurs, références).

## Tests
- Rust : validation (couleur, longueurs, nombre de champs, unicité), suppression d'un tag / dossier qui
  nettoie les références (serveurs et services), désérialisation d'un ancien `data.json` sans ces champs,
  export / import aller-retour (fusion et remplacement), assainissement d'un import invalide.
- Vitest : `filters.ts` (chaque critère seul et combinés, casse et accents, tri favoris d'abord,
  regroupement par dossier), `organisation.ts`, table des raccourcis ↔ aide ↔ gestionnaire clavier,
  palette (actions serveur présentes, arrêt / redémarrage / réveil derrière une confirmation).

## Limites connues
- Un seul niveau de dossiers (pas de sous-dossiers), un dossier par élément.
- `export_full_config` n'exporte pas les services (comportement antérieur) : l'organisation des services
  voyage seulement avec `export_config`.
- L'état des filtres est conservé en mémoire : il est perdu à la fermeture de l'application.
