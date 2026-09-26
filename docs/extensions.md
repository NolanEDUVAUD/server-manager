# Extensions communautaires

Server Power Manager peut charger des **extensions communautaires** : des
paquets qui ajoutent des commandes mémorisées (snippets), des thèmes ou des
liens web, **sans jamais exécuter de code**.

## Concepts et modèle de sécurité

L'application garde des clés SSH et des identifiants de services en local.
Une extension qui pourrait exécuter du code arbitraire (JavaScript, script
shell, plugin binaire…) serait une porte dérobée vers ces secrets. Le format
d'extension est donc **strictement déclaratif** :

- une extension est un unique fichier `manifest.json` ;
- aucun champ ne contient de code, d'expression `eval`, ni de script à
  exécuter ;
- les seules actions autorisées sont celles déjà proposées nativement par
  l'application : insérer une commande dans le terminal (jamais l'exécuter
  automatiquement), appliquer une palette de couleurs, afficher un lien ;
- les seules requêtes réseau que l'app fait pour une extension sont : lire le
  fichier `manifest.json`, en local ou via une URL **https://** — rien
  d'autre. Le téléchargement depuis une URL passe par une commande Rust dédiée
  (jamais par un `fetch()` du frontend, bloqué par la CSP de l'application),
  en HTTPS uniquement, avec une taille bornée à **256 Ko** (le flux est lu par
  morceaux, donc un en-tête `Content-Length` mensonger ne permet pas de
  dépasser la limite).

Le manifeste est validé par un schéma strict côté application
(`src/utils/extensions.ts`) : type et longueur de chaque champ, format de
l'identifiant, semver, URLs en https uniquement, et **toute clé inconnue est
refusée**, à chaque niveau de l'objet. Un manifeste qui ne passe pas cette
validation n'est pas installé, et la liste complète des erreurs trouvées est
affichée (voir [Dépannage](#dépannage-des-erreurs-de-validation)).

> **Attention**
> Les extensions communautaires ne sont pas vérifiées par l'éditeur de
> l'application. N'installe que celles dont tu connais la source.

## Référence complète du manifeste

### Champs de premier niveau

| Champ | Type | Obligatoire | Contrainte |
|---|---|:---:|---|
| `id` | string | oui | Identifiant façon reverse-DNS : minuscules, chiffres, points et tirets, `^[a-z0-9]+(\.[a-z0-9-]+)*$`, **100 caractères max**. Exemple : `io.github.alice.homelab-extras`. |
| `name` | string | oui | Nom affiché, **80 caractères max**. |
| `version` | string | oui | Semver (`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`), ex. `1.2.0`, `2.0.0-beta.1`. **32 caractères max**. |
| `author` | string | oui | Auteur ou organisation, **80 caractères max**. |
| `description` | string | oui | Description courte, **400 caractères max**. |
| `homepage` | string | non | URL **https://** uniquement, **500 caractères max**. |
| `minAppVersion` | string | non | Version minimale de l'app, au format semver — voir [Versionnage](#versionnage-et-minappversion). |
| `contributes` | objet | non | Voir ci-dessous. Aucune clé en dehors de `id`, `name`, `version`, `author`, `description`, `homepage`, `minAppVersion`, `contributes` n'est acceptée à la racine ; aucune clé en dehors de `snippets`, `themes`, `webLinks` n'est acceptée dans `contributes`. |

La **taille totale** du manifeste (fichier local ou réponse HTTP) est limitée
à **256 Ko**, appliqué à la fois côté frontend (validation) et côté backend
(lecture de fichier et téléchargement).

### `contributes.snippets`

Liste de commandes mémorisées (**50 entrées max**), identiques à celles déjà
proposées dans la console SSH : elles sont **insérées** dans le terminal
actif, jamais exécutées automatiquement.

| Champ | Type | Obligatoire | Contrainte |
|---|---|:---:|---|
| `name` | string | oui | **60 caractères max**. |
| `command` | string | oui | Une seule ligne (pas de retour à la ligne), **500 caractères max**. |
| `description` | string | non | **200 caractères max**. |

### `contributes.themes`

Liste de thèmes (**10 entrées max**), même format que les thèmes personnalisés
créés dans **Paramètres → Apparence**.

| Champ | Type | Obligatoire | Contrainte |
|---|---|:---:|---|
| `id` | string | oui | Minuscules, chiffres, tirets : `^[a-z0-9]+(-[a-z0-9]+)*$`. |
| `name` | string | oui | **60 caractères max**. |
| `colors` | objet `{ variable: css }` | oui | Au moins une entrée, **40 variables max**, chaque valeur **64 caractères max**. |

Une variable de couleur non reconnue par l'application est simplement ignorée
à l'affichage (elle ne casse pas la validation). Les **20 variables** que
l'application connaît réellement (thèmes intégrés et personnalisés,
`src/utils/theme.ts`) sont :

```
--bg-primary        --bg-secondary       --bg-tertiary
--bg-input          --bg-hover           --bg-active
--text-primary      --text-secondary     --text-muted
--accent-primary    --accent-secondary   --accent-success
--accent-warning    --accent-error       --accent-info
--border-primary    --border-secondary
--scrollbar-thumb   --scrollbar-track
```

> **Astuce**
> Un thème d'extension n'a pas besoin de fournir les 20 variables : celles qui
> manquent conservent la valeur du thème de base actif. Fournir au moins les
> `--bg-*`, `--text-*` et `--accent-*` suffit généralement à obtenir un rendu
> cohérent.

### `contributes.webLinks`

Liste de liens (**20 entrées max**), affichés dans **Paramètres → Extensions**
à côté de l'extension qui les fournit.

| Champ | Type | Obligatoire | Contrainte |
|---|---|:---:|---|
| `name` | string | oui | **60 caractères max**. |
| `url` | string | oui | URL **https://** uniquement, **500 caractères max**. |

## Exemple de manifeste complet

Cet exemple valide intégralement le schéma ci-dessus (il est repris tel quel
dans [`docs/examples/homelab-extras/manifest.json`](examples/homelab-extras/manifest.json),
et sa validité est vérifiée par un test automatisé,
`src/utils/extensions.docs.test.ts`) :

```json
{
  "id": "io.github.alice.homelab-extras",
  "name": "Homelab Extras",
  "version": "1.2.0",
  "author": "Alice",
  "description": "Quelques commandes et un thème pour mon homelab Proxmox + ZFS.",
  "homepage": "https://github.com/alice/homelab-extras",
  "minAppVersion": "0.3.0",
  "contributes": {
    "snippets": [
      { "name": "ZFS ARC", "command": "arcstat", "description": "Statistiques du cache ARC ZFS" },
      { "name": "Températures NVMe", "command": "nvme smart-log /dev/nvme0" }
    ],
    "themes": [
      {
        "id": "homelab-extras-sunset",
        "name": "Sunset",
        "colors": {
          "--bg-primary": "#1a1025",
          "--bg-secondary": "#140c1c",
          "--bg-tertiary": "#221530",
          "--bg-input": "#140c1c",
          "--bg-hover": "#2b1a3d",
          "--bg-active": "#35204a",
          "--text-primary": "#f4e9ff",
          "--text-secondary": "#c9b8db",
          "--text-muted": "#8a7599",
          "--accent-primary": "#ff7a59",
          "--accent-secondary": "#ffb26b",
          "--accent-success": "#7ee081",
          "--accent-warning": "#ffd166",
          "--accent-error": "#ff5d5d",
          "--accent-info": "#7ac3ff",
          "--border-primary": "#3a2650",
          "--border-secondary": "#221530",
          "--scrollbar-thumb": "#3a2650",
          "--scrollbar-track": "#140c1c"
        }
      }
    ],
    "webLinks": [
      { "name": "Documentation", "url": "https://github.com/alice/homelab-extras#readme" }
    ]
  }
}
```

## Créer sa première extension

1. Crée un fichier texte nommé `manifest.json`.
2. Renseigne au minimum les cinq champs obligatoires : `id`, `name`,
   `version`, `author`, `description`.
3. Ajoute une section `contributes` avec au moins un snippet, thème ou lien
   (une extension sans `contributes` est valide mais n'apporte rien).
4. Vérifie que ton `id` suit bien le format reverse-DNS (par exemple
   `io.github.<pseudo>.<nom-du-projet>`), en minuscules.
5. Installe le fichier depuis **Paramètres → Extensions** (voir ci-dessous) et
   corrige les éventuelles erreurs affichées.

## Installer, activer, désinstaller

Depuis **Paramètres → Extensions** :

- **Depuis un fichier** : choisis un fichier `manifest.json` sur ton disque
  (limité à 256 Ko).
- **Depuis une URL** : colle une URL **https://** pointant vers un
  `manifest.json` (le téléchargement se fait côté application, borné à
  256 Ko, et refuse tout ce qui n'est pas en https).

Dans les deux cas, le manifeste est validé avant d'être installé ; toute
erreur est affichée en détail (champ concerné et raison du rejet).

Une fois installée, chaque extension listée propose :

- **Activer / Désactiver** : une extension désactivée voit toutes ses
  contributions (snippets, thèmes, liens) immédiatement retirées des listes,
  sans rien supprimer — elle peut être réactivée à tout moment.
- **Désinstaller** : retire l'extension et ses contributions. Une
  confirmation rappelle que ses commandes, thèmes et liens vont disparaître.
- Installer à nouveau un manifeste avec le **même `id`** qu'une extension déjà
  installée **remplace** cette dernière (mise à jour), plutôt que de créer un
  doublon.

## Espace de noms

Toute contribution d'une extension est identifiée sous la forme
`ext:<id-extension>:<nom>`, pour ne jamais entrer en collision avec un élément
natif de l'application ni avec une autre extension. C'est ce préfixe qui
permet à l'application de retirer proprement les contributions d'une
extension désactivée ou désinstallée, sans toucher aux éléments natifs ou à
ceux d'une autre extension.

## Versionnage et `minAppVersion`

Le champ `version` de l'extension suit le format **semver**
(`MAJOR.MINOR.PATCH`, avec un suffixe de pré-version optionnel comme
`-beta.1`) ; il sert à distinguer les mises à jour d'une même extension.

`minAppVersion`, également en semver, documente la version minimale de
l'application pour laquelle l'extension a été conçue. Il est **validé pour
son format** (rejeté s'il n'est pas un semver valide), mais il est
**informatif** : l'installation n'est aujourd'hui **pas bloquée** si la
version installée de l'application est inférieure à `minAppVersion`. Indique
cette valeur pour informer les utilisateurs, mais ne compte pas dessus pour
empêcher une installation sur une version trop ancienne.

## Publier et partager une extension

- Héberge le fichier `manifest.json` n'importe où en **https://** — la façon
  la plus simple est de le mettre dans un dépôt GitHub public et de partager
  son URL **raw** (`https://raw.githubusercontent.com/<compte>/<dépôt>/<branche>/manifest.json`).
- Une page d'accueil (`homepage`) pointant vers un README explique aux
  utilisateurs ce que fait l'extension avant qu'ils ne l'installent.
- Comme les extensions ne sont pas vérifiées par l'éditeur de l'application,
  rappelle toujours la source (dépôt, auteur) dans ta communication : c'est le
  seul moyen pour un utilisateur d'évaluer la confiance à accorder à ton
  extension.

## Dépannage des erreurs de validation

Les messages ci-dessous sont ceux produits tels quels par le validateur
(`src/utils/extensions.ts`) :

| Message | Cause |
|---|---|
| `Le manifeste doit être un objet JSON` | Le fichier n'est pas un objet JSON à la racine (tableau, chaîne, JSON invalide…) |
| `Clé inconnue à la racine : « … »` | Un champ non prévu par le schéma est présent au premier niveau |
| `id : identifiant invalide (attendu : minuscules, chiffres, points/tirets…)` | `id` absent, vide, trop long, ou ne respecte pas le format reverse-DNS |
| `name : chaîne non vide requise (80 caractères max)` | `name` manquant, vide ou trop long |
| `version : doit suivre le format semver (ex. « 1.2.0 »)` | `version` absente ou mal formée |
| `author : chaîne non vide requise (80 caractères max)` | `author` manquant, vide ou trop long |
| `description : chaîne non vide requise (400 caractères max)` | `description` manquante, vide ou trop longue |
| `homepage : doit être une URL https:// valide` | `homepage` présent mais pas en `https://`, ou trop long |
| `minAppVersion : doit suivre le format semver (ex. « 0.3.0 »)` | `minAppVersion` présent mais mal formé |
| `contributes : doit être un objet` | `contributes` présent mais n'est pas un objet JSON |
| `contributes : clé inconnue « … »` | Une clé autre que `snippets`, `themes`, `webLinks` est présente dans `contributes` |
| `contributes.snippets : doit être une liste` / `: 50 entrées maximum` | `snippets` n'est pas un tableau, ou dépasse la limite |
| `contributes.snippets[i].name` / `.command` / `.description` | Un champ de snippet manque, est vide, trop long, ou (pour `command`) contient un retour à la ligne |
| `contributes.themes : doit être une liste` / `: 10 entrées maximum` | `themes` n'est pas un tableau, ou dépasse la limite |
| `contributes.themes[i].id : identifiant invalide (minuscules, chiffres, tirets)` | `id` de thème mal formé |
| `contributes.themes[i].colors : au moins une couleur requise` / `: 40 variables maximum` | `colors` vide, ou trop de variables |
| `contributes.themes[i].colors : toutes les valeurs doivent être des chaînes (64 caractères max)` | Une valeur de couleur n'est pas une chaîne, ou dépasse 64 caractères |
| `contributes.webLinks : doit être une liste` / `: 20 entrées maximum` | `webLinks` n'est pas un tableau, ou dépasse la limite |
| `contributes.webLinks[i].url : doit être une URL https:// valide` | URL absente, trop longue, ou pas en `https://` |
| `Le fichier n'est pas un JSON valide` | Le fichier choisi ne peut pas être analysé comme du JSON |
| `Manifeste trop volumineux (> 256 Ko)` / `Fichier trop volumineux (> 256 Ko)` | Le fichier ou la réponse HTTP dépasse la limite de taille |
| `Seules les URL en https:// sont autorisées` | L'URL saisie pour une installation à distance ne commence pas par `https://` |
| `Le fichier n'est pas de l'UTF-8 valide` | Le fichier lu ou téléchargé n'est pas encodé en UTF-8 |

> **Astuce**
> Toutes les erreurs détectées sont affichées **en une seule fois** — pas
> besoin de corriger un champ, réessayer, puis découvrir l'erreur suivante.

## Non pris en charge (feuille de route)

Ce qui suit **n'est pas disponible aujourd'hui**, volontairement, à cause du
modèle de sécurité strictement déclaratif décrit plus haut :

- **Plugins de code** (JavaScript, WASM, scripts shell embarqués) : aucune
  extension ne peut exécuter de code arbitraire dans l'application.
- **Actions automatiques** : une extension ne peut pas déclencher elle-même
  une action sur un serveur (arrêt, redémarrage, script...) — seuls des
  snippets à **insérer manuellement** sont proposés.
- **Accès réseau libre** : une extension ne peut pas déclarer d'appel réseau
  personnalisé ; la seule requête réseau liée à une extension est le
  téléchargement de son propre `manifest.json`.

Si ce modèle évolue un jour vers des capacités plus larges, ce sera documenté
ici avec le même niveau de détail que le format actuel.
