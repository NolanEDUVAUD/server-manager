# Reprise — reste à faire (mis à jour le 2026-09-25)

## État actuel (`feature/v2` = `master`)

Toutes les fonctionnalités de la **Phase 1** sont livrées, testées et poussées. La version affichée est encore **0.2.0**, et la release 0.3.0 n'est pas faite.

| # | Fonctionnalité | État |
|---|---|---|
| 1.1 | Base SQLite (`history.db`) : historique, sondes, métriques, rétention | ✅ |
| 1.2 | Authentification SSH par clé (ed25519, OpenSSH/PPK, agent, rebond), russh 0.63 | ✅ |
| 1.3 | Verrouillage (PIN, Windows Hello, mot de passe maître Argon2id) | ✅ |
| 1.4 | Sauvegarde / restauration chiffrées `.spmbackup` + sauvegarde automatique | ✅ |
| 1.5 | Mise à jour automatique signée + workflow `release.yml` | ✅ (clé publique à fournir) |
| 1.6 | Internationalisation FR/EN | 🟡 lots A, B, C faits ; **lot D restant** |
| 1.7 | Organisation (tags, dossiers, favoris, filtres, palette, raccourcis) | ✅ |

Dernières vérifications, toutes vertes : 277 tests Rust, 232 tests Vitest, `tsc`, `vite build`, `npm audit --omit=dev` à 0, et `clippy` sans nouvel avertissement. `cargo audit` n'a plus d'avis corrigeable ; les avis restants sont documentés dans le README.

## Reste à faire pour clore la Phase 1

### 1. i18n — lot D (fichiers encore en français seulement)

Ce lot avait été confié à un agent, arrêté avant la fin : rien n'a été fusionné.

- `src/pages/Servers.tsx`, `src/components/ServerForm.tsx`, `src/components/ServerCard.tsx`
- `src/components/ConfirmDialog.tsx` : libellés par défaut « Confirmer » / « Annuler », à prendre dans `common`
- `src/components/ServerAuthFields.tsx`, `src/components/SshKeysSettings.tsx`, `src/components/DeployKeyDialog.tsx`, `src/utils/sshAuth.ts`
- `src/pages/Settings.tsx` : titres des sections, sections Général, Apparence, Réseau, Configuration, À propos, bloc « Modules »
- `src/stores/useStore.ts` : messages destinés à l'utilisateur
- `src/utils/index.ts` : `formatBytes` (Mo/Go/To), `formatUptime` (j/h/min), `formatDate` (`"fr-FR"` → `currentLocale()`)
- `src/components/StatusBadge.tsx` : « En ligne », « Hors ligne », « Inconnu »
- `src/utils/organisation.ts` : messages de `nameError`, fonction `plural`

Méthode, déjà appliquée aux lots A à C :
- un espace de noms par groupe de fichiers : `src/i18n/fr/<ns>.ts` et `src/i18n/en/<ns>.ts`, ce dernier typé `Dict["<ns>"]` ;
- `useT()` dans les composants, `t()` / `currentLocale()` ailleurs ;
- régénérer les deux `index.ts` avec `python3 docs/superpowers/tools/gen_i18n_index.py`.

Ensuite, **activer le garde-fou** : copier `docs/superpowers/tools/untranslated.test.ts.txt` en `src/i18n/untranslated.test.ts`. Il échoue s'il reste du texte visible écrit en dur dans un `.tsx`. Traiter ses retours, en ajoutant à `UNIVERSAL` les noms propres légitimes.

### 2. Phrases de confirmation du lab

Dans `LabPower.tsx`, les phrases « ÉTEINDRE LE LAB » et « DÉMARRER LE LAB » restent en français, parce que `src-tauri/src/lab_power.rs` les compare mot pour mot. Il faut que le backend accepte aussi « SHUT DOWN THE LAB » et « START THE LAB » (avec un test), puis que l'interface affiche la phrase dans la langue active.

### 3. Release 0.3.0

1. Passer la version à `0.3.0` dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`, puis lancer `cargo build` pour mettre à jour `Cargo.lock`.
2. Commit, puis push sur `feature/v2` et `master`.
3. Créer un tag annoté `v0.3.0`, dont le message sert de notes de version en français, et le pousser.
4. Le workflow `release.yml` construit sous Windows NSIS + MSI + `SHA256SUMS.txt`, puis crée une release **en brouillon**. Relire le brouillon et le publier.
5. **Côté propriétaire, facultatif** : générer la paire de clés de mise à jour (`npm run tauri signer generate -- -w <chemin hors du dépôt>`), mettre la clé **publique** dans `src-tauri/updater-pubkey.txt` et ajouter les secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Sans cela, la release sort quand même, mais sans mise à jour automatique.

### 4. À vérifier sur un vrai Windows (impossible dans le conteneur Linux)

- Windows Hello : invite devant la fenêtre et PIN de secours.
- Détection du verrouillage de la session Windows.
- Coffre avec mot de passe maître : démarrage verrouillé puis déverrouillage.
- Agent SSH : OpenSSH pour Windows (canal nommé) et Pageant.
- Installation d'une mise à jour signée (NSIS passif).
- Temps d'Argon2id (64 Mio) au déverrouillage et à la sauvegarde.
- Binaire de release : `grep -a -c -i nolan server-manager.exe` doit renvoyer 0.

## Ensuite : Phase 2 (v0.4.0)

Reprendre le backlog du prompt initial dans l'ordre : 2.1 onduleur NUT (scénario de coupure avec simulation), 2.2 consommation et coût, 2.3 SLA et page de statut, 2.4 alertes v2, 2.5 supervision élargie, 2.6 tableau de bord personnalisable. La base SQLite (1.1) contient déjà les données de disponibilité et de latence nécessaires à la 2.3.

## Notes techniques pour la reprise (environnement cloud Linux)

- Dépendances système Tauri : `apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`.
- Sous Linux, `cargo build` régénère `src-tauri/gen/schemas/linux-schema.json` (ignoré par git). Recopier ensuite `desktop-schema.json` sur `windows-schema.json`.
- **Sous-agents en worktrees avec un `CARGO_TARGET_DIR` partagé** : Cargo donne le même hash au crate dans chaque worktree et réutilise alors les artefacts d'un autre arbre. Pour l'éviter, il faut un `.cargo/config.toml` local, non versionné, propre à chaque arbre, avec `[profile.dev.package.server-manager] codegen-units = <valeur unique>` et `[build] incremental = false`. Le disque est limité : penser à purger `target/debug/incremental`.
- Vitest ignore `.claude/worktrees/` (voir `vite.config.ts`).
