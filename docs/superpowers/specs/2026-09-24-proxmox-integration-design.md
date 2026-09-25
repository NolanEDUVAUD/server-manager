# Server Manager v2 — Intégration Proxmox (Design)

## Contexte et vision

`server-manager` est une application desktop Tauri v2 + React + Rust pour gérer un homelab (Proxmox, TrueNAS, VMs Docker). Elle couvre aujourd'hui : CRUD serveurs/groupes, Wake-on-LAN, arrêt/redémarrage SSH (commande unique), ping/statut, thèmes et paramètres.

Un projet séparé, HyperMonitor (dashboard web Flask + agents Python pour métriques CPU/RAM/disk), a été envisagé puis **abandonné** au profit de `server-manager` : plutôt que de maintenir deux outils qui se recoupent, toutes les fonctionnalités visées (gestion Proxmox, gestion TrueNAS, terminal SSH interactif, interface soignée) sont désormais construites dans `server-manager`.

### Roadmap complète (4 phases)

1. **Intégration Proxmox** (ce document — VMs/LXC : liste, contrôle complet, snapshots, clonage)
2. Intégration TrueNAS (pools ZFS, datasets, partages, scrub, remplacement disque)
3. Terminal SSH interactif (xterm.js + streaming, remplace l'exécution de commande unique actuelle)
4. Métriques à la demande via SSH pour serveurs génériques (non-Proxmox/non-TrueNAS) — remplace l'agent Python HyperMonitor abandonné

Les phases 2 à 4 sont décrites à haut niveau en fin de document pour situer le contexte ; chacune aura son propre spec détaillé avant son plan d'implémentation, suivant le même schéma que celui-ci.

## Portée de ce document : Phase 1 — Intégration Proxmox

**Niveau de contrôle** : contrôle complet (pas juste lecture seule) — start/stop/restart/shutdown, snapshots (créer/lister/restaurer), clonage de VM/LXC.

**Environnement réseau** : dashboard/app utilisés en LAN/VPN uniquement (pas d'exposition internet). Les instances Proxmox d'un homelab utilisent typiquement des certificats auto-signés.

## Architecture

Nouveau module Rust `src-tauri/src/proxmox/`, suivant le découpage déjà en place dans le projet (`commands/`, `models.rs`, `storage.rs`) :

- `proxmox/client.rs` — client REST HTTP vers l'API Proxmox VE, authentification par **API Token** (header `Authorization: PVEAPIToken=<user>@<realm>!<tokenid>=<secret>`), plus simple qu'un flux login/ticket/CSRF et cohérent avec la philosophie « homelab de confiance » déjà présente (le handler SSH accepte tous les host keys sans vérification).
- `proxmox/models.rs` — types Rust pour les réponses Proxmox (`ProxmoxNode`, `ProxmoxVm`, `ProxmoxTask`) et pour la config persistée (`ProxmoxConnection`).
- `commands/proxmox.rs` — commandes Tauri exposées au frontend (liste ci-dessous).

Le client HTTP utilise `reqwest` (nouvelle dépendance — absente du `Cargo.toml` actuel). Le client est construit avec `danger_accept_invalid_certs` activé conditionnellement selon le champ `verify_tls` de chaque connexion (désactivé par défaut, homelab oblige).

## Modèle de données

Nouvelle entité ajoutée à `AppData` (`src-tauri/src/models.rs`), suivant le même pattern que `Server`/`Group` (id UUID, chiffrement du secret via `crypto.rs` existant) :

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxmoxConnection {
    pub id: String,
    pub name: String,
    pub api_url: String,          // ex: https://192.168.1.10:8006
    pub token_id: String,         // ex: root@pam!server-manager
    pub token_secret: String,     // chiffré AES-256-GCM (comme ssh_password)
    pub verify_tls: bool,         // défaut: false
}
```

`AppData` gagne un champ `proxmox_connections: Vec<ProxmoxConnection>`. Comme pour la migration v1→v2 déjà présente dans `storage.rs`/`models.rs` (`AppDataV1` → `AppData` via `AppSettings::from_v1`), l'absence de ce champ dans un fichier `data.json` existant doit être gérée par un `#[serde(default)]` plutôt qu'une nouvelle version de schéma complète, puisqu'il s'agit d'un ajout de champ optionnel et non d'une restructuration.

Les VM/LXC ne sont **pas** persistées : elles sont interrogées en direct à chaque appel (pas de cache disque), seule la connexion (URL + token) est sauvegardée.

## Surface de commandes Tauri

Toutes dans `commands/proxmox.rs`, enregistrées dans `lib.rs` aux côtés des commandes existantes :

| Commande | Rôle |
|---|---|
| `proxmox_add_connection(payload)` | Ajoute une connexion (chiffre le secret, persiste) |
| `proxmox_update_connection(id, payload)` | Modifie une connexion existante |
| `proxmox_delete_connection(id)` | Supprime une connexion |
| `proxmox_list_connections()` | Liste les connexions (sans exposer le secret déchiffré) |
| `proxmox_test_connection(payload)` | Valide une connexion avant sauvegarde (appel `GET /version`) |
| `proxmox_list_vms(connection_id)` | Liste VMs + LXC de tous les nœuds d'une connexion, avec statut/cpu/mem/disk |
| `proxmox_vm_action(connection_id, node, vmid, vm_type, action)` | `action` ∈ start/stop/shutdown/reboot/suspend |
| `proxmox_vm_snapshot_list(connection_id, node, vmid, vm_type)` | Liste les snapshots d'une VM/LXC |
| `proxmox_vm_snapshot_create(connection_id, node, vmid, vm_type, name)` | Crée un snapshot |
| `proxmox_vm_snapshot_rollback(connection_id, node, vmid, vm_type, name)` | Restaure un snapshot |
| `proxmox_vm_clone(connection_id, node, vmid, vm_type, new_name)` | Clone une VM/LXC |

`vm_type` distingue `qemu` (VM) et `lxc` (conteneur), car l'API Proxmox expose deux familles d'endpoints différentes (`/nodes/{node}/qemu/...` vs `/nodes/{node}/lxc/...`).

## Composants frontend

- `src/pages/Proxmox.tsx` — page listée dans la sidebar (`Layout.tsx`), affiche les connexions configurées et leurs VM/LXC
- `src/components/ProxmoxConnectionForm.tsx` — formulaire d'ajout/édition d'une connexion (URL, token id, secret, toggle TLS), avec bouton "Tester la connexion" avant sauvegarde
- `src/components/VmCard.tsx` — carte par VM/LXC : nom, statut (running/stopped, badge coloré comme `StatusBadge.tsx` existant), CPU/RAM/disk (renvoyés directement par l'API Proxmox), boutons d'action (start/stop/restart), menu snapshot/clone
- `src/hooks/useProxmoxStatus.ts` — hook de polling, même pattern que `usePing.ts` existant, intervalle configurable dans `Settings > Network` (nouveau champ `proxmox_poll_interval_secs`, aux côtés de `ping_interval_secs`)
- Store : extension de `src/stores/useStore.ts` (Zustand) avec l'état des connexions Proxmox et des VM/LXC par connexion

## Flux de données

1. L'utilisateur ajoute une connexion via `ProxmoxConnectionForm` → `proxmox_test_connection` valide → `proxmox_add_connection` chiffre le secret et persiste dans `data.json`.
2. `Proxmox.tsx` monte `useProxmoxStatus`, qui appelle `proxmox_list_vms` pour chaque connexion à l'intervalle configuré.
3. Côté Rust, `proxmox_list_vms` appelle `GET /api2/json/nodes`, puis pour chaque nœud `GET /nodes/{node}/qemu` et `GET /nodes/{node}/lxc` (l'API renvoie déjà `cpu`, `mem`/`maxmem`, `disk`/`maxdisk`, `status` par VM — aucun agent nécessaire).
4. Une action utilisateur (bouton start/stop, snapshot) déclenche une commande Tauri → `POST` vers l'endpoit Proxmox correspondant → la réponse (UPID de tâche) est retournée ; un toast confirme le résultat. Le rafraîchissement périodique suivant reflète le nouvel état.

## Gestion d'erreurs

- **Connexion invalide/injoignable** : `proxmox_test_connection` remonte un message clair avant sauvegarde ; si une connexion déjà sauvegardée tombe en panne pendant l'usage, sa carte affiche un badge "hors ligne" sans bloquer l'affichage des autres connexions ou du reste de l'application.
- **Certificat auto-signé** : géré par le toggle `verify_tls` par connexion plutôt que par un rejet systématique.
- **Échec d'action** (ex: stop sur une VM déjà arrêtée, suppression impossible d'un snapshot en cours d'utilisation) : le message d'erreur renvoyé par l'API Proxmox est propagé tel quel au toast frontend, jamais avalé silencieusement.
- **Timeout réseau** : les appels HTTP utilisent le même paramètre `ssh_timeout_secs`-like configurable (nouveau `proxmox_timeout_secs` dans `NetworkSettings`) via `tokio::time::timeout`, suivant le pattern déjà utilisé dans `commands/ssh.rs`.

## Sécurité

Le `token_secret` est chiffré avec la même primitive AES-256-GCM que `ssh_password` (`crypto.rs`, clé dérivée du salt applicatif existant) — aucune nouvelle primitive cryptographique introduite. Le secret déchiffré ne transite jamais vers le frontend : `proxmox_list_connections` renvoie les connexions sans le champ secret.

## Tests

- **Rust** : tests unitaires du client REST (`proxmox/client.rs`) avec un serveur HTTP mocké (nouvelle dépendance dev `wiremock`) — construction du header d'authentification, parsing de la liste VM/LXC (JSON réel de l'API Proxmox en fixture), mapping des erreurs HTTP vers des messages utilisateur. Suit le pattern `#[cfg(test)] mod tests` déjà présent dans `models.rs`.
- **Frontend** : le projet n'a aujourd'hui aucun framework de test JS. Cette phase introduit **Vitest + React Testing Library** (nouvelle dépendance dev), avec des tests sur `VmCard` (rendu du statut, clic sur les boutons d'action) et `useProxmoxStatus` (polling avec API Tauri mockée via `@tauri-apps/api/core` mock). Cette base de test sera réutilisée par les phases TrueNAS et Terminal SSH.

## Hors périmètre (phases suivantes)

- **TrueNAS** (Phase 2) : même schéma (connexion + client REST + commandes Tauri), mais API et modèle de données propres à TrueNAS (pools, datasets, partages SMB/NFS).
- **Terminal SSH interactif** (Phase 3) : remplace l'exécution de commande unique de `commands/ssh.rs` par un vrai shell interactif, streaming via `tauri::ipc::Channel` (Tauri v2) vers un composant `xterm.js` côté frontend.
- **Métriques SSH à la demande** (Phase 4) : nouvelle commande `ssh_get_stats` (top/free/df) pour les serveurs génériques, remplaçant le besoin d'agent Python HyperMonitor.

Ces trois phases ne sont pas implémentées dans le plan qui suit ce document — chacune recevra son propre design détaillé le moment venu.
