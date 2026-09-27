# Audit fonctionnel et plan d'améliorations priorisé

**Branche auditée** : `Test-Neoofix` (HEAD `9ccf509`) — v0.5.0
**Date** : 2026-09-27
**Parc réel de référence** : 8 serveurs (4 nœuds Proxmox `.53`/`.55`/`.56`/`.2`, TrueNAS `.50`,
DockerSRV `.54`, VMs `192.168.20.10` DMZ et `192.168.30.10` LAN), authentification SSH par clé.
**Environnement** : production **sans sauvegarde possible** — cette contrainte gouverne toutes
les priorités ci-dessous.

## 1. Portée et méthode — ce qui a été fait, ce qui ne l'a pas été

### Réellement exécuté et vérifié

| Vérification | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `npx vitest run` | **63/63 fichiers, 450/450 tests passés** — mais en 21 min, dont 74 % d'attente d'E/S, et avec des crashs intermittents du lanceur (voir U0) |
| Connectivité ICMP réelle des 8 serveurs | **3 en ligne** (`.53`, `.2`, `.54`), 5 injoignables depuis le poste |
| Mesure latence réelle vs temps de processus `ping` | 2-34 ms réels contre 131-166 ms de processus |
| Inventaire commandes Tauri (recompté à la main) | 183 définies, 183 enregistrées, 159 invoquées, **0 invocation fantôme**, 24 jamais appelées |
| Audit de code par domaine | 6 domaines, constats sourcés `fichier:ligne` |

### Explicitement non fait, et pourquoi

- **Aucune action réseau vers les machines** hormis le `ping` : ni WoL, ni SSH, ni API Proxmox,
  ni SFTP, ni cron, ni Docker. Le parc étant en production sans sauvegarde, la marge de
  sécurité a été prise au maximum, y compris pour des actions pourtant sans impact comme le WoL.
- **L'interface graphique n'a jamais été lancée.** Aucun constat de ce document ne provient d'une
  observation visuelle. Les constats d'ergonomie sont des déductions du code, sourcées.
- **SSH sortant bloqué** par le classificateur de sécurité de l'environnement d'audit. Les chemins
  SSH / SFTP / Proxmox / batch / cron n'ont donc **pas** été validés à l'exécution. Leurs constats
  reposent sur la lecture du code. C'est la principale limite de cet audit : plusieurs bugs
  ci-dessous sont certains au niveau du code, mais leur fréquence réelle reste à confirmer en usage.

## 2. Synthèse — l'état réel de l'application

L'application est **techniquement bien construite mais dangereuse à utiliser en l'état** sur un
parc de production, pour une raison unique et récurrente : **elle ne dit pas la vérité sur ce
qu'elle a fait.**

Trois mécanismes distincts produisent le même effet :

1. Un arrêt SSH qui échoue affiche un toast **vert** de succès.
2. Une séquence « éteindre le lab » marque une étape **réussie** alors que la machine est
   injoignable ou que sa clé d'hôte a changé.
3. Le panneau de santé du cluster continue d'afficher « quorum OK » avec des données périmées
   après un échec de rafraîchissement.

À cela s'ajoute un déséquilibre net des garde-fous : le module Bases de données exige de retaper
le nom exact pour un `DROP DATABASE`, tandis qu'arrêter les 4 nœuds Proxmox d'un groupe, ou vider
un nœud entier de ses VMs, se fait **sans aucune confirmation**.

Le paradoxe est que la rigueur existe dans ce code : TOFU SSH authentique qui refuse d'envoyer un
secret avant vérification, échappement shell systématique testé contre un vrai shell, exports
purgés de secrets avec tests dédiés, synchronisation cron idempotente avec sauvegarde préalable,
chiffrement AES-256-GCM avec clé dans le coffre Windows. **Le savoir-faire est démontré ; il n'est
simplement pas appliqué uniformément.** C'est une bonne nouvelle : la plupart des correctifs
ci-dessous consistent à étendre un motif qui existe déjà ailleurs dans le projet.

### Chiffres de référence

- 183 commandes Tauri, 82 fichiers Rust (~42 000 lignes), 275 fichiers TS/TSX (~25 000 lignes)
- 19 pages routées (et non 24 : `src/pages/` contient 24 fichiers dont 5 de test)
- 63 fichiers de test, 442 cas — mais **5 pages testées sur 19**, et aucune des deux pages qui
  éteignent physiquement du matériel (`LabPower.tsx`, `Groups.tsx`)
- **9 commandes Tauri réellement inutilisées** : `save_probe`, `delete_probe`, `run_probe_now`,
  `get_probe_results`, `db_redis_command`, `ping_group`, `run_batch`, `sftp_stat`, `ssh_execute`.
  Quatre sur neuf sont le **moteur de sondes de services**, ce qui confirme indépendamment l'item
  A1 du benchmark (moteur complet et testé, sans aucune interface depuis le retrait de l'onglet
  Services). `sftp_stat` est précisément la commande nécessaire pour corriger U7, et `ping_group`,
  `run_batch`, `ssh_execute` sont des vestiges remplacés par `ping_all`, `smart_batch_run` et les
  chemins spécialisés.

## 3. Priorité urgente — fiabilité et sûreté

### U0. Le filet de sécurité n'existe pas : les tests ne tournent nulle part — VÉRIFIÉ

Deux défaillances indépendantes et cumulées, qui expliquent comment tous les bugs ci-dessous ont
pu survivre malgré 63 fichiers de test et 442 cas :

**(a) La suite passe, mais elle est trop lente et instable pour servir de filet.**

Résultat d'une exécution complète menée à terme :

```
Test Files  63 passed (63)
     Tests  450 passed (450)
  Duration  1280.95s  (environment 952.67s, collect 146.60s, setup 89.83s, tests 24.48s)
```

