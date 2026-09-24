# Server Manager — Onglets web intégrés (Design)

## Contexte

`server-manager` évolue progressivement (et non par réécriture complète — un pivot vers une architecture Rust workspace/TUI/hub-agent a été envisagé puis explicitement écarté) : trois briques ont été identifiées comme prioritaires pour rendre l'usage quotidien plus pratique :

1. **Onglets web intégrés** (ce document)
2. Intégration Docker native (API `bollard`, écran dédié type page Proxmox)
3. Auto-découverte réseau (scan des hosts/services locaux)

Ce document couvre uniquement la première brique.

## Portée

Ouvrir l'interface web d'administration d'une connexion existante (aujourd'hui : Proxmox ; demain : tout service dont on stocke une URL) directement dans un onglet natif à l'intérieur de la fenêtre de `server-manager`, plutôt que dans le navigateur système externe.

**Décision explicite actée en brainstorming** : afficher la vraie page web du service (login natif du service inclus) nécessite un moteur de rendu web — il n'existe pas d'alternative pour "afficher du HTML à partir d'une URL" sans moteur de navigateur. On utilise **WebView2** (le composant système Windows déjà utilisé par Tauri lui-même), pas un navigateur embarqué façon Electron/CEF téléchargé séparément.

**Hors scope pour la v1** (décidé en brainstorming, sur la base d'une vraie limite technique de WebView2, pas d'un choix arbitraire) :
- **Contournement automatique des avertissements de certificat auto-signé** : WebView2 affiche un écran de blocage standard pour un certificat invalide, comme n'importe quel navigateur. Il n'existe pas d'API Tauri de haut niveau pour le désactiver. La v1 accepte le **clic-through manuel** de l'utilisateur (une fois par host, comportement identique à un navigateur classique).
- **Connexion automatique (SSO) dans l'onglet intégré** : le token API Proxmox déjà stocké donne accès à l'API REST, pas à une session de la web GUI (système de login séparé côté Proxmox). L'utilisateur se connecte manuellement dans l'onglet avec ses identifiants web habituels.

