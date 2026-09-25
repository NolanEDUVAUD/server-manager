# Authentification SSH par clé (1.2) — Design

Date : 2026-09-25 · Branche : `feature/v2`

## Objectif
Se connecter aux serveurs sans mot de passe : paire **ed25519** générée dans l'app, **import** d'une clé
existante (OpenSSH, PuTTY `.ppk`), **agent SSH** (OpenSSH pour Windows, Pageant, `SSH_AUTH_SOCK`),
**déploiement** de la clé publique dans `~/.ssh/authorized_keys`, et **hôte de rebond** (un serveur de la
liste servant de bastion). La clé privée ne quitte jamais le backend en clair.

## Hors périmètre
Certificats OpenSSH, clés FIDO (`sk-*`), DSA, rebond à plusieurs niveaux, clés PEM anciennes
(`BEGIN RSA PRIVATE KEY`, PKCS#8) : message explicite demandant une conversion (`ssh-keygen -p -f fichier`
ou PuTTYgen → *Conversions → Export OpenSSH key*). Déploiement sur Windows et ESXi (emplacement différent :
`administrators_authorized_keys`, `/etc/ssh/keys-<user>/`) : refusé avec un message clair.

## Montée de version de russh (0.44 → 0.63)
`cargo audit` signalait RUSTSEC-2026-0154 (russh 0.44.1) et RUSTSEC-2026-0153 (russh-cryptovec 0.7.3),
corrigés à partir de russh 0.60.3. russh passe donc en **0.63** (`default-features = false`, fonctionnalités
`flate2`, `rsa`, `ring` : le moteur `ring` est déjà dans l'arbre, aws-lc-rs demanderait CMake/NASM).
`russh-keys` est intégré (`russh::keys`) et les clés sont des `ssh_key` 0.7 (réexporté par russh, avec les
fonctionnalités `encryption` et `ppk`).
- Client : `Handler` en `async fn` natifs (plus d'`async-trait`), `check_server_key` reçoit un
  `PublicKeyOrCertificate` (un certificat d'hôte est jugé sur sa clé publique), l'authentification renvoie un
  `AuthResult`, la clé passe par `PrivateKeyWithHashAlg` (RSA : meilleur hachage annoncé par le serveur,
  sinon `rsa-sha2-512` comme avant).
- **known_hosts** : l'empreinte stockée reste au format de russh-keys 0.44 (SHA-256 du blob public, base64
  sans remplissage ni préfixe `SHA256:`), recalculée par `host_fingerprint`. Un test compare trois vecteurs
  (ed25519, RSA, ECDSA) calculés avec russh-keys 0.44 (identiques à `ssh-keygen -lf`) : les empreintes déjà
  mémorisées restent reconnues.
- Console (`terminal.rs`) et tâches en lot interactives : API des canaux inchangée à l'usage (PTY, shell,
  `data`, `window_change`, `wait`) ; testées contre le serveur SSH du test.
- `cargo audit` après montée : plus d'avis pour russh / russh-cryptovec ; reste RUSTSEC-2023-0071 (rsa,
  « Marvin », sans correctif amont), déjà présent avant (rsa 0.9 via russh-keys 0.44).

## Modèle de données
- `AppData.ssh_keys: Vec<SshKey>` (`#[serde(default)]`) — `SshKey { id, name, algorithm, public_key,
  fingerprint, private_key, created_at }`. `public_key` est la ligne `authorized_keys`
  (`ssh-ed25519 AAAA… commentaire`), `fingerprint` l'empreinte `SHA256:…`, `private_key` la clé au format
  OpenSSH **non chiffré** puis chiffrée en AES-256-GCM par la clé maître (`crypto::encrypt`). `Debug` masque
  la clé privée. `created_at` en millisecondes.
