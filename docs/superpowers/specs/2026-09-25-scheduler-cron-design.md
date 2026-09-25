# Planificateur — mode cron sur les serveurs

Date : 2026-09-25 · Demandé par l'utilisateur pendant la livraison du planificateur.

## Objectif
Une tâche d'arrêt ou de redémarrage peut être installée comme **cron sur le serveur Linux**. Elle s'exécute
alors même quand l'app est fermée. L'app liste aussi les crons déjà présents sur chaque serveur.

## Règles
- `Schedule.mode ∈ {App, Cron}` (défaut `App`, `serde(default)` : les tâches existantes ne changent pas).
- `Cron` n'est possible que pour Shutdown et Reboot : un Wake-on-LAN ne peut pas s'exécuter sur la machine
  éteinte. Les cibles Windows et ESXi sont refusées.
- Ligne installée : `M H * * J <commande du serveur> # server-manager:<id>`. Les jours sont convertis
  (app : 0 = lundi ; cron : 0 = dimanche). L'étiquette permet de retrouver, remplacer et retirer la ligne.
- Synchronisation à l'enregistrement : la ligne est retirée des anciens serveurs cibles et installée sur
  les nouveaux si la tâche est active ; une tâche désactivée ou supprimée retire sa ligne. Un échec SSH
  sur un serveur est remonté à l'utilisateur, et la tâche reste enregistrée dans l'app.
- La boucle du planificateur ignore les tâches `Cron` : le serveur s'en charge. « Exécuter maintenant »
  reste disponible.
- Écriture du crontab : `crontab -l | grep -v <étiquette>`, ajout de la ligne, puis `| crontab -`. La
  ligne est passée à `printf` entre apostrophes, échappées, pour éviter toute injection.

## Liste des crons
`cron_list(server_id)` lit en une seule connexion le crontab de l'utilisateur SSH, `/etc/crontab` et
`/etc/cron.d/*`. Chaque entrée comporte : source, planification (5 champs ou `@reboot`…), utilisateur
(pour les fichiers système), commande et identifiant de tâche géré, s'il y a une étiquette. Les lignes
système sont en lecture seule ; une ligne étiquetée sans tâche correspondante (orpheline) peut être
supprimée.

## Tests
Rust : conversion des jours, construction et échappement de la ligne, analyse du crontab (commentaires,
variables d'environnement, `@reboot`, champ utilisateur de cron.d, étiquette), validation du mode.