Ces deux limitations sont des candidats pour une itération future si une vraie solution technique est identifiée (ex: hook bas niveau `CoreWebView2.ServerCertificateErrorDetected` si `wry` l'expose un jour), mais ne bloquent pas la v1.

## Architecture

Tauri v2 permet d'attacher une instance `Webview` native à une fenêtre existante, positionnée par coordonnées et taille (le "multiwebview") — c'est la primitive utilisée pour les onglets. Le frontend React affiche la chrome (barre d'onglets, boutons) ; une zone de contenu vide dans le DOM est mesurée via `ResizeObserver`/`getBoundingClientRect()`, et ses coordonnées sont envoyées à une commande Tauri qui positionne la webview native exactement par-dessus cette zone. Changer d'onglet actif cache/affiche les webviews correspondantes plutôt que de les détruire et recréer (évite de perdre l'état de navigation/session de chaque onglet).

## Modèle de données

Aucune nouvelle entité persistée. Les onglets ouverts sont un état **transitoire** (frontend uniquement, perdu à la fermeture de l'app — pas de "restaurer mes onglets au démarrage" en v1, cohérent avec YAGNI). L'URL de chaque onglet vient d'une connexion existante : pour Proxmox, `ProxmoxConnection.api_url` sert à la fois d'endpoint API et d'URL de la GUI web (Proxmox sert les deux sur le port 8006 — aucun nouveau champ nécessaire).

## Surface de commandes Tauri

Nouveau fichier `src-tauri/src/commands/dashboards.rs` :

| Commande | Rôle |
|---|---|
| `open_dashboard_tab(label: String, url: String, x: f64, y: f64, width: f64, height: f64)` | Crée (ou réutilise si `label` existe déjà) une webview native à la position donnée, chargeant `url` |
| `close_dashboard_tab(label: String)` | Détruit la webview associée |
| `set_dashboard_tab_visible(label: String, visible: bool)` | Affiche/masque une webview sans la détruire (changement d'onglet actif) |
| `resize_dashboard_tab(label: String, x: f64, y: f64, width: f64, height: f64)` | Repositionne une webview existante (suivi du redimensionnement de fenêtre) |

`label` est un identifiant stable par onglet (ex: l'id de la connexion Proxmox), pas un titre affichable.

## Composants frontend

- `src/pages/Dashboards.tsx` — page listée dans la sidebar : barre d'onglets horizontale + zone de contenu vide (`<div>` mesuré) où la webview native vient se superposer
- `src/hooks/useDashboardTabSync.ts` — synchronise la position mesurée du conteneur avec `resize_dashboard_tab` via `ResizeObserver`, et gère le cycle de vie ouverture/fermeture/activation
- Point d'entrée : sur la page Proxmox existante, chaque `ProxmoxConnection` reçoit un bouton "Ouvrir l'interface web" qui navigue vers `/dashboards` et ouvre/active l'onglet correspondant à cette connexion (réutilise `connection.api_url`)
- Store : extension légère de `useStore.ts` avec la liste des onglets ouverts (`{ label, title, connectionId }[]`) et l'onglet actif — état purement frontend, pas de persistance

## Flux de données

1. Utilisateur clique "Ouvrir l'interface web" sur une connexion Proxmox → navigation vers `/dashboards`, ajout de l'onglet au store s'il n'existe pas encore, activation.
2. `Dashboards.tsx` monte/réutilise la zone de contenu, mesure sa position, appelle `open_dashboard_tab` (ou `set_dashboard_tab_visible(true)` si l'onglet existe déjà) avec les coordonnées mesurées.
3. La webview native Windows/WebView2 charge l'URL et s'affiche par-dessus la zone React — l'utilisateur voit et interagit avec la vraie interface web du service, y compris son propre écran de login.
4. Changement d'onglet → `set_dashboard_tab_visible(false)` sur l'ancien, `true` sur le nouveau (les deux webviews restent en mémoire, donc la session/navigation de l'onglet inactif n'est pas perdue).
5. Fermeture d'onglet → `close_dashboard_tab`, retiré du store.
6. Redimensionnement de la fenêtre → `ResizeObserver` déclenche `resize_dashboard_tab` sur l'onglet actif.

## Gestion d'erreurs

- **Host injoignable / DNS invalide** : la webview affiche nativement l'erreur de navigation WebView2 (comportement standard, rien à implémenter côté nous).
- **Certificat auto-signé** : interstitiel WebView2 standard, clic-through manuel de l'utilisateur (limitation actée ci-dessus).
- **Fermeture d'un onglet dont la webview a déjà planté/été fermée côté OS** : `close_dashboard_tab` doit être idempotente (ne pas paniquer si le label n'existe plus côté Rust), même logique que les autres commandes du projet qui retournent une erreur claire plutôt qu'un panic.

## Tests

- **Rust** : les commandes de `dashboards.rs` manipulent l'état natif de fenêtre (création/position/visibilité de `Webview`) — non testables en `cargo test` headless, même limite déjà actée pour toutes les commandes Tauri du projet (`commands/servers.rs`, `commands/proxmox.rs`, etc. n'ont pas de tests directs). La logique de calcul/validation (ex: normaliser des coordonnées négatives ou une taille nulle avant d'appeler l'API Tauri) sera extraite en fonction pure testable si elle existe.
- **Frontend** : `useDashboardTabSync.ts` — tests sur la logique pure de synchronisation (quelle commande appeler selon l'état ouvert/fermé/actif d'un onglet), avec `invoke` mocké comme dans les tests existants (`useProxmoxStatus.test.ts`). Pas de test sur le rendu réel de la webview native (hors de portée de jsdom).

## Hors périmètre (rappel)

- Auto-découverte réseau et intégration Docker (brique 2 et 3 du roadmap) — specs séparés à venir.
- Bypass automatique de certificat, SSO — voir section Portée ci-dessus.
- Persistance des onglets ouverts entre les sessions.