- `SshKeyView` (frontend) : les mêmes champs sans `private_key`, plus `has_private_key`.
- `Server` (champs en fin de struct, `#[serde(default)]`) : `auth_method: AuthMethod` (`Password` par défaut,
  `Key`, `Agent`), `ssh_key_id: Option<String>`, `jump_host_id: Option<String>`.
- `ServerPayload` : `auth_method: Option<AuthMethod>` — **absent = méthode, clé et rebond inchangés** (les
  écrans qui renvoient un ancien payload, comme la correction des MAC dans « Réseau », ne réinitialisent donc
  pas l'authentification) — `ssh_key_id`, `jump_host_id`, `clear_password: bool`.

## Résolution unique de la connexion
`ssh_auth::resolve_ssh(&AppData, server_id) -> Result<SshTarget, String>` remplace les ~45 appels
`(ip, port, user, password)` et `get_decrypted_password` (supprimée).
- `SshTarget { host, port, user, auth: SshAuth, jump: Option<Box<SshTarget>> }`,
  `SshAuth::{Password(Zeroizing<String>), Key(Zeroizing<String>), Agent}`. `Debug` écrit à la main :
  jamais de secret (testé).
- Mot de passe : déchiffré comme avant. Clé : clé privée OpenSSH déchiffrée dans un `Zeroizing`, relue par
  `russh::keys::decode_secret_key` au moment de l'authentification. Agent : aucun secret (la clé maître n'est
  pas demandée). Le planificateur ne déchiffre plus rien pour un réveil (WoL).
- Rebond : un seul niveau. Refus clairs : rebond inexistant (supprimé), serveur rebond de lui-même, cycle
  (A → B → A), rebond qui a lui-même un rebond, clé supprimée ou non choisie. Mêmes règles à
  l'enregistrement (`auth_update`) ; `delete_server` refuse de supprimer un serveur utilisé comme rebond.
- `commands::ssh::connect_ssh(&SshTarget, timeout)` renvoie un `SshSession` (déréférence vers le
  `client::Handle` ; garde la session du rebond vivante). Avec rebond : connexion au rebond, canal
  `direct-tcpip` vers `host:port` de la cible, puis `client::connect_stream` sur ce canal. La clé d'hôte de
  **chaque saut** passe par `known_hosts` (TOFU), sous sa propre identité `ip:port`, avant tout envoi de secret.
- `execute_ssh`, `execute_ssh_stream`, `execute_ssh_interactive` prennent un `&SshTarget`. Les messages
  d'erreur du mot de passe sont inchangés. `ssh_shutdown_group` signale désormais les serveurs dont
  l'authentification ne peut pas être résolue (ils étaient ignorés silencieusement).

## Agent SSH (`ssh_agent.rs`)
russh 0.63 fournit `AgentClient::connect_uds` (Unix), `connect_named_pipe` et `connect_pageant` (Windows,
crate `pageant` 0.2 des mêmes mainteneurs : canal nommé de Pageant ≥ 0.75 puis WM_COPYDATA), et
`Handle::authenticate_publickey_with` qui fait signer l'agent. Pris en charge :
- **Windows** : service « OpenSSH Authentication Agent » via `\\.\pipe\openssh-ssh-agent` (attente bornée à
  2 s si le canal est occupé), puis **Pageant** s'il est lancé (`pageant::wmmessage::is_pageant_running`,
  dépendance Windows directe sur la même version que russh). Une clé refusée par le premier agent laisse sa
  chance au second.
- **Autres OS** (tests, développement) : `SSH_AUTH_SOCK`.
- Au plus 5 identités essayées par agent (sshd coupe après `MaxAuthTries`, 6 par défaut) ; les certificats
  détenus par l'agent sont ignorés ; RSA signé en `rsa-sha2-512`/`-256` selon le serveur.
- `ssh_agent_status` liste les agents joignables et leurs clés (algorithme, empreinte, commentaire).

