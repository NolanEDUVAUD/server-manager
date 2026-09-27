# Benchmark concurrentiel — index et priorités

Trois documents, produits le 27/09/2026 à partir d'une collecte en ligne (prix et éditions
indicatifs) puis confrontés au code de la version 0.5.0 :

| Document | Modules | Préfixes |
|---|---|---|
| [Console](2026-09-27-benchmark-integration-native.md) | Console SSH, explorateur de fichiers | C1–C18, M1–M2 |
| [Supervision, serveurs et réseau](2026-09-27-benchmark-modules-supervision-reseau.md) | Dashboard, Serveurs/Groupes, Arrêt/démarrage, Ressources, Historique, Alertes, Réseau | D, S, P, R, A, N |
| [Infrastructure, automatisation, données et sécurité](2026-09-27-benchmark-modules-infra-automatisation.md) | Docker, Proxmox, Sauvegardes, Tâches en lot, Planificateur, Mises à jour, Logs, Bases de données, Onglets web, Intégrations, Sécurité, Extensions, Paramètres | K, X, B, T, H, U, L, Q, W, Z, E, G |

Un **quatrième document** complète l'ensemble sur un axe différent :

| Document | Objet | Préfixes |
|---|---|---|
| [Audit fonctionnel et plan d'améliorations](2026-09-27-audit-fonctionnel-et-plan-ameliorations.md) | Correction, sûreté et honnêteté de ce qui existe déjà | U0–U13, M1–M27, F1–F15 |

Les trois documents de benchmark répondent à « que manque-t-il face à la concurrence ». L'audit
répond à « ce qui existe fonctionne-t-il et dit-il la vérité ». Les deux axes sont complémentaires,
mais **ils ne se valent pas dans l'ordre d'exécution** : voir le tri ci-dessous.

## Fonctions existantes mais invisibles ou inexploitées (à traiter en premier)

- **Sondes de services** (`probes.rs` : HTTP avec assertion JSON, TCP, expiration TLS, authentification) : moteur complet et testé, relié aux alertes, mais plus aucune page depuis le retrait de l'onglet Services → **A1** (remplace aussi M1).
- **Proxmox Backup Server** : déclaré dans les intégrations avec test de connexion, jamais exploité → **X2/B2**.
- **Mises à jour** limitées à apt alors que les Tâches en lot reconnaissent 9 familles de paquets → **U1**.
- **Journaux Docker** statiques (`--tail`), sans suivi en direct → **K1**.

## Tri des propositions au regard de l'audit

### Propositions à ne pas démarrer avant le correctif dont elles dépendent

Construire ces fonctions sur la base actuelle produirait une fonctionnalité qui affiche des
données fausses ou qui amplifie un défaut de sûreté existant.

| Proposition | Bloquée par | Raison |
|---|---|---|
| **R2** (débit réseau), **R1** (rapport de disponibilité), **D1** (widgets) | **U6** | La latence affichée est fausse d'un facteur 30 à 60 (parsing du ping Windows francophone). Tracer une tendance ou publier un rapport de disponibilité sur cette donnée, c'est mettre en forme du bruit de lancement de processus. |
| **P3** (notification avant un arrêt programmé) | **U1**, **U2** | Un arrêt qui échoue s'affiche aujourd'hui comme un succès. Prévenir l'utilisateur avant un arrêt qui échouera ensuite silencieusement aggrave la confusion au lieu de la réduire. |
| **K2** (pause / unpause de conteneur) | **U12** | `Docker.tsx` n'a aucune confirmation sur `stop`/`restart`. Ajouter une action d'état supplémentaire sans garde-fou étend le problème. À livrer avec sa confirmation, ou après U12. |
| **X1** (console noVNC) | **U10** | Le module Proxmox affiche des données périmées comme fraîches après un échec de rafraîchissement. Ouvrir une console sur une VM listée à tort comme démarrée est trompeur. |
| **H2** (historique des exécutions planifiées) | **M10** | Aucun verrou par serveur autour de la synchronisation cron : deux écritures concurrentes peuvent s'écraser. Un historique qui enregistre des exécutions perdues ne sert à rien. |

### Propositions qui sont en réalité des correctifs — à revaloriser

Ces items du benchmark répondent à un défaut identifié par l'audit. Ils valent plus que leur rang
initial ne le suggère.

| Proposition | Répond à | Apport réel |
|---|---|---|
| **A5** (fenêtres de maintenance) | **F6** | L'app ne distingue pas « éteint volontairement » d'« en panne ». C'est la correction propre de ce défaut, pas un simple confort. |
| **A4** (dépendances d'alerte) | **M2**, **F5** | Traite à la fois le bruit d'alerte en cascade et le cas des machines non routées depuis le poste de supervision (VLAN 20/30). |
| **G2** (vérification post-sauvegarde) | contexte | Le parc est en production **sans sauvegarde**. Une sauvegarde non vérifiée est une sauvegarde supposée. Priorité bien plus haute que « phase 3 ». |
| **T1 / T2** (historique et relance des lots) | **M3**, **M4** | Le lot est en mode parallèle par défaut sans friction ni reprise. Savoir ce qui a échoué et relancer seulement ça réduit directement le risque. |
| **Z1** (journal de sécurité) | **U2** | Un rejet de clé d'hôte est aujourd'hui noyé, voire avalé. Une vue dédiée le rend visible. |

### Redondances à mutualiser avant de les implémenter

Quatre items décrivent le même besoin : **N5**, **S1**, **R1** et **Q3** sont tous des exports CSV,
et **S2** l'import symétrique. À traiter comme **un seul utilitaire d'export/import partagé** avec
quatre points d'appel, et non quatre implémentations. Idem pour les historiques : **T1**, **H2**,
**Q1** et **G1** décrivent quatre journaux d'exécution qui gagneraient à partager un même socle.

### Gains immédiats confirmés par la lecture du code

Le backend est déjà en place pour ces items, le travail est essentiellement côté interface :

- **A1** (page Services) : `save_probe`, `delete_probe`, `run_probe_now`, `get_probe_results`
  existent, sont testés, et figurent parmi les **9 seules commandes Tauri inutilisées** du projet
  (4 sur 9 sont ce moteur). Meilleur rapport valeur/effort de tout le lot.
- **U1** (mises à jour multi-famille) : `smart_batch` reconnaît déjà 9 familles de paquets.
- **U7 de l'audit** (écrasement SFTP) : `sftp_stat` existe déjà, non branchée — le correctif devient
  trivial.

## Proposition d'ordre pour les prochaines itérations

0. **Rétablir le filet** : **U0** de l'audit (sortir le dépôt de OneDrive, ajouter une CI qui lance
   les tests). Sans cela, rien de ce qui suit n'est vérifiable : la suite met 21 minutes, échoue par
   intermittence, et aucun workflow ne l'exécute.
1. **Cesser de mentir** : lot 1 de l'audit (**U1**, **U3**, **U4**, **U5**, **U12**, **U6**). Une à
   deux journées, tout en difficulté faible. C'est ce qui fait passer l'outil de « risqué sur un parc
   de production » à « utilisable ».
2. **Visibilité** : **A1**, **U1** (benchmark), **K1**, **C1** (recherche terminal), **C2** (liens),
   **C3** (reconnexion + keepalive).
3. **Fiabilité des séquences** : lot 2 de l'audit (**U2**, **U7**, **U10**, **U11**, **U13**), puis
   **G2**, **T1/T2**, **Z1**.
4. **Confort quotidien** : **C4** (barre de ressources), **Q1–Q3**, **D1** et les exports CSV
   mutualisés (**S1**, **N5**, **R1**, **Q3**) — après **U6**.
5. **Fonctions structurantes** : **C7** (diffusion), **C8** (volets), **C9** (tunnels), **A4/A5**,
   **P1** (onduleur/NUT), **X1/X2**.
6. **Décisions produit** : phases 3 des trois documents, et l'arbitrage d'ampleur soulevé par
   l'audit (19 pages et 25 000 lignes de frontend pour 8 machines).

## Déjà en avance sur la concurrence

Arrêt/démarrage ordonné du lab (Lab Power), Wake-on-LAN intégré et programmable,
Proxmox natif, Tâches en lot adaptées à l'OS, bases de données administrées par SSH sans
exposer de port (lecture seule transactionnelle), extensions 100 % déclaratives,
planificateur en mode cron qui survit à la fermeture de l'application.
