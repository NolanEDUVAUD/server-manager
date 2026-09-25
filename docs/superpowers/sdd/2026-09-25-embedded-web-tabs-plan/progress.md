# SDD ledger — plan: docs/superpowers/plans/2026-09-25-embedded-web-tabs-plan.md

> Reconstitué le 2026-09-25 à partir de l'original, supprimé par `git worktree remove`
> (le dossier `.worktrees/` est ignoré par git). Les briefs, rapports et diffs par tâche
> n'ont pas été conservés.

Spec : docs/superpowers/specs/2026-09-25-embedded-web-tabs-design.md

## Mise en place
- Worktree `.worktrees/web-tabs`, branche `sdd/embedded-web-tabs`, partie de `feature/v2` @ 5e15267.
- Les agents d'implémentation et de revue tournent sur Haiku 4.5, avec escalade vers Sonnet pour les problèmes de linking natif et la revue finale.
- Scan de conflits préalable : aucun conflit entre les tâches.

## Journal des tâches
- **Tâche 1** (DashboardState + feature `unstable` de Tauri) : après ce changement, tout le binaire de test plantait avec STATUS_ENTRYPOINT_NOT_FOUND. Cause : `Webview<Wry>` tire des symboles comctl32 v6 dans le harnais de `cargo test`, qui n'a pas de manifeste. L'implémenteur avait prétendu à tort que le problème existait déjà. Correctif (Sonnet) : `build.rs` → `tauri_build::try_build(WindowsAttributes::new_without_app_manifest())` + `windows-app-manifest.xml` + `rustc-link-arg` sans scope. Manifeste vérifié identique octet pour octet à celui de Tauri. 18/18 tests Rust.
- **Tâche 2** (`open_dashboard_tab` / `close_dashboard_tab`) : revue propre.
- **Tâche 3** (`set_dashboard_tab_visible` / `resize_dashboard_tab`) : revue propre.
- **Tâche 4** (types + actions Zustand) : revue propre.
- **Tâche 5** (hook `useDashboardTabSync`) : 1 correctif (test du cas `containerRef` null).
- **Tâche 6** (page Dashboards + sidebar + route) : revue propre.
- **Tâche 7** (bouton « ouvrir l'interface web » sur les cartes Proxmox) : revue propre.

## Revue finale (5e15267..6969cee)
Deux problèmes critiques, corrigés dans 41c9f21 :
1. `closeDashboardTab` ne réaffichait pas l'onglet de repli, qui restait caché.
2. `Dashboards.tsx` n'affichait pas la webview en entrant sur la page et ne la masquait pas en la quittant : la webview native restait par-dessus les autres pages.
Mineur, aussi corrigé : `navigate` en cas de réutilisation d'un onglet existant.

Problème modéré mis de côté : `closeDashboardTab` fait `get()` → `await invoke` → `set()`, donc une action concurrente pendant l'await peut être écrasée. Traité ensuite dans un commit de suivi sur `feature/v2`.

## Issue
Fusionné en fast-forward dans `feature/v2` le 2026-09-25 (HEAD 41c9f21). 20 tests frontend + 18 tests Rust passent sur le résultat fusionné.