## Clés : génération, import, stockage (`ssh_keys.rs`, `ppk.rs`)
- Génération : graine de 32 octets du générateur du système → `Ed25519Keypair::from_seed`, commentaire
  `server-manager <nom>`.
- Import : le **backend** ouvre la boîte de dialogue (plugin dialog) et lit le fichier (≤ 64 Kio) : le
  chemin ne vient jamais du webview et le contenu de la clé ne transite pas par le frontend. Le contenu est
  gardé en mémoire (`Zeroizing`) jusqu'à la validation (nom + phrase de passe éventuelle), ce qui permet de
  corriger une phrase de passe sans rouvrir le fichier ; il est oublié à l'annulation ou en quittant l'écran.
  - OpenSSH (`BEGIN OPENSSH PRIVATE KEY`), chiffré ou non (bcrypt-pbkdf + aes256-ctr/-gcm,
    chacha20-poly1305) : ed25519, RSA ≥ 2048 bits, ECDSA P-256/384/521.
  - PuTTY `.ppk` v2 et v3, chiffré ou non, via `ssh_key::PrivateKey::from_ppk`. `ppk.rs` lit l'en-tête sans
    rien déchiffrer : format, chiffrement, commentaire, et **bornes Argon2** (mémoire ≤ 256 Mio, passes ≤ 256,
    parallélisme ≤ 16) — ssh-key ne les borne pas et un fichier piégé ferait échouer l'allocation.
    Vérifié localement contre des fichiers produits par puttygen 0.81 (v2/v3, clairs et chiffrés, ed25519,
    RSA, ECDSA) ; les vecteurs des tests sont construits dans le test par un encodeur identique octet pour
    octet à puttygen.
  - Phrase de passe reçue en `Option<Zeroizing<String>>` (fonctionnalité `serde` de zeroize), jamais
    journalisée ni reprise dans les erreurs (« Phrase de passe incorrecte »). Les erreurs PPK de ssh-key ne
    sont pas recopiées (elles peuvent citer des lignes du fichier).
  - Une fois déchiffrée, la clé est réécrite au format OpenSSH non chiffré, vérifiée par
    `russh::keys::decode_secret_key` (utilisable pour l'authentification), puis chiffrée par la clé maître.
    Une clé déjà enregistrée (même empreinte) est refusée.

## Déploiement de la clé
- Commande (fonction pure `deploy_command`) envoyée via la méthode **actuelle** du serveur, enveloppée dans
  `sh -c` (indépendante du shell de connexion). Clé validée (`algo base64 [commentaire]`, sans caractère de
  contrôle) puis passée par `shell_quote` :
  crée `~/.ssh` en 700 et `authorized_keys` en 600 **s'ils n'existent pas** ; la clé est considérée présente
  si le blob base64 est un mot d'une ligne non commentée (options `from=…` et commentaires différents
  tolérés) ; sinon ajout d'un saut de ligne si le fichier ne se termine pas par un, puis de la ligne.
