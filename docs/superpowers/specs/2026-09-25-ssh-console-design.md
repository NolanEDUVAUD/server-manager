# Console SSH intégrée — Design

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
Onglet « Console » : ouvrir un vrai terminal SSH interactif (bash, htop, nano…) sur n'importe quel
serveur configuré, avec plusieurs sessions en onglets, sans quitter l'app. L'authentification réutilise
l'utilisateur et le mot de passe chiffré déjà enregistrés pour le serveur.

## Hors périmètre
Connexion à un hôte non configuré, authentification par clé, transfert de fichiers, enregistrement de session.

## Backend (Rust)
- `commands/ssh.rs` : la connexion et l'authentification sont extraites de `execute_ssh` dans
  `connect_ssh()` (pub(crate)), réutilisé par l'exécution de commande et par la console.
- `terminal.rs` : `TerminalState { sessions: Mutex<HashMap<String, UnboundedSender<TerminalInput>>> }`
  avec `TerminalInput = Data(Vec<u8>) | Resize{cols, rows} | Close`.
- `commands/terminal.rs` (toutes les commandes sont `async`) :
  - `terminal_open(server_id, cols, rows, on_event: Channel)` → `session_id`. Connexion, PTY `xterm-256color`,
    shell, puis une tâche tokio par session fait un `select!` entre les entrées reçues et `channel.wait()`.
    La sortie part en octets bruts (`InvokeResponseBody::Raw`), ce qui laisse xterm.js gérer les caractères
    UTF-8 coupés entre deux paquets. La fin de session part en JSON `{ "closed": "<raison>" }`.
  - `terminal_write(session_id, data: String)`, `terminal_resize(session_id, cols, rows)`,
    `terminal_close(session_id)`. Une session inconnue renvoie une erreur (sauf `close`, idempotent).
  - Quand la tâche se termine (exit, déconnexion ou erreur), elle se retire elle-même de la table.
- Dimensions validées (1..=1000) avant l'envoi au serveur.

## Frontend
- Dépendances `@xterm/xterm` et `@xterm/addon-fit`.
- Store : `terminalSessions: { id, serverId, title, status: "connecting"|"open"|"closed", closedReason? }[]`,
  `activeTerminalId`, et les actions `openTerminal(serverId)`, `closeTerminal(id)`, `setActiveTerminal(id)`.
- `TerminalView` : une instance xterm par session, alimentée par le `Channel`. `onData` appelle
  `terminal_write`, un `ResizeObserver` + FitAddon appelle `terminal_resize`.
- La page `Console` est montée **en permanence** dans `Layout` et seulement masquée hors de `/console` :
  les terminaux et leurs sessions survivent à la navigation.
- Barre d'onglets des sessions, et un menu « Nouvelle session » qui liste les serveurs. Le bouton console
  des cartes serveur ouvre directement une session.
- Une session fermée reste affichée avec sa raison, et propose « Reconnecter ».

## Tests
- Rust : validation des dimensions, retrait de session sur une table partagée.
- Vitest : actions du store (ouverture, fermeture et bascule de l'onglet actif, statut `closed`).
- Vérification réelle : ouverture d'une console sur un nœud du homelab, commande, redimensionnement, fermeture.
