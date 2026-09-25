# Planificateur — Design

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
Programmer des Wake-on-LAN, des arrêts et des redémarrages par jour de la semaine et par heure, sur un
serveur ou un groupe. Exemple : éteindre les Workstation à 23 h et les rallumer à 7 h en semaine, pour
économiser de l'énergie.

## Contrainte
L'app doit être ouverte pour exécuter les tâches (pas de service Windows). La page le rappelle et renvoie
vers le démarrage automatique.

## Modèle (persisté dans `data.json`, champ `schedules` avec `serde(default)`)
`Schedule { id, name, enabled, action: Wake|Shutdown|Reboot, target: {Server|Group, id}, days: [0..6]
(0 = lundi), time: "HH:MM", last_run: Option<ms> }`

## Backend
- `scheduler.rs`
  - `is_due(schedule, now_local, last_run) -> bool`, fonction pure. La tâche est due si le jour correspond,
    si `now` est dans `[heure prévue, heure prévue + 2 min[` et si `last_run` est antérieur à l'heure prévue.
    La fenêtre de 2 minutes tolère un tick en retard sans jamais rattraper une exécution manquée des
    heures plus tard, par exemple après une mise en veille du PC.
  - `validate(schedule)` : heure valide, au moins un jour, cible existante.
  - Une boucle tokio lancée au démarrage vérifie toutes les 20 s, exécute les tâches dues, met `last_run` à
    jour et sauvegarde.
  - Exécution : Wake-on-LAN (`send_magic_packet`, passé en `pub(crate)`) ; arrêt et redémarrage via
    `execute_ssh` avec la commande du serveur. Pour un groupe, chaque serveur est traité (Wake en premier,
    tous les serveurs même si l'un échoue).
  - Chaque exécution est journalisée dans l'historique : le message est préfixé par « Planifié (nom) ».
- Commandes : `get_schedules`, `save_schedule` (ajout ou mise à jour, avec validation),
  `delete_schedule`, `run_schedule_now`.

## Frontend
- Page « Planificateur » : liste des tâches (action, cible, jours, heure, prochaine exécution, interrupteur
  actif, exécuter maintenant avec confirmation pour les arrêts, modifier, supprimer), formulaire modal.
- `nextRun(schedule, now)`, fonction pure testée, pour afficher la prochaine exécution.

## Tests
- Rust : `is_due` (bon jour et bonne heure, mauvais jour, fenêtre dépassée, déjà exécutée, tâche
  désactivée), `validate`.
- Vitest : `nextRun` (plus tard aujourd'hui, demain, semaine suivante, aucun jour).