- `simulate_authorized_keys` reproduit exactement cette logique (tests d'idempotence) ; un test Unix exécute
  la vraie commande dans un `HOME` temporaire et compare au simulateur.
- Vérification : nouvelle connexion avec la clé (même rebond). L'UI propose ensuite (confirmation) de
  basculer le serveur sur la clé et d'effacer le mot de passe enregistré (`ssh_key_use_for_server`).
- TrueNAS : autorisé, avec un avertissement (le middleware peut régénérer le fichier).

## Commandes Tauri
`ssh_keys_list`, `ssh_key_generate(name)`, `ssh_key_import_pick()` → `KeyFileInfo | null`,
`ssh_key_import(name, passphrase?)`, `ssh_key_import_cancel`, `ssh_key_rename(id, name)`,
`ssh_key_delete(id)` (refus si un serveur l'utilise, avec la liste), `ssh_key_deploy(server_id, key_id)` →
`DeployReport { added, verified, detail }`, `ssh_key_use_for_server(server_id, key_id, clear_password)`,
`ssh_agent_status`.

## Frontend
- Paramètres → **Clés SSH** (`SshKeysSettings`) : liste (nom, type, empreinte, date, serveurs qui
  l'utilisent), générer, importer (choix du fichier puis nom / phrase de passe), copier la clé **publique**,
  renommer, supprimer (confirmation ; bouton désactivé et serveurs listés si la clé est utilisée), état de
  l'agent. États vide, chargement et erreur.
- `ServerForm` → `ServerAuthFields` : méthode (mot de passe / clé de l'app / agent), clé, hôte de rebond
  (candidats sans cycle ni second niveau), avertissements (aucune clé, clé supprimée…), case « Effacer le
  mot de passe enregistré ». Le mot de passe n'est demandé que pour la méthode « mot de passe ».
- Carte du tableau de bord et ligne de la page Serveurs : « Déployer la clé » (`DeployKeyDialog`, via
  `ConfirmDialog`, qui accepte maintenant un contenu additionnel et un bouton désactivable).
- Utilitaires purs `utils/sshAuth.ts` (candidats de rebond, avertissements, blocage par OS, résumé).

## Sécurité
- Clé privée : chiffrée au repos, absente de `SshKeyView`, de `get_servers`, de `export_config` (vidée) et
  de `export_full_config` (non incluse), rechiffrée par `crypto::reencrypt_all`, vérifiée après migration
  vers la clé maître, déchiffrée seulement à la connexion. Aucun presse-papiers côté Rust.
- Fichier importé : taille bornée avant et après lecture, chemin choisi par l'utilisateur dans une boîte de
  dialogue native ouverte par le backend ; paramètres Argon2 bornés avant tout calcul.
- Rebond : la clé d'hôte de la cible est vérifiée même à travers le tunnel ; aucun secret n'est envoyé avant.

## Tests
Rust : génération (ligne publique, empreinte recalculée), chiffrement au repos (sérialisation de `AppData`,
vue, `Debug`, exports), `reencrypt_all`, import OpenSSH clair / chiffré (bonne, mauvaise, absente), PPK v2/v3
clair / chiffré ed25519 + RSA (MAC altéré, Argon2 démesuré), commande de déploiement (quotage, idempotence,
commentaires et fin de fichier préservés, exécution réelle sous Unix), résolution (mot de passe, clé, agent,
rebond, refus), validation du payload, ancien `data.json`, format des empreintes known_hosts, et bout en bout
contre un serveur SSH russh lancé dans le test : mot de passe (messages inchangés), clé ed25519 et RSA, agent
Unix, rebond avec vérification TOFU des deux sauts, tâche en lot interactive (PTY + réponse), console
(`run_session` : saisie, sortie, redimensionnement, fermeture).
Vitest : `utils/sshAuth`, `ServerAuthFields` / `ServerForm` (choix de méthode, avertissement sans clé,
payload), `DeployKeyDialog` (confirmation, bascule, refus Windows) et `SshKeysSettings` (suppression bloquée).

## Limites connues
- Le code `#[cfg(windows)]` (canal nommé OpenSSH, Pageant) n'est pas exécuté ici ; il est vérifié par
  `cargo check`/`clippy --target x86_64-pc-windows-gnu` sur un crate minimal incluant le module réel.
- ssh-key 0.7 relit la clé ed25519 d'un .ppk comme un « mpint » et refuse le cas rare (≈ 1 clé sur 512) où
  elle commence par un octet nul : message clair invitant à l'exporter au format OpenSSH depuis PuTTYgen.
- La phrase de passe transite une fois par l'IPC Tauri (chaîne JSON non effaçable côté webview) et, pour un
  .ppk, ssh-key la copie dans une `String` non effacée.
- Pas de rebond à plusieurs niveaux ; pas de `ProxyJump` lu depuis `~/.ssh/config`.
