# Verrouillage de l'application (1.3)

Date : 2026-09-25 · Feuille de route v0.3, fonctionnalité 1.3.

## Objectif
Empêcher qu'une personne devant un PC resté ouvert utilise l'app (consoles SSH, arrêts, secrets), et
permettre en option de protéger cryptographiquement la clé maître par un **mot de passe maître**.
Désactivé par défaut : sans méthode configurée, l'app se comporte exactement comme avant.

## Méthodes de déverrouillage
- **PIN applicatif** : 4 à 12 chiffres, stocké uniquement en hash Argon2id au format PHC
  (`$argon2id$v=19$m=65536,t=3,p=1$…`), jamais renvoyé au frontend ni exporté.
- **Windows Hello** : `UserConsentVerifier`, via `IUserConsentVerifierInterop::RequestVerificationForWindowAsync`
  avec le HWND de la fenêtre `main` (l'invite s'affiche devant l'app). Le PIN applicatif est obligatoire
  avec Hello et sert de secours (capteur absent, Hello désactivé) : on ne peut jamais rester bloqué dehors.
- **Mot de passe maître** (optionnel) : KEK = Argon2id(mot de passe, sel aléatoire 16 o, m = 64 Mio,
  t = 3, p = 1), clé maître chiffrée en AES-256-GCM (nonce aléatoire, données associées = version et
  paramètres). Le blob versionné (JSON `{v:1, kdf:"argon2id", m, t, p, salt, nonce, ct}`) remplace la
  clé brute dans le Gestionnaire d'identification Windows. L'app démarre alors verrouillée et **seul**
  ce mot de passe déverrouille : Hello et le PIN ne dérivent pas la clé, l'interface le dit.

Sans mot de passe maître, le PIN et Hello contrôlent l'accès à l'interface ; la clé reste lisible par
la session Windows (même modèle qu'avant). Avec lui, un vol de `data.json` **et** du coffre ne suffit plus.

## Modèle de données
- `AppData.lock: LockConfig` (`#[serde(default)]`, en fin de struct) : `method` (`None | Pin | Hello`),
  `pin_hash`, `idle_minutes` (0 = jamais, ≤ 1440), `lock_on_session_lock`. Hors d'`AppSettings` :
  `get_settings` / `update_settings` n'y touchent pas. Un ancien `data.json` donne `method = None`.
- Le coffre fait foi pour le mot de passe maître : un blob enveloppé ⇒ mot de passe actif.
- Vue frontend `LockStatus` : `enabled`, `locked`, `method`, `has_pin`, `master_password`,
  `idle_minutes`, `lock_on_session_lock`, `hello_available`, `session_detection`, `retry_after_ms`.
  Jamais de hash.

## Clé en mémoire
`crypto::KeyVault` remplace le `OnceLock<[u8; 32]>` : clé en `Zeroizing`, effacée au verrouillage.
Verrouillée, `crypto::data_key` renvoie « Application verrouillée » (y compris en ancien schéma de clé)
et `crypto::ensure_unlocked()` garde les commandes sensibles : exécution SSH (`connect_ssh` et les quatre
commandes SSH), console (`terminal_open/write/resize`), WoL (serveur, groupe, zone de notification),
exports, arrêt/démarrage du lab, tâches en lot et Ansible, tâche planifiée « exécuter maintenant »,
sonde « tester maintenant », affichage d'un onglet web. Au déverrouillage par PIN / Hello, la clé est
relue dans le coffre ; par mot de passe, elle est désenveloppée.

## Verrouillage
- Manuel : bouton de la barre latérale, palette de commandes, `Ctrl+Maj+L`, menu de la zone de notification.
- Inactivité : le frontend remonte l'activité clavier / souris au plus toutes les 20 s
  (`lock_activity`) ; une boucle Rust (5 s) décide, car les minuteurs JS d'une fenêtre masquée ralentissent.
- Session Windows verrouillée : sondage de `WTSQuerySessionInformationW(WTSSessionInfoEx)` →
  `SessionFlags == WTS_SESSIONSTATE_LOCK`. Hors Windows : pas de détection (`session_detection = false`).
- Au verrouillage : clé effacée, consoles SSH fermées, onglets web masqués, menu de la zone de
  notification reconstruit (WoL grisé), événement `lock-state`. Le frontend démonte tout le contenu.

## Tâches de fond pendant le verrouillage
Le ping continue. Collecte des métriques SSH et sondes avec secret suspendues (pas d'erreur ni de fausse
alerte) ; notifications push dont le canal a un secret ignorées (ntfy sans jeton et notifications Windows
continuent) ; tâche planifiée d'arrêt / redémarrage journalisée en échec « application verrouillée »
(un Wake-on-LAN planifié, sans secret, s'exécute). Une tâche en lot déjà lancée va à son terme.

## Commandes
`lock_status`, `lock_now`, `lock_activity`, `lock_configure`, `unlock_with_pin`, `unlock_with_password`,
`unlock_with_hello`, `master_password_enable`, `master_password_change`, `master_password_remove`.
Toute modification de la configuration exige l'app déverrouillée **et** le secret actuel (mot de passe
maître s'il est actif, sinon PIN) : on ne peut ni désactiver le verrouillage ni poser un mot de passe
maître inconnu du propriétaire depuis une session laissée ouverte.

## Sécurité
- Essais limités (PIN, mot de passe, secret actuel) : 3 essais libres, puis 5 s, 10 s, 20 s… jusqu'à 5 min.
  Compteur en mémoire (un redémarrage le remet à zéro ; c'est Argon2id qui freine une attaque hors ligne).
- Écriture du coffre : nouvelle valeur vérifiée en mémoire, écrite, relue et vérifiée ; en cas d'échec,
  l'ancienne valeur (gardée en mémoire) est réécrite. La clé maître elle-même ne change jamais : aucun
  secret n'est rechiffré. Activation refusée tant que les secrets sont sous l'ancienne clé dérivée.
- Paramètres Argon2 relus depuis le blob, bornés (m ≤ 1 Gio, t ≤ 16, p ≤ 16) ; blob ≤ 4 Kio.
- `export_config` retire la configuration de verrouillage ; `export_full_config` ne l'a jamais contenue.
- Mot de passe maître : 8 à 256 caractères ; un oubli rend les secrets irrécupérables (confirmation).

## Tests
Rust : Argon2id déterministe / sel / paramètres relus ; enveloppe (aller-retour, mauvais mot de passe,
blob altéré, version inconnue, pas de trace de la clé) ; PIN (hash, refus, format, délais avec horloge
injectée) ; coffre verrouillé (`data_key`, `ensure_unlocked`, `connect_ssh`, mot de passe SSH, secret
d'intégration) puis déverrouillé ; présence de la garde dans chaque commande sensible ; minuterie
d'inactivité ; démarrage (PIN ⇒ verrouillé, blob ⇒ mot de passe requis) ; activation / changement /
retrait avec relecture et restauration ; vue sans hash ; ancien `data.json`.
Vitest : utilitaires (mode, PIN, limitation de l'activité), écran de verrouillage (contenu masqué,
bon mode de saisie, erreur, vérification en cours), réglages.

## Limites connues
- Code Windows (Hello, WTS, HWND) compilé et testé uniquement sous Windows.
- Windows 7 inverse `WTS_SESSIONSTATE_LOCK/UNLOCK` : non géré (cible Windows 10/11).
- Sans mot de passe maître, supprimer le bloc `lock` de `data.json` désactive le verrouillage : c'est un
  contrôle d'accès à l'interface, pas une protection contre un attaquant qui contrôle déjà la session.
