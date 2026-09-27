# Benchmark concurrentiel — index et priorités

Trois documents, produits le 27/09/2026 à partir d'une collecte en ligne (prix et éditions
indicatifs) puis confrontés au code de la version 0.5.0 :

| Document | Modules | Préfixes |
|---|---|---|
| [Console](2026-09-27-benchmark-integration-native.md) | Console SSH, explorateur de fichiers | C1–C18, M1–M2 |
| [Supervision, serveurs et réseau](2026-09-27-benchmark-modules-supervision-reseau.md) | Dashboard, Serveurs/Groupes, Arrêt/démarrage, Ressources, Historique, Alertes, Réseau | D, S, P, R, A, N |
| [Infrastructure, automatisation, données et sécurité](2026-09-27-benchmark-modules-infra-automatisation.md) | Docker, Proxmox, Sauvegardes, Tâches en lot, Planificateur, Mises à jour, Logs, Bases de données, Onglets web, Intégrations, Sécurité, Extensions, Paramètres | K, X, B, T, H, U, L, Q, W, Z, E, G |

## Fonctions existantes mais invisibles ou inexploitées (à traiter en premier)

- **Sondes de services** (`probes.rs` : HTTP avec assertion JSON, TCP, expiration TLS, authentification) : moteur complet et testé, relié aux alertes, mais plus aucune page depuis le retrait de l'onglet Services → **A1** (remplace aussi M1).
- **Proxmox Backup Server** : déclaré dans les intégrations avec test de connexion, jamais exploité → **X2/B2**.
- **Mises à jour** limitées à apt alors que les Tâches en lot reconnaissent 9 familles de paquets → **U1**.
- **Journaux Docker** statiques (`--tail`), sans suivi en direct → **K1**.

## Proposition d'ordre pour les prochaines itérations

1. **Visibilité** : A1, U1, K1, C1 (recherche terminal), C2 (liens), C3 (reconnexion + keepalive).
2. **Confort quotidien** : C4 (barre de ressources), T1/T2 (historique et relance des lots), Q1–Q3 (historique, favoris, export SQL), D1 (widgets), exports CSV (S1, N5, R1).
3. **Fonctions structurantes** : C7 (diffusion), C8 (volets), C9 (tunnels), A4/A5 (dépendances et maintenance), P1 (onduleur/NUT), X1/X2.
4. **Décisions produit** : phases 3 des trois documents.

## Déjà en avance sur la concurrence

Arrêt/démarrage ordonné du lab (Lab Power), Wake-on-LAN intégré et programmable,
Proxmox natif, Tâches en lot adaptées à l'OS, bases de données administrées par SSH sans
exposer de port (lecture seule transactionnelle), extensions 100 % déclaratives,
planificateur en mode cron qui survit à la fermeture de l'application.