**Aucun test en échec** — la base de tests existante est saine. Mais la répartition du temps est
révélatrice : sur 21 minutes, **74 % du temps (952 s) est consommé par la mise en place de
l'environnement jsdom**, contre **24 secondes d'exécution réelle des tests**. Le reste est de
l'attente d'E/S, pas du calcul.

Cette lenteur rend la suite instable : plusieurs tentatives se sont soldées par un crash du
lanceur avant toute collecte, en mode `forks`, `threads`, `--singleFork` et `--isolate=false` :

```
Error: Worker exited unexpectedly
 ❯ ChildProcess.onUnexpectedExit node_modules/tinypool/dist/index.js:118:30
 Test Files  no tests / Tests  no tests / Errors  1 error / Duration  110.66s
```

Une autre exécution a rapporté `Error: UNKNOWN: unknown error, read` (`errno -4094`) sur
`node_modules/jsdom/lib/jsdom/living/generated/HTMLLinkElement.js` — un échec de **lecture de
fichier**, signature caractéristique d'un espace réservé OneDrive non réhydraté.

Une suite qui met 21 minutes et échoue une fois sur deux ne sera pas lancée pendant le
développement. C'est pourquoi elle ne protège rien en pratique, bien qu'elle soit verte.

**Cause racine mesurée** : le dépôt (34,7 Go) est stocké dans OneDrive avec les fichiers à la
demande, et l'essentiel de ses dépendances n'est **pas réellement sur le disque** :

| Dossier | Fichiers échantillonnés | Espaces réservés « cloud-only » |
|---|---|---|
| `node_modules` | 3000 | **2069 (69 %)** |
| `src-tauri/target` (10 Go) | 3000 | 1003 (33 %) |

`src-tauri/target` est lui-même un `ReparsePoint` marqué en lecture seule, et le processus OneDrive
avait consommé 56 minutes de CPU au moment de la mesure. Chaque lecture de fichier par `node` ou
`rustc` déclenche donc une réhydratation réseau. Symptômes concordants observés pendant l'audit :

- `cargo clippy` : 12 processus `rustc` vivants à **0 seconde de CPU sur 25 secondes** — tous
  bloqués en attente d'E/S, pas en train de compiler.
- `git status` : `fatal: mmap failed: Invalid argument` — `mmap` échoue sur un fichier fantôme.
- `vitest` : 110 s pour aboutir à un crash de worker, quel que soit le mode d'exécution.

Hypothèse écartée en cours d'audit : une incompatibilité `vitest`/Node. `vitest` 2.1.9 et
`tinypool` 1.1.1 déclarent tous deux `"node": "^18.0.0 || >=20.0.0"`, et l'environnement est en
Node v24.14.0 — nominalement supporté. Le versionnage n'est donc pas la cause.

**(b) Aucun workflow CI ne lance les tests.** `.github/workflows/` contient `release.yml`,
`claude.yml` et `claude-code-review.yml`. Seul `release.yml` installe Node (`node-version: lts/*`,
ligne 48) et **aucun fichier ne contient d'étape `npm test` ni d'appel à `vitest`**. Il n'existe
aucun workflow d'intégration continue exécutant la suite.

**Conséquence** : les 63 fichiers de test et 450 cas sont verts, mais ne protègent rien en pratique.
Trop lents et trop instables pour être lancés pendant le développement, jamais lancés à la
publication. Un test comme `VmCard.test.tsx`, qui verrouille aujourd'hui un comportement dangereux,
ou l'absence totale de test sur `ping.rs`, n'ont jamais eu de chance d'être remis en question.

**Correctif, à faire avant tout le reste** — sans cela, aucun correctif des lots suivants n'est
vérifiable en pratique :

1. **Sortir le dépôt de OneDrive.** C'est la correction déterminante, et elle règle d'un coup la
   lenteur des tests, les blocages de `cargo` et les échecs `mmap` de `git`. Déplacer le projet
   vers un chemin local (`C:\dev\server-manager`), et n'y conserver que la sauvegarde du code via
   Git — pas la synchronisation d'un dossier de build de 34,7 Go. Solution de repli si le dépôt
   doit rester dans OneDrive : exclure `node_modules` et `src-tauri/target` de la synchronisation,
   et marquer le reste « Toujours conserver sur cet appareil ».
2. **Ajouter un workflow CI de test** : `npm test` et `npx tsc --noEmit` sur chaque `push` et chaque
   `pull_request`, avec une version de Node **explicite** (pas `lts/*`, qui dérive au fil du temps).
3. Ajouter `src-tauri/target` à l'`exclude` de la configuration vitest : le scan de fichiers de test
   parcourt aujourd'hui les 10 Go de cache Rust pour rien.

Difficulté **faible**. C'est le prérequis de tout le reste.

### U1. L'échec d'un arrêt SSH s'affiche comme un succès — VÉRIFIÉ

`src-tauri/src/commands/ssh.rs:330-339` renvoie `Ok(SshResult { success: false, … })` quand la
commande distante sort avec un code non nul. La promesse JS **résout** donc normalement. Or aucun
des quatre points d'appel ne lit `result.success` :

- `src/components/ServerCard.tsx:31-45` (`runAction` : `try { await action(); onMessage(succès) }`)
- `src/pages/Servers.tsx:62-76`
- `src/pages/Groups.tsx:32-51`
- `src/components/CommandPalette.tsx:59-61`

Le champ est pourtant typé (`src/types/index.ts:154-158`).

**Scénario** : `sudo shutdown -h now` sur un serveur sans `NOPASSWD`. Pas de PTY demandé, `sudo`
échoue immédiatement, code non nul. Toast vert « Commande d'arrêt envoyée ». La machine tourne
toujours. Même effet pour une faute de frappe dans la commande, un `PATH` différent, une policy
SELinux.

