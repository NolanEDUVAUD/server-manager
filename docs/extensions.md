# Extensions communautaires

Server Manager peut charger des **extensions communautaires** : des paquets qui
ajoutent des commandes mémorisées (snippets), des thèmes ou des liens, sans
jamais exécuter de code.

## Pourquoi un format aussi restreint ?

L'application garde des clés SSH et des identifiants de services en local. Une
extension qui pourrait exécuter du code arbitraire (JavaScript, script shell,
plugin binaire…) serait une porte dérobée vers ces secrets. Le format
d'extension est donc **strictement déclaratif** :

- une extension est un unique fichier `manifest.json` ;
- aucun champ ne contient de code, d'expression `eval`, ni de script à
  exécuter ;
- les seules actions autorisées sont celles déjà proposées nativement par
  l'application (insérer une commande dans le terminal, appliquer une palette
  de couleurs) ;
- les seules requêtes réseau que l'app fait pour une extension sont : lire le
  fichier `manifest.json` (local ou via une URL **https://**), rien d'autre.

Le manifeste est validé par un schéma strict côté application
(`src/utils/extensions.ts`) : type et longueur de chaque champ, format de
l'identifiant et des URLs, clés inconnues refusées. Un manifeste qui ne passe
pas cette validation n'est pas installé, et la liste complète des erreurs est
affichée.

**Avertissement** : les extensions communautaires ne sont pas vérifiées par
l'éditeur de l'application. N'installe que celles dont tu connais la source.

## Format du manifeste

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

### Champs de premier niveau

| Champ           | Type           | Obligatoire | Description |
|-----------------|----------------|:-----------:|--------------|
| `id`            | string         | oui | Identifiant façon reverse-DNS : minuscules, chiffres, points et tirets (`^[a-z0-9]+(\.[a-z0-9-]+)*$`), 100 caractères max. |
| `name`          | string         | oui | Nom affiché, 80 caractères max. |
| `version`       | string         | oui | Semver (`1.2.0`, `2.0.0-beta.1`). |
| `author`        | string         | oui | Auteur ou organisation, 80 caractères max. |
| `description`   | string         | oui | Description courte, 400 caractères max. |
| `homepage`      | string         | non | URL **https://** uniquement. |
| `minAppVersion` | string         | non | Version minimale de l'app requise (semver). |
| `contributes`   | objet          | non | Voir ci-dessous. Aucune clé en dehors de celles listées n'est acceptée, à aucun niveau. |

### `contributes.snippets`

Liste de commandes mémorisées (50 maximum), identiques à celles déjà proposées
dans la console SSH : elles sont **insérées** dans le terminal actif, jamais
exécutées automatiquement.

| Champ         | Type   | Obligatoire | Contrainte |
|---------------|--------|:-----------:|------------|
| `name`        | string | oui | 60 caractères max. |
| `command`     | string | oui | Une seule ligne, 500 caractères max. |
| `description` | string | non | 200 caractères max. |

### `contributes.themes`

Liste de thèmes (10 maximum), même format que les thèmes personnalisés créés
dans Paramètres → Apparence.

| Champ    | Type                     | Obligatoire | Contrainte |
|----------|--------------------------|:-----------:|------------|
| `id`     | string                   | oui | Minuscules, chiffres, tirets. |
| `name`   | string                   | oui | 60 caractères max. |
| `colors` | objet `{ variable: css }`| oui | Au moins une entrée, 40 variables max, chaque valeur 64 caractères max. Les clés attendues sont celles de `src/utils/theme.ts` (`--bg-primary`, `--accent-primary`, etc.) ; une variable non reconnue est simplement ignorée à l'affichage. |

### `contributes.webLinks`

Liste de liens (20 maximum), affichés dans Paramètres → Extensions à côté de
l'extension qui les fournit.

| Champ  | Type   | Obligatoire | Contrainte |
|--------|--------|:-----------:|------------|
| `name` | string | oui | 60 caractères max. |
| `url`  | string | oui | URL **https://** uniquement, 500 caractères max. |

## Espace de noms

Toute contribution d'une extension est identifiée sous la forme
`ext:<id-extension>:<nom>`, pour ne jamais entrer en collision avec un élément
natif de l'application. Désactiver ou désinstaller une extension retire
immédiatement ses contributions des listes (snippets, thèmes), sans toucher
aux éléments natifs.

## Installer une extension

Depuis Paramètres → Extensions :

- **Depuis un fichier** : choisis un fichier `manifest.json` sur ton disque
  (limité à 256 Ko).
- **Depuis une URL** : colle une URL **https://** pointant vers un
  `manifest.json` (le téléchargement est fait côté application, borné à
  256 Ko, et refuse tout ce qui n'est pas en https).

Dans les deux cas, le manifeste est validé avant d'être installé ; toute
erreur est affichée en détail (champ concerné et raison du rejet).
