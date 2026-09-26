# Contribuer à Server Power Manager

Merci de l'intérêt porté à ce projet. Ce guide couvre la compilation depuis
les sources, les tests, les conventions de code et comment ajouter une
nouvelle commande Tauri.

> **Avant tout : licence**
> Server Power Manager est distribué sous un contrat de licence utilisateur
> final (EULA) qui **interdit toute monétisation** du logiciel (vente,
> redistribution payante, hébergement rémunéré/SaaS, intégration dans un
> produit payant, monétisation publicitaire…) **sans l'accord écrit préalable
> de l'auteur**. Toute contribution doit respecter cette condition. Pour
> toute question de licence, ouvre une issue sur le dépôt GitHub. Le texte
> complet (en anglais) est dans `src-tauri/EULA.txt` : l'installateur l'affiche et
> l'application l'importe tel quel (`src/legal/eula.ts`). Il doit rester anonyme
> (aucun nom de personne ni adresse de dépôt, un test le vérifie) ; après toute
> modification, augmente `EULA_VERSION` pour que l'app redemande l'acceptation.

## Construire depuis les sources

### Prérequis

Windows 10/11 avec [winget](https://apps.microsoft.com/detail/9NBLGGH4NNS1)
(App Installer). Le script `install.ps1` installe automatiquement ce qui
manque :

- Visual C++ Build Tools (MSVC)
- Rust (rustup)
- Node.js LTS
- CMake et NASM (nécessaires à la compilation de la cryptographie)
- Git
- Tauri CLI v2
- les dépendances npm du projet

### Récupérer le projet

```powershell
git clone https://github.com/NolanEDUVAUD/server-manager.git
cd server-manager
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

> **Astuce**
> Les Build Tools peuvent prendre 5 à 15 minutes à s'installer. Ferme puis
> rouvre PowerShell après le script pour que `cargo` et `node` soient dans le
> PATH.

### Lancer en développement

```powershell
npm run tauri dev
```

La première compilation Rust prend quelques minutes ; les suivantes sont
rapides.

### Construire un installateur

```powershell
$env:RUSTFLAGS = "--remap-path-prefix=$env:USERPROFILE=~"   # retire ton chemin utilisateur du binaire
npm run tauri build
```

Les installateurs sont générés dans `src-tauri\target\release\bundle\nsis\`
(`.exe`) et `src-tauri\target\release\bundle\msi\` (`.msi`).

### Structure du dépôt

```
src/            Frontend React (pages, composants, stores Zustand)
src-tauri/src/  Backend Rust (commandes Tauri, SSH, WoL, ping, stockage chiffré)
docs/           Documentation utilisateur et notes de conception internes
```

## Tests

| Commande | Portée |
|---|---|
| `npm test` | Tests frontend (Vitest) : logique métier, composants React, garde-fous i18n |
| `npm run test:watch` | Idem, en mode watch |
| `cd src-tauri && cargo test --lib` | Tests backend (Rust) : parsing, validation, commandes, sécurité (ACL) |

Les scripts npm sont définis dans `package.json` (`dev`, `build`, `preview`,
`test`, `test:watch`, `tauri`).

> **Astuce**
> `npm run build` (qui inclut `tsc`) est le moyen le plus rapide de repérer
> une erreur de typage TypeScript sans lancer l'application.

## Conventions de code

- **Commentaires en français** dans le code Rust et TypeScript : c'est la
  convention déjà en place dans tout le projet (voir n'importe quel fichier
  sous `src-tauri/src/` ou `src/utils/`).
- **Internationalisation (i18n)** : tout texte visible par l'utilisateur passe
  par le dictionnaire de traduction (`src/i18n/fr/*.ts` et
  `src/i18n/en/*.ts`), jamais en dur dans un composant. C'est vérifié
  automatiquement :
  - `src/i18n/untranslated.test.ts` analyse le code source des composants
    (via le compilateur TypeScript) et échoue si du texte JSX, un attribut
    visible (`title`, `placeholder`, `aria-label`, `label`, `message`…) ou un
    message de toast n'est pas passé par `t()` — sauf pour une courte liste de
    termes universels (SSH, CPU, Docker, Proxmox, Windows Hello, PIN…).
  - `src/i18n/i18n.test.ts` (dictionnaires) vérifie que **chaque clé existe
    dans les deux langues**, qu'aucune traduction n'est vide, que les
    variables `{nom}` correspondent d'une langue à l'autre, et que chaque
    forme plurielle `.one` a bien sa forme `.other`.

  En pratique : toute clé ajoutée dans `src/i18n/fr/` doit être ajoutée avec
  la **même structure** dans `src/i18n/en/`, sinon les tests échouent.

- **Rust** : le code est organisé par domaine (`ssh_auth.rs`, `smart_batch.rs`,
  `extensions.rs`…), avec des tests unitaires dans un module `#[cfg(test)]`
  en bas de chaque fichier concerné.

## Ajouter une commande Tauri

Une commande Tauri (`#[tauri::command]`) doit être déclarée à **trois
endroits qui doivent rester synchronisés**, et un test (dans
`src-tauri/src/lib.rs`) vérifie automatiquement que c'est bien le cas :

1. **L'enregistrer** dans `tauri::generate_handler![...]` (dans
   `src-tauri/src/lib.rs`).
2. **L'ajouter au manifeste ACL** dans `src-tauri/build.rs`, fonction
   `app_manifest()`, dans la liste passée à `.commands(&[...])`. Sans ce
   manifeste, Tauri n'appliquerait **aucun** contrôle d'accès aux commandes.
3. **L'autoriser dans la capability** `src-tauri/capabilities/main.json`, en
   ajoutant `"allow-<nom-de-la-commande-avec-des-tirets>"` à la liste
   `permissions` (une commande `mon_action` devient `allow-mon-action`).

Le test `every_command_is_declared_in_manifest_and_capability` (dans
`src-tauri/src/lib.rs`, module `acl_tests`) compare automatiquement les trois
listes et échoue si l'une d'elles diverge — c'est le meilleur moyen de
vérifier qu'une nouvelle commande est bien déclarée partout :

```powershell
cd src-tauri
cargo test --lib acl_tests
```

Un second test, `capability_is_local_only`, garantit que la capability ne
s'ouvre jamais aux origines distantes (les onglets web intégrés n'ont donc
jamais accès à l'IPC de commandes).

> **Attention**
> `capabilities/main.json` est la seule chose qui empêche une page web
> distante ouverte dans un onglet (Proxmox, TrueNAS…) d'appeler une commande
> Tauri sensible (exécution SSH, lecture de secrets…). Ne jamais élargir
> `windows`/`webviews` au-delà de `"main"`, et ne jamais ajouter de clé
> `remote` à ce fichier.

## Icône de l'application

L'image source est `src-tauri/app-icon.png` (carrée, 1024 × 1024, fond transparent).
Après l'avoir modifiée, régénère les icônes utilisées par l'installateur, la fenêtre et
la zone de notification :

```bash
npx tauri icon src-tauri/app-icon.png -o /tmp/icons
cp /tmp/icons/{32x32.png,128x128.png,128x128@2x.png,icon.icns,icon.ico} src-tauri/icons/
cp /tmp/icons/128x128@2x.png public/app-icon.png
```

## Signaler un problème ou proposer un changement

Voir [guide/signaler-un-probleme.md](guide/signaler-un-probleme.md) pour
signaler un bug depuis l'application ou directement sur GitHub. Pour une
contribution de code, ouvre une pull request sur
[github.com/NolanEDUVAUD/server-manager](https://github.com/NolanEDUVAUD/server-manager).