**Correctif** : tester `result.success` dans les 4 points d'appel, afficher `result.error` et
`result.output` en cas d'échec ; pour les groupes, agréger (« 3 réussis, 1 échoué : truenas »).
Difficulté **faible**.

### U2. La séquence « Éteindre le lab » avale les erreurs, y compris une clé d'hôte modifiée — VÉRIFIÉ

`src-tauri/src/commands/lab_power.rs:196-201` :

```rust
match ssh_on(app, server_id, None, 30).await {
    Ok(()) => Ok(()),
    Err(e) if e.contains("Code de sortie") || e.to_lowercase().contains("connexion") => Ok(()),
    Err(e) => Err(e),
}
```

L'intention est légitime (la connexion SSH est coupée par l'arrêt lui-même), mais le filtre est
beaucoup trop large. Messages d'erreur réellement avalés :

- `"Timeout de connexion à {host}:{port}"` (`ssh.rs:131`) — machine **jamais joignable**
- `"Connexion SSH échouée à {host}:{port} — {e}"` (`ssh.rs:142`)
- `"Clé d'hôte SSH de {host}:{port} MODIFIÉE (SHA256:…) : connexion refusée, aucun identifiant
  envoyé. … sinon, quelqu'un se fait peut-être passer pour lui."` (`ssh.rs:133-141`) — contient
  le mot « connexion », donc **avalé**
- tout code de sortie non nul

**Conséquence** : une usurpation d'hôte potentielle, ou une machine injoignable, s'affiche comme
une étape **terminée en vert**, et la séquence enchaîne sur l'arrêt des nœuds Proxmox en croyant
l'étape précédente réussie.

**Correctif** : ne jamais avaler une erreur de type « clé d'hôte modifiée » ou « timeout de
connexion » — dans les deux cas l'authentification n'a jamais eu lieu, donc la commande n'a jamais
pu s'exécuter. Pour distinguer une vraie coupure post-exécution d'un échec réel, vérifier par ping
que la machine s'éteint effectivement avant de marquer l'étape terminée (le motif existe déjà pour
`WakeServer`, `lab_power.rs:212-219`). Difficulté **moyenne**.

### U3. Arrêt de groupe sans aucune confirmation — VÉRIFIÉ

`src/pages/Groups.tsx:193` appelle `shutdownGroup(group.id)` directement. Le seul `ConfirmDialog`
de la page (ligne 262) protège la **suppression de la définition** du groupe — une métadonnée
réversible — pas l'extinction physique des machines. Priorisation exactement inversée.

Le bouton est le 3ᵉ d'une rangée de 5 boutons compacts (`px-2.5 py-1.5`, `text-xs`, `Groups.tsx:163-215`),
différencié seulement par une bordure rouge, sans marge supplémentaire.

**Scénario** : le groupe « Cluster Proxmox » contient 4 serveurs. Un clic qui glisse depuis le
bouton WoL adjacent éteint les 4 nœuds.

**Correctif** : `ConfirmDialog dangerous` avant `shutdownGroup`, avec la liste nominative des
machines concernées ; phrase à retaper au-delà de 3 serveurs (le motif existe déjà dans
`lab_power.rs:17-24` et dans `DropDatabaseDialog`). Difficulté **faible**.

### U4. Aucune confirmation sur l'arrêt d'une VM Proxmox, et le seul arrêt disponible est brutal — VÉRIFIÉ

`src/components/VmCard.tsx` : `runAction` accepte `"shutdown"` dans son type (ligne 25) mais
**aucun bouton ne l'appelle jamais**. Seuls `start` (85), `stop` (98), `reboot` (109),
`suspend` (120) sont câblés, et le fichier ne contient aucun `ConfirmDialog`.

Or `VmAction::Stop` (`src-tauri/src/proxmox/models.rs:57-77`) correspond à l'endpoint Proxmox
`/status/stop` : coupure immédiate, équivalent d'un débranchement. `Shutdown` est l'arrêt ACPI propre.

**Conséquence** : le seul moyen d'arrêter une VM depuis l'application est un power-off matériel,
en un clic, sans confirmation. Pour une base de données ou un système de fichiers en production,
c'est la pire combinaison possible. L'interface web de Proxmox, elle, demande une confirmation.

Aggravant : `src/components/VmCard.test.tsx:42-53` **teste et verrouille** ce comportement
(le clic sur « Arrêter » appelle `proxmoxVmAction` sans dialogue). Un test de non-régression
protège aujourd'hui un bug.

**Correctif** : ajouter un bouton « Éteindre proprement » (`shutdown`), réserver `stop` comme
dernier recours marqué `dangerous` avec confirmation, et corriger le test. Difficulté **faible**.

### U5. Vider un nœud (drain) sans confirmation — VÉRIFIÉ

`src/components/DrainNodeModal.tsx:89` : `onClick={drain}` en direct. Deux clics depuis
`ClusterHealthPanel.tsx:94-96` lancent la migration en série de **tous les invités démarrés** d'un
nœud de production. C'est l'action la plus lourde de l'application et elle a moins de friction
qu'un rollback de snapshot (`VmSnapshotModal.tsx:170-179`, qui utilise bien `ConfirmDialog dangerous`).

**Correctif** : `ConfirmDialog dangerous` avec récapitulatif (nombre d'invités, cible, durée
estimée). Difficulté **faible**.

### U6. La latence affichée est fausse d'un facteur 30 à 60 — VÉRIFIÉ PAR MESURE

`src-tauri/src/commands/ping.rs:154-178` — `parse_ping_latency` cherche `"time="`, `"durée"`,
`"duree"`. Le motif réel sur Windows 11 **français** est `temps=5 ms`. Trois défauts cumulés :

1. `"temps="` n'est jamais recherché.
2. Même si la ligne matchait, `temps=5 ms` est découpé en deux tokens (espace avant `ms`), donc
   `part.strip_suffix("ms")` échoue sur le token `ms` seul.
