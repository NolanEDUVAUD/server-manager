# Sauvegarde et restauration chiffrées (`.spmbackup`)

**Version cible :** 0.3.0 (Phase 1.4)

## But

L'export JSON actuel ne contient aucun secret : après une réinstallation ou sur un autre PC, il faut ressaisir tous les mots de passe, jetons et clés. La sauvegarde `.spmbackup` contient **toute** la configuration, **secrets compris**. Elle est chiffrée par une **phrase de passe** choisie au moment de l'export et ne dépend donc pas de la clé maître de la machine. À l'import sur un autre PC, les secrets sont rechiffrés par la clé maître de ce PC.

## Format du fichier (version 1)

```
"SPMBACKUP\0"     10 octets  signature
version           1 octet    = 1
kdf               1 octet    = 1 (Argon2id)
m_cost (Kio)      u32 LE     mémoire Argon2id
t_cost            u32 LE     itérations
p_cost            u32 LE     parallélisme
sel               16 octets  aléatoire
nonce             12 octets  aléatoire
chiffré           …          AES-256-GCM(clé = Argon2id(phrase, sel), données = charge utile JSON)
```

- L'**en-tête** (signature, version, KDF, paramètres, sel) sert de données associées (AAD) à AES-GCM. Toute modification de ces champs fait échouer le déchiffrement. Le nonce, qui suit l'en-tête, est authentifié par GCM lui-même.
- Les primitives sont celles du verrouillage (1.3) : `crypto::derive_kek`, `crypto::seal`, `crypto::open` et `KdfParams`.
- Paramètres Argon2id à l'export : 64 Mio, 3 itérations, 1 voie. À l'import, ils sont relus depuis l'en-tête et bornés par `KdfParams::validate` (1 Gio et 16 itérations au plus) : un fichier piégé ne peut pas épuiser la mémoire.
- Aucune partie du fichier n'est lisible sans la phrase de passe : ni noms de serveurs, ni adresses, ni secrets.

## Charge utile (chiffrée)

```json
{ "format": 1, "app_version": "0.3.0", "created_at": "…", "transfer_key": "<base64 32 o>",
  "data": { … AppData … }, "known_hosts": { … } }
```

Pour transporter les secrets sans nouveau code de sérialisation, on s'appuie sur `crypto::reencrypt_all`. Celui-ci parcourt `crypto::secret_fields_mut`, la **liste unique** de tous les champs secrets. Les exports JSON utilisent la même liste pour vider les secrets : un nouveau secret ajouté à cette liste est donc couvert partout.

La configuration du **verrouillage** (hash du PIN) et celle de la **sauvegarde automatique** (dossier local, phrase de passe) sont propres à la machine. Elles ne voyagent pas et ne sont jamais restaurées.

- **Export** : une clé de transfert aléatoire est générée ; les secrets passent de la clé maître à la clé de transfert (`reencrypt_all(copie, maître, transfert)`) ; la clé de transfert voyage dans la charge utile, elle-même chiffrée par la phrase de passe.
- **Import** : `reencrypt_all(données, transfert, maître locale)`.

Les secrets ne sont donc jamais en clair, pas même dans la charge utile déchiffrée en mémoire. La charge utile sérialisée est conservée dans un `Zeroizing`.

## Restauration

1. Choix du fichier (≤ 50 Mio), saisie de la phrase de passe.
2. Déchiffrement puis **aperçu** : date, version de l'app, nombre de serveurs, groupes, sondes, connexions Proxmox, intégrations et clés SSH. L'import reste en attente, en mémoire.
3. Confirmation explicite : « la configuration actuelle sera **entièrement remplacée** ». L'ancien `data.json` est d'abord copié en `data.json.before-restore.bak`, qui reste chiffré par la clé maître de ce PC.
4. Rechiffrement par la clé maître locale, remplacement de la configuration, sauvegarde sur disque. Les empreintes SSH connues sont fusionnées : celles déjà présentes sur ce PC restent prioritaires.

Une phrase de passe fausse, un fichier tronqué ou modifié et une version inconnue produisent tous le même type d'erreur, claire et sans détail exploitable : « Phrase de passe incorrecte ou fichier altéré ».

## Sauvegarde automatique

- Réglages : activée ou non, dossier de destination (chemin absolu existant), fréquence (quotidienne ou hebdomadaire), nombre de fichiers conservés (1 à 100).
- La phrase de passe de la sauvegarde automatique est un **secret** : chiffrée par la clé maître, présentée au frontend sous forme de vue (`has_passphrase`), retirée des exports JSON, rechiffrée par `reencrypt_all`.
- Fichiers `spm-backup-AAAAMMJJ-HHMMSS.spmbackup`. Seuls les fichiers qui suivent ce motif sont concernés par la rotation.
- La boucle vérifie toutes les heures si une sauvegarde est due. Un échec est journalisé dans l'historique (événement « Échec »), ce qui déclenche les alertes existantes.
- Bouton « Sauvegarder maintenant ».

## Commandes Tauri

| Commande | Rôle |
|---|---|
| `backup_export(passphrase)` | boîte « Enregistrer sous », écrit le `.spmbackup` |
| `backup_inspect(passphrase)` | boîte « Ouvrir », déchiffre, renvoie l'aperçu et garde l'import en attente |
| `backup_apply` | applique l'import en attente (après confirmation dans l'UI) |
| `backup_cancel` | abandonne l'import en attente |
| `get_backup_settings` / `save_backup_settings(settings, passphrase?)` | réglages de la sauvegarde automatique (vue sans secret) |
| `backup_run_now` | sauvegarde automatique immédiate |

## Sécurité

- Phrase de passe d'au moins 12 caractères, reçue dans un `Zeroizing`, jamais journalisée ni renvoyée.
- Écriture atomique (fichier temporaire puis renommage).
- Import borné en taille avant toute lecture. La charge utile JSON est désérialisée seulement après authentification AES-GCM.
- Une fois l'import appliqué, la charge utile déchiffrée est effacée de la mémoire.

## Tests

- Aller-retour export → import avec deux clés maîtres différentes : secrets identiques après rechiffrement.
- Phrase de passe fausse, en-tête modifié, chiffré tronqué, signature ou version inconnue : erreur propre.
- Paramètres Argon2id hors bornes refusés avant la dérivation.
- Le fichier ne contient aucun secret connu, ni nom de champ, ni nom de serveur en clair.
- Phrase de passe trop courte refusée.
- Phrase de passe automatique : chiffrée, conservée si le champ reste vide, effacée à la désactivation, absente de la vue et des exports.
- Rotation : ne garde que les N plus récents et ignore les fichiers étrangers au motif.
- Échéance de la sauvegarde automatique (quotidienne, hebdomadaire, jamais faite).
