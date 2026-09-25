# Reprise — état et suite (mis à jour le 2026-09-25)

## État actuel (`feature/v2` = `master`, version 0.3.0)

La **Phase 1 est terminée** : toutes ses fonctionnalités sont livrées, testées et poussées, et le tag `v0.3.0` déclenche la release (voir ci-dessous).

| # | Fonctionnalité | État |
|---|---|---|
| 1.1 | Base SQLite (`history.db`) : historique, sondes, métriques, rétention | ✅ |
| 1.2 | Authentification SSH par clé (ed25519, OpenSSH/PPK, agent, rebond), russh 0.63 | ✅ |
| 1.3 | Verrouillage (PIN, Windows Hello, mot de passe maître Argon2id) | ✅ |
| 1.4 | Sauvegarde / restauration chiffrées `.spmbackup` + sauvegarde automatique | ✅ |
| 1.5 | Mise à jour automatique signée + workflow `release.yml` | ✅ (clé publique à fournir) |
| 1.6 | Internationalisation FR/EN, garde-fou contre les textes en dur | ✅ |
| 1.7 | Organisation (tags, dossiers, favoris, filtres, palette, raccourcis) | ✅ |

Dernières vérifications, toutes vertes : 278 tests Rust, 235 tests Vitest, `tsc`, `vite build`, `npm audit --omit=dev` à 0, et `clippy` sans nouvel avertissement. `cargo audit` n'a plus d'avis corrigeable ; les avis restants sont documentés dans le README.

## Release 0.3.0

- Pousser le tag annoté `v0.3.0` lance `.github/workflows/release.yml` (Windows) : NSIS + MSI + `SHA256SUMS.txt`, release **en brouillon**.
- Relire le brouillon, vérifier que `grep -a -c -i nolan` renvoie 0 sur l'exécutable, puis publier.
- **Côté propriétaire, facultatif** : générer la paire de clés de mise à jour (`npm run tauri signer generate -- -w <chemin hors du dépôt>`), mettre la clé **publique** dans `src-tauri/updater-pubkey.txt` et ajouter les secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Les mises à jour automatiques s'activent à la release suivante.

## À vérifier sur un vrai Windows (impossible dans le conteneur Linux)

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