3. La sortie de `ping.exe` est en page de code OEM, pas en UTF-8 : `String::from_utf8_lossy`
   corrompt les accents (observé : `R�ponse`), donc `"durée"` ne pourrait jamais matcher.

Repli systématique sur `elapsed` (`ping.rs:143-146`), soit le temps de lancement du processus.

**Mesures réelles sur `192.168.1.53`** : `ping` annonce 2, 34 et 2 ms ; le processus complet prend
131, 155 et 166 ms. L'application affiche donc ~130-170 ms en permanence, et **une vraie
dégradation réseau (2 ms → 50 ms) est totalement noyée** dans le bruit de lancement de processus.

`src-tauri/src/commands/ping.rs` contient **0 test** — seul fichier de parsing du domaine
supervision à ne pas être testé, ce qui explique que le bug ait survécu.

**Point positif** : la détection en ligne/hors ligne repose sur `out.status.success()`, pas sur le
texte — elle est donc correcte malgré ce bug, et le faux positif classique « le routeur répond
ICMP unreachable » ne s'applique pas.

**Correctif** : supprimer le parsing textuel (il n'apporte rien de fiable) et mesurer le RTT
autrement — soit `surge-ping` en ICMP natif, qui donne un RTT exact indépendant de la langue,
soit conserver `elapsed` mais en l'affichant honnêtement comme « temps de réponse mesuré côté
poste » et non comme une latence réseau. Ajouter des tests avec les sorties FR et EN réelles.
Difficulté **faible** (retrait) à **moyenne** (migration `surge-ping`).

### U7. Téléversement SFTP : écrasement silencieux et fichier partiel laissé en place — VÉRIFIÉ

`src-tauri/src/commands/sftp.rs:301-340` appelle `sftp.create(remote_path)` — sémantique
`CREATE | TRUNCATE | WRITE` (vérifié dans `russh-sftp 3.0.0`). Aucun test d'existence préalable,
ni côté Rust ni côté `FileExplorerPanel.tsx:287-302`.

Deux asymétries dans le même fichier :
- L'édition de texte, elle, **confirme** avant d'écraser (`FileExplorerPanel.tsx:202-216`) et
  `write_text_safely` fait une copie de secours (`sftp.rs:204-248`).
- Le téléchargement nettoie le fichier local partiel en cas d'échec (`sftp.rs:293-297`) ; le
  téléversement, non — il invalide seulement le pool et retourne l'erreur.

**Scénario** : déposer un `docker-compose.yml` dans un dossier qui en contient déjà un →
écrasement silencieux, sans sauvegarde. Si le réseau coupe en cours, le fichier de production
reste **tronqué**, sous son nom final.

**Correctif** : `sftp_stat` la cible avant écriture et réutiliser le `ConfirmDialog` déjà présent ;
écrire dans un fichier temporaire puis renommer, ou supprimer le fichier distant partiel en cas
d'échec. Difficulté **faible**.

### U8. TLS non vérifié par défaut sur les intégrations et Proxmox

`src-tauri/src/integrations.rs:36,185`, `src-tauri/src/proxmox/models.rs:13,133`,
`src-tauri/src/probes.rs:284-290`, `src/components/ProxmoxConnectionForm.tsx:21`.

`verify_tls` vaut `false` par défaut, et `http_client()` applique alors
`.danger_accept_invalid_certs(true)`. Tout jeton d'API Proxmox, toute clé d'intégration (ntfy,
Discord, Telegram, Zabbix, Home Assistant, OPNsense…) part donc sur une connexion HTTPS qui
**n'authentifie pas le serveur distant**, sauf si l'utilisateur coche manuellement la case — sans
qu'aucun texte n'explique l'enjeu.

Le choix est compréhensible (Proxmox et TrueNAS utilisent des certificats auto-signés par défaut),
mais il est appliqué trop largement et silencieusement.

**Correctif** : inverser le défaut à `true` et appliquer aux certificats auto-signés le **même
modèle TOFU que pour SSH** — épingler l'empreinte au premier contact plutôt que désactiver la
vérification. L'infrastructure existe déjà (`known_hosts.rs`). Prévoir un message de migration
pour les configurations existantes. Difficulté **moyenne**.

### U9. Repli silencieux vers un chiffrement faible si le coffre Windows est indisponible

`src-tauri/src/lock/mod.rs:194-203` et `src-tauri/src/crypto.rs:217-223`.

Si `keystore::load_or_create` échoue, un simple `log::warn!` est émis et l'application continue sur
le schéma `KEY_VERSION` 1 : la clé AES est `SHA-256("server-power-manager-v1-encryption-key" || sel)`
où le sel est stocké **en clair dans le même `data.json`** que les secrets chiffrés. Ce n'est pas un
KDF : pas d'itérations, pas de facteur de coût. Quiconque récupère `data.json` seul recalcule la clé
en une opération et déchiffre tous les mots de passe SSH, clés privées et jetons.

**Scénario réaliste, aggravé par ce projet précis** : le dossier est dans OneDrive. Une
synchronisation vers un autre poste, ou une restauration de sauvegarde sur une machine où DPAPI ne
restitue pas l'entrée (profil différent), suffit à faire retomber l'application en mode faible —
**sans que rien ne l'indique dans l'interface**.

**Correctif** : (a) bannière permanente dans l'UI quand la clé maître n'est pas protégée par le
coffre système ; (b) remplacer la dérivation SHA-256 par Argon2id — le module possède déjà
`crypto::derive_kek`. Difficulté **faible** pour la bannière, **moyenne** pour le KDF.

### U10. Données Proxmox périmées affichées comme fraîches

`src/components/ClusterHealthPanel.tsx:27-33` : en cas d'échec du rafraîchissement, `setError` est
appelé mais **`health` n'est jamais remis à `null`**. Le rendu ne teste `error` que dans la branche
`error && !health` (ligne 41). Donc après un premier chargement réussi, tout échec ultérieur est
absorbé : le panneau continue d'afficher l'ancien `quorate`, les anciens `nodes[].online`, sans
horodatage ni badge « périmé ». Le poll est à 60 s (ligne 37).

Même défaut sur la liste des VMs : `src/stores/useStore.ts:522-535` conserve `proxmoxVms` en cas
d'erreur, et `src/pages/Proxmox.tsx:124-128` laisse les boutons Start/Stop/Migrer **pleinement
actifs** sur ces données potentiellement obsolètes.

**C'est précisément le scénario du parc réel** : 3 des 4 nœuds étaient injoignables pendant l'audit.
L'application peut afficher « quorum OK, 4/4 nœuds en ligne » plusieurs minutes après que ce soit
faux, et proposer d'agir dessus.

**Correctif** : afficher « dernière mise à jour réussie il y a X s », griser les actions quand la
dernière tentative a échoué. La logique métier de santé est par ailleurs solide et testée
(`proxmox/health.rs:200-229`) — c'est seulement sa présentation qui trahit. Difficulté **moyenne**.

### U11. Une erreur réseau pendant une migration est annoncée comme un échec de migration

`src/components/MigrateModal.tsx:9-16` — `waitTask` boucle sur `invoke("proxmox_task_status")` sans
`try/catch`. Un seul échec d'appel (nœud qui devient injoignable, API qui répond mal) remonte au
`catch` de `start()` (lignes 51-53) qui affiche **« Migration échouée »** — alors que la tâche
Proxmox continue côté serveur.

**Risque concret** : l'utilisateur relance la migration → double migration concurrente du même
invité. `DrainNodeModal.tsx:44-51` réutilise `waitTask` et enchaîne malgré tout sur l'invité suivant.

**Correctif** : distinguer dans `waitTask` une erreur de **sondage** (retenter avec backoff, garder
l'état « en cours ») d'un `exitstatus` réellement en échec. Difficulté **moyenne**.

### U12. Docker : arrêt et redémarrage sans confirmation, incohérents avec le module BDD

`src/pages/Docker.tsx:226-227` — `act(c, "stop")` et `act(c, "restart")` en direct, simple style
`danger`. Or la **même** base de données, arrêtée depuis `Databases.tsx`, exige un
`ConfirmDialog dangerous`. Le chemin le moins protégé reste ouvert pour n'importe quel conteneur.

**Correctif** : harmoniser avec `Databases.tsx`. Difficulté **faible**.

### U13. `db_service_action` ignore complètement les conteneurs Docker

`src-tauri/src/commands/db_admin.rs:255-266` ne prend pas de paramètre `container` et exécute
toujours `sudo systemctl {action} <service>` sur l'hôte (`db_admin.rs:605-610`), même quand le
moteur détecté tourne dans un conteneur (`DetectedEngine.container`, `db_admin.rs:221-229`). Le
front ne transmet pas non plus l'information (`Databases.tsx:185-195`).

**Scénario** : arrêter un PostgreSQL conteneurisé sur DockerSRV (`.54`) tente d'arrêter un service
systemd inexistant. Échec remonté de façon générique, sans indiquer que la commande n'a jamais visé
le bon composant — et la base continue de tourner.

**Correctif** : ajouter le paramètre `container` et router vers `docker stop/restart <container>`.
Difficulté **faible**.

## 4. Priorité moyenne — ergonomie, robustesse, dette

### Sûreté et cohérence des actions

| # | Constat | Source | Correctif | Difficulté |
|---|---|---|---|---|
| M1 | Aucune vérification post-arrêt ni post-WoL sur les cartes serveur et les groupes (le lab, lui, attend le ping jusqu'à 5 min) | `lab_power.rs:212-219` vs `ServerCard`/`Groups` | Ping différé 10-30 s après l'action, statut « en cours d'extinction… » → « hors ligne confirmé » | Moyenne |
| M2 | `ssh_shutdown_group` itère les serveurs dans l'ordre de stockage, sans notion de topologie : un groupe « Cluster Proxmox » peut couper un nœud avant ses VMs | `commands/ssh.rs:424-475` | Réutiliser `shutdown_plan`/`startup_plan` pour les groupes, ou détecter la présence d'un nœud Proxmox et avertir | Moyenne |
| M3 | Le lot (`Batch`) est en mode **Parallèle par défaut**, sans friction renforcée ni arrêt possible après lancement | `batch.rs:11-16`, `Batch.tsx:143,591-593` | Confirmation à retaper quand `modifying` ; proposer « tester sur un seul serveur d'abord » | Moyenne |
| M4 | `looksModifying()` est une liste de regex fixe : `docker compose down -v`, `find … -delete`, `zfs destroy`, tout script maison passent en bouton bleu anodin | `src/utils/batch.ts:4-17` | Inverser la logique (tout script personnalisé est présumé modifiant) ou élargir nettement les motifs | Faible |
| M5 | Incohérence `dangerous` : le redémarrage est marqué dangereux depuis `Servers.tsx:324` mais pas depuis `ServerCard.tsx:218-233` — même action, même serveur, deux apparences | idem | Factoriser dans un hook `useServerPowerConfirm` partagé par les 3 emplacements | Moyenne |
| M6 | Les boutons dpkg « Garder ma version » / « Version du mainteneur » ont un style identique, sur des cartes quasi identiques en mode parallèle | `src/utils/batch.ts:69-70` | Différencier visuellement l'option destructrice | Faible |
| M7 | Import de configuration : aucune validation d'IP/MAC, et l'aperçu ne montre **jamais** le contenu des `shutdown_command`/`reboot_command` importées | `commands/settings.rs:85-104,275-283` | Appeler `validate_server_payload` sur chaque serveur importé ; afficher les commandes qui diffèrent du défaut de l'OS | Moyenne |
| M8 | `send_magic_packet` accepte des MAC malformées (`"1:2:3:4:5:6"`) que `is_valid_mac` refuse | `wol.rs:106-116` vs `servers.rs:301-304` | Réutiliser `is_valid_mac` avant construction du paquet | Faible |

### Robustesse et performance

| # | Constat | Source | Correctif | Difficulté |
|---|---|---|---|---|
| M9 | Les métriques rouvrent une session SSH **complète toutes les 15 s par serveur**, avec un `sleep 1` embarqué — risque de déclencher `fail2ban`/`sshguard` | `commands/ssh.rs:258`, `metrics.rs:37-39` | Porter l'intervalle par défaut à 30-60 s ; envisager un pool de sessions | Moyenne |
| M10 | Aucun verrou par serveur autour de `sync_command` : deux tâches planifiées enregistrées coup sur coup peuvent s'écraser mutuellement dans la crontab | `commands/schedules.rs:90-102` | `HashMap<server_id, Mutex<()>>` sérialisant `apply_cron_ops` | Faible |
| M11 | Le badge d'état n'est pas débouncé : une perte ICMP isolée fait clignoter rouge pendant 30 s, alors que l'historique et les alertes sont correctement filtrés à 2 échecs | `monitor.rs:68-91`, `usePing.ts:15` vs `events.rs:12` | Appliquer le même anti-rebond à l'affichage, ou un état « instable » intermédiaire | Faible |
| M12 | Timeouts SSH codés en dur dans la séquence de lab (30 s / 240 s), ignorant `ssh_timeout_secs` configuré | `lab_power.rs:198,230` | Utiliser le réglage utilisateur | Faible |
| M13 | Le plan exécuté est recalculé et peut différer de celui affiché et confirmé par la phrase à recopier | `lab_power.rs:108-117` vs `142-154` | Transmettre le plan simulé à `lab_power_execute` et signaler tout écart | Faible/Moyenne |
| M14 | Aucune échéance sur la boucle interactive du lot : une invite non reconnue laisse la tâche « running » indéfiniment et bloque la file séquentielle | `commands/ssh.rs:204-255` | Avertissement après N secondes sans réponse | Faible |
| M15 | `execute_ssh_interactive` accumule toute la sortie dans une `String` sans plafond | `commands/ssh.rs:223,240` | Borner la taille conservée | Faible |
| M16 | Pas de pagination SFTP, et chaque lien symbolique déclenche un `metadata()` **séquentiel** | `commands/sftp.rs:86-134` | `join_all` sur les résolutions de liens ; pagination côté backend | Faible/Moyenne |
| M17 | Permissions de `data.json` et `known_hosts.json` non durcies explicitement, alors que les fichiers **distants** reçoivent bien un `0600` | `storage.rs:51`, `known_hosts.rs:70` vs `sftp.rs:220` | ACL Windows restreinte au compte utilisateur | Faible/Moyenne |
| M18 | `import_config` (API legacy) désérialise un JSON non fiable sans limite de profondeur — dépassement de pile possible | `commands/settings.rs:85-104` | Basculer sur `validate_import_json` comme la voie moderne | Faible |
| M19 | Secrets en clair hors du champ dédié : scripts de lot, snippets, `shutdown_command` ne sont pas chiffrés (seul `ssh_password` l'est) | `models.rs:50`, `storage.rs:156` | Étendre le chiffrement, ou au minimum avertir à l'enregistrement | Moyenne / Faible |

### Interface et architecture frontend

| # | Constat | Source | Correctif | Difficulté |
|---|---|---|---|---|
| M20 | `useToast()` crée un état **local** ; 20 fichiers montent chacun leur `ToastContainer` en `fixed bottom-4 right-4`. Dans Paramètres → Général, deux conteneurs se superposent au pixel dès le premier lancement | `hooks/useToast.ts:6-46`, `Toast.tsx:51-58`, `Settings.tsx:96,225` | Un store unique, un seul `ToastContainer` monté à la racine | Moyenne |
| M21 | `ConfirmDialog` — le composant qui protège toutes les actions destructrices — n'a ni `role="dialog"`, ni `aria-modal`, ni piège de focus. `Tab` peut sortir et activer la page sous l'overlay. Seules 4 des ~17 modales ont `role="dialog"` | `ConfirmDialog.tsx:34-84` | Reprendre le patron de `LockScreen.tsx:60-63`, qui fait tout correctement | Moyenne |
| M22 | Store monolithique de 874 lignes couvrant ~15 domaines, consommé **sans sélecteur dans 41 fichiers** (contre 15 avec). Chaque `metrics-update` re-render `Layout.tsx` et ses 150 lignes de glisser-déposer | `stores/useStore.ts`, `Layout.tsx:62` | Découper par domaine et migrer vers `useStore(s => s.x)` | Élevée |
| M23 | Les boutons d'action des cartes serveur, **Supprimer inclus**, sont de taille identique et ne se distinguent qu'au survol | `ServerCard.tsx:77-121` | Séparateur et couleur au repos pour l'action destructrice | Faible |
| M24 | 9 commandes Tauri inutilisées, dont 4 pour le moteur de sondes sans interface, et `sftp_stat` qui servirait à corriger U7 | recomptage vérifié | Brancher les sondes (item A1 du benchmark), utiliser `sftp_stat` pour U7, supprimer les vestiges (`ping_group`, `run_batch`, `ssh_execute`, `db_redis_command`) | Faible |
| M25 | `Databases.tsx` : 33 `useState` ; `Batch.tsx` : 22 | mesuré | `useReducer` ou découpage en sous-composants | Moyenne |
| M26 | `useDashboardTabSync.ts:9,17` appelle `resizeDashboardTab` sans `.catch()` dans un `ResizeObserver` → rejet de promesse non géré | idem | Ajouter le `.catch()` | Triviale |

### Couverture de tests

> **Rappel U0** : les tests existants passent tous (63/63, 450/450), mais mettent 21 minutes et ne
> sont lancés par aucune CI. La faiblesse n'est donc pas leur fiabilité — c'est leur **périmètre**,
> détaillé ci-dessous, et le fait qu'ils ne tournent pas assez souvent pour attraper une régression.

Les fonctions pures sont bien couvertes (21 fichiers de test dans `utils/`), et
`CommandPalette.test.tsx` vérifie explicitement le bon comportement de confirmation — c'est le test
le plus utile du projet vis-à-vis du risque réel. Mais **ce qui éteint du matériel n'est pas testé** :

- `LabPower.tsx`, `Groups.tsx`, `Servers.tsx`, `ServerCard.tsx`, `ServerForm.tsx` : **aucun test**
- `ConfirmDialog.tsx` — le garde-fou générique — **aucun test dédié**
- `Console.tsx`, `TerminalView.tsx`, `Proxmox.tsx`, `Docker.tsx`, `Dashboard.tsx`, `Settings.tsx` : aucun test
- `src-tauri/src/commands/ping.rs` : 0 test
- SFTP : rien sur le téléversement, l'écrasement, la suppression, les noms non-ASCII ou avec espaces

**M27** — Ajouter en priorité des tests d'intégration calqués sur `CommandPalette.test.tsx` pour
ces 5 fichiers frontend, plus un module `#[cfg(test)]` sur `ping.rs` avec les sorties FR et EN
réelles. À faire **en même temps** que les correctifs U1-U7, pour verrouiller le comportement corrigé.
Difficulté **moyenne**.

## 5. Priorité faible — confort et produit

| # | Constat | Source | Correctif |
|---|---|---|---|
| F1 | Libellés de catégories d'icônes codés en dur en français, jamais passés par `t()` — resteront en français en anglais | `IconPicker.tsx:29,41,57,70,91` | Clés `iconPicker.*` |
| F2 | Le garde-fou anti-texte-en-dur (`i18n/untranslated.test.ts`, excellente idée) ne visite que `JsxText` et une liste d'attributs — il ne voit pas une chaîne assignée à une propriété d'objet puis interpolée, ce qui est exactement le cas de F1 | `untranslated.test.ts:52-54` | Étendre le visiteur AST, ou documenter la limite |
| F3 | `#` non filtré dans les commandes cron : troncature silencieuse possible par le shell distant | `cron.rs:38-45` | Rejeter comme le saut de ligne |
| F4 | Adresse de broadcast WoL figée à `255.255.255.255` — problématique en multi-VLAN / multi-NIC, alors que le cahier des charges initial demandait ce réglage | `wol.rs:133-137` | Champ `broadcast_address` par serveur, ou émission sur chaque broadcast de sous-réseau |
| F5 | Un statut « hors ligne » ne distingue pas une machine éteinte d'une machine non routée depuis le poste — les VMs `192.168.20.10` et `192.168.30.10` apparaissent mortes alors qu'elles tournent | `commands/ping.rs`, aucune mention dans l'UI | Avertir quand l'IP n'est pas dans un sous-réseau joignable ; documenter que le statut est relatif au poste |
| F6 | Aucune distinction entre « éteint volontairement » et « en panne » : un `qm shutdown` et une panne produisent le même événement | `events.rs` | `EventKind` dédié quand l'Offline suit une action lancée par l'app ; fenêtre de maintenance |
| F7 | L'historique de latence est stocké (`ping_samples`/`ping_hourly`) mais aucune page ne trace de tendance | `db.rs`, `Sparkline` limité au CPU/RAM | Courbe de latence (une fois U6 corrigé) |
| F8 | Deux pages nommées « Dashboard » et « Dashboards » dans la même barre latérale | `Layout.tsx:32,49` | Renommer (« Vue d'ensemble » / « Interfaces web ») |
| F9 | `Batch` recoupe les actions de groupe de `Groups.tsx` et de la palette | — | Fusionner comme mode « avancé » de Groups |
| F10 | `Network.tsx` + `NetworkGraph.tsx` (565 lignes) : une topologie graphique pour 8 machines connues | — | Rétrograder en widget du Dashboard |
| F11 | Trois vues d'historique sans passerelle (Logs, History, événements de Console) | — | Une page « Historique » à onglets |
| F12 | Le module `proxmox` est `essential:false`, donc **masqué par défaut** — alors que le parc compte 4 nœuds Proxmox | `utils/modules.ts:30-45`, `Onboarding.tsx:16` | Le cocher par défaut, ou le proposer à la détection |
| F13 | Pas de détection de mise à jour d'image Docker (annoncée dans le README) : `docker.rs` ne fait que `docker ps`/`docker stats` | `docker.rs` | `docker image ls --digests` + comparaison registre |
| F14 | Pas de recherche dans le scrollback du terminal (seul `FitAddon` est chargé) | `TerminalView.tsx:64-65` | Déjà planifié : item **C1** du plan de benchmark |
| F15 | Explorateur SFTP sans sélection multiple, glisser-déposer, transfert parallèle ni reprise | `FileExplorerPanel.tsx` | Déjà partiellement couvert par le plan de benchmark |

## 6. Ce qui est réellement bien fait — à ne pas casser

Ces éléments sont d'un niveau nettement supérieur à la moyenne des outils de ce type et servent de
**modèle interne** pour les correctifs ci-dessus :

- **TOFU SSH authentique** : `check_server_key` refuse la connexion **avant** authentification en
  cas d'empreinte modifiée, aucun secret n'est envoyé, message explicite distinguant « clé
  changée » de « jamais vue ». Testé de bout en bout contre un vrai serveur, rebond inclus
  (`commands/ssh.rs:40-55`, `known_hosts.rs`).
- **Échappement shell systématique et testé contre un vrai shell** (`shell_quote`,
  `db_admin.rs`, `cron.rs`), whitelist stricte des identifiants de paquet/service avant
  interpolation, testée contre `"nginx; rm -rf /"` et `"$(whoami)"` (`smart_batch.rs:666-672`).
- **Anti-traversée de chemin SFTP robuste**, testée avec des cas adverses
  (`/../../etc/passwd` → `/etc/passwd`, jamais au-dessus de la racine) — `sftp.rs:24-101`.
- **Aucune commande shell construite pour l'explorateur de fichiers** : tout passe par le
  protocole SFTP, ce qui élimine structurellement une classe entière de bugs.
- **Exports systématiquement purgés de secrets**, avec tests dédiés vérifiant l'absence de toute
  trace, y compris chiffrée, des mots de passe, clés privées et jetons (`commands/settings.rs`).
- **`Debug` manuel sur les structures sensibles** pour empêcher toute fuite par `{:?}`, vérifié par
  test (`ssh_auth.rs:38-57,254-262`).
- **Synchronisation cron idempotente** : sauvegarde du crontab avant modification, filtrage par tag
  `# server-manager:<id>`, refus d'écrire si la lecture échoue pour une raison autre que
  « pas de crontab », périmètre strictement limité au crontab utilisateur (`cron.rs:56-63`).
- **Réponses aux invites interactives strictement pilotées par un clic humain** — aucun code ne
  répond automatiquement à quoi que ce soit (`batch.rs:119-124`, testé).
- **Moteur d'alertes avec double hystérésis** (durée de maintien + cooldown 30 min), testé contre
  le scénario de tempête de notifications : une coupure de 30 s ne déclenche **rien** (`alerts.rs:94-112`).
- **Rétention d'historique réellement implémentée** : purge horaire, agrégats, `auto_vacuum`
  incrémental — le fichier ne grossit pas indéfiniment (`db.rs:603-618,694-716`).
- **Métriques honnêtes** : en cas d'échec de collecte, l'app affiche « inconnu », jamais un 0 %
  mensonger (`commands/metrics.rs:37-53`, `useStore.ts:601-609`, testé).
- **Sauvegarde automatique avant restauration de configuration** (`commands/backup.rs:100-104`).
- **`DropDatabaseDialog`** : confirmation + saisie du nom exact. **C'est le modèle à généraliser**
  aux actions U3, U4, U5 (`Databases.tsx:414-435`).
- **`LockScreen.tsx:60-63`** : `role="dialog"`, `aria-modal`, `aria-label`, `autoFocus` correct,
  `role="alert"`. **Le modèle d'accessibilité à généraliser** aux ~13 autres modales.
- **Surface Tauri minimale** : pas de plugin `shell`, allow-list commande par commande, CSP
  restrictive (`capabilities/main.json`).
- **Monitoring côté Rust**, indépendant de la fenêtre — pas de gel quand elle est masquée.
- **Mode simulation du lab** (`lab_power_plan`) et ordonnancement réellement pensé (invités →
  stockage → nœuds → pare-feu en dernier), avec des tests modélisant le parc réel.

## 7. Ordre d'exécution recommandé

**Lot 0 — rétablir le filet (quelques heures)**
U0. Sans suite de tests exécutable et sans CI qui la lance, rien de ce qui suit n'est vérifiable.
À faire en premier, avant même le lot 1.

**Lot 1 — « l'app ne doit plus mentir » (1 à 2 jours, tout en difficulté faible)**
U1, U3, U4, U5, U12 puis U6. Aucun ne demande de refonte : ce sont des lectures de champ, des
`ConfirmDialog` réutilisés et un parsing à supprimer. C'est le lot qui transforme l'outil de
« risqué » à « utilisable en production ».

**Lot 2 — fiabilité des séquences (2 à 4 jours)**
U2, U7, U10, U11, U13, M1. Nécessite de raisonner sur les états intermédiaires (en cours,
périmé, confirmé) — c'est le vrai travail de fond.

**Lot 3 — sécurité au repos et en transit (2 à 3 jours)**
U8, U9, M17, M18, M19.

**Lot 4 — tests de verrouillage (en parallèle des lots 1-2, non après)**
M27. Chaque correctif des lots 1 et 2 arrive avec son test, en commençant par corriger
`VmCard.test.tsx` qui verrouille aujourd'hui un bug.

**Lot 5 — ergonomie et dette**
M20, M21, M5, M23, M3, M4, puis M22 (le découpage du store est le seul chantier vraiment lourd).

**Lot 6 — produit**
F8 à F13, en arbitrant l'ampleur fonctionnelle : 19 pages et 25 000 lignes de frontend pour
8 machines, c'est une surface de maintenance disproportionnée. Ce n'est pas un défaut technique,
c'est un choix à assumer explicitement.

## 8. Articulation avec le plan de benchmark existant

`docs/superpowers/plans/2026-09-27-benchmark-integration-native.md` (items C1-C18, M1-M2) traite de
la **parité concurrentielle** : ce qu'il faut ajouter pour rivaliser avec MobaXterm, Termius,
Portainer ou Uptime Kuma. Le présent document traite d'un axe orthogonal : **la correction, la
sûreté et l'honnêteté de ce qui existe déjà**.

Recommandation : **exécuter les lots 1 à 3 avant d'entamer la phase 1 du plan de benchmark.**
Ajouter la recherche dans le terminal (C1) ou les liens cliquables (C2) à une application dont un
arrêt échoué s'affiche en vert n'améliore pas sa valeur réelle. Deux chevauchements utiles à noter :
F14 correspond à C1, et F15 recoupe les items sur l'explorateur de fichiers.

---

*Audit réalisé par analyse statique du code, mesures réseau ICMP en lecture seule et vérification
de compilation. Aucune action n'a été exécutée sur les machines du parc. Les chemins SSH, SFTP,
Proxmox, batch et cron n'ont pas été validés à l'exécution.*
