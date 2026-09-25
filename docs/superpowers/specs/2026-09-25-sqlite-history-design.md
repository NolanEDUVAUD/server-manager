# Base de données locale SQLite — historique, sondes et métriques

**Version cible :** 0.3.0 (Phase 1.1)

## But

Jusqu'ici, l'historique des événements tenait dans `events.json` (5 000 entrées au plus, réécrites en entier à chaque événement), la disponibilité des sondes n'existait qu'en mémoire (120 derniers contrôles) et aucune métrique n'était conservée. Après un redémarrage de l'app, la disponibilité et les courbes repartaient de zéro.

Désormais, toutes les **mesures** (pings, résultats de sondes, métriques) et les **événements** sont enregistrés dans une base SQLite locale : `%APPDATA%\com.homelab.server-manager\history.db`. Ils survivent au redémarrage et servent de socle à la Phase 2 (SLA, graphiques, rapports).

La **configuration** reste dans `data.json`, avec ses secrets chiffrés. La base ne contient **aucun secret**.

## Choix techniques

- `rusqlite` avec la feature `bundled` : SQLite compilé dans le binaire, sans DLL ni dépendance système (crate maintenue, référence de l'écosystème).
- Une connexion unique protégée par un `Mutex`. Le volume est faible (quelques dizaines d'écritures par minute), les requêtes sont courtes et indexées.
- `journal_mode = WAL`, `synchronous = NORMAL`, `auto_vacuum = INCREMENTAL` (fixé à la création), `busy_timeout = 5 s`.
- **Migrations versionnées** par `PRAGMA user_version`. Chaque migration s'exécute dans une transaction qui fixe la version atteinte. Une base créée par une version **plus récente** de l'app n'est jamais modifiée : l'app le signale et bascule sur une base en mémoire.
- **Base illisible ou corrompue** : le fichier est renommé en `history.db.corrupt-<horodatage>` et une base neuve est créée. En dernier recours, l'app utilise une base en mémoire. L'historique ne doit jamais empêcher l'app de démarrer.

## Modèle de données (schéma v1)

| Table | Contenu | Rétention |
|---|---|---|
| `events` | id, ts, kind, server_id, target, message | `event_days` (90 j par défaut) |
| `ping_samples` | server_id, ts, online, latency_ms | `raw_days` (7 j) |
| `probe_samples` | probe_id, ts, ok, latency_ms, detail, cert_days_left | `raw_days` (7 j) |
| `metric_samples` | server_id, ts, cpu, mem, disk (disque le plus plein), load1, cpu_temp | `raw_days` (7 j) |
| `ping_hourly` / `probe_hourly` | (id, heure) → contrôles, succès, somme / nombre / max de latence | `hourly_days` (90 j) |
| `metric_hourly` | (serveur, heure) → échantillons, somme et max CPU / RAM, max disque et température | `hourly_days` (90 j) |

- Les **agrégats horaires** sont mis à jour à chaque insertion (UPSERT dans la même transaction). Il n'y a donc pas de tâche de consolidation dont une panne ferait perdre des données. La rétention se résume à supprimer les lignes trop anciennes.
- Horodatages en millisecondes Unix, heure = `ts - ts % 3 600 000`.
- Les textes libres sont tronqués (message : 2 000 caractères, détail de sonde : 300).

## Rétention

Nouvelle section `settings.history` (`#[serde(default)]`, compatible avec les anciens `data.json`) :

| Réglage | Défaut | Bornes |
|---|---|---|
| `raw_days` | 7 | 1 à 31 |
| `hourly_days` | 90 | 7 à 730, et ≥ `raw_days` |
| `event_days` | 90 | 7 à 3 650 |

La purge s'exécute 30 s après le démarrage, puis toutes les heures, ainsi qu'à la demande (bouton « Appliquer maintenant »). Elle se termine par `PRAGMA incremental_vacuum`.

## Reprise de l'existant

Au premier démarrage, si `events.json` existe (taille ≤ 20 Mio), ses événements sont importés (`INSERT OR IGNORE`, dans une transaction), puis le fichier est supprimé. Un fichier trop gros ou illisible est renommé en `events.json.bak` sans être importé. L'opération est idempotente.

## Comportements modifiés

- `EventStore` ne garde plus que l'état courant (dernier statut connu, pings manqués). Au démarrage, le dernier statut de chaque serveur est relu depuis la base.
- `get_events(limit?, before?)` : les plus récents d'abord (5 000 par défaut, 10 000 au plus), avec pagination par horodatage.
- `get_event_stats(days)` : calculées sur les événements d'état de la fenêtre, plus le dernier événement d'état **antérieur** à la fenêtre pour chaque serveur (une coupure commencée avant reste comptée).
- **Disponibilité d'une sonde** : calculée sur les 24 dernières heures à partir des agrégats horaires, et non plus sur les 120 derniers contrôles en mémoire. Les derniers résultats sont relus au démarrage.
- **Courbes de ressources** : au démarrage, les 120 derniers échantillons de chaque serveur sont rechargés depuis la base.

## Commandes Tauri

| Commande | Rôle |
|---|---|
| `get_events(limit?, before?)` | historique paginé (signature étendue, compatible) |
| `get_history_info` | chemin, taille du fichier, nombre de lignes par table, plus ancienne mesure |
| `get_recent_metrics(limit)` | derniers échantillons CPU / RAM par serveur (courbes) |
| `get_server_uptime(days)` | disponibilité (%) par serveur, d'après les pings agrégés |
| `prune_history` | applique immédiatement la rétention |

Les réglages de rétention passent par `update_settings`, qui les valide.

## Sécurité

- La base ne contient ni mot de passe, ni jeton, ni clé : uniquement des identifiants internes (UUID), des noms affichés, des mesures et des messages d'événements, qui n'ont jamais contenu de secret (règle déjà appliquée aux messages d'erreur).
- Requêtes toujours paramétrées (aucune concaténation SQL).
- Import de `events.json` borné en taille avant désérialisation.
- `get_history_info` renvoie le chemin de la base, comme `get_data_path` le fait déjà pour la configuration.

## Tests

- Migrations : base vide → version courante ; réouverture idempotente ; base « du futur » refusée ; fichier corrompu mis de côté puis base recréée.
- Persistance : écriture dans un fichier, fermeture, réouverture → événements, dernier statut, derniers résultats de sondes et disponibilité intacts (le critère « survit au redémarrage »).
- Événements : ordre, limite, pagination, dernier statut par serveur, fenêtre de statistiques avec événement antérieur.
- Agrégats : nombre de contrôles, succès, latence moyenne et max (y compris latences absentes) pour les pings, les sondes et les métriques.
- Rétention : brut supprimé au-delà de `raw_days` mais agrégats conservés ; agrégats supprimés au-delà de `hourly_days` ; événements au-delà de `event_days`.
- Reprise d'`events.json` : import, suppression du fichier, idempotence, fichier trop gros ignoré.
- Validation des réglages de rétention.
- Vitest : fusion des échantillons rechargés avec ceux reçus en direct.
