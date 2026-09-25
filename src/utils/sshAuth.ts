/** Authentification SSH par clé (1.2) : règles d'affichage et de validation côté interface.
 *  Le backend revalide tout (méthode, clé existante, rebond sans boucle ni second niveau). */
import { AuthMethod, KeyFileInfo, OsType, Server, SshKeyView } from "../types";

export const AUTH_METHODS: { value: AuthMethod; label: string; hint: string }[] = [
  { value: "Password", label: "Mot de passe", hint: "Mot de passe enregistré, chiffré par la clé maître." },
  { value: "Key", label: "Clé de l'app", hint: "Clé SSH gérée dans Paramètres → Clés SSH (la clé privée reste chiffrée dans l'app)." },
  { value: "Agent", label: "Agent SSH", hint: "Clés chargées dans l'agent OpenSSH de Windows (ssh-add) ou dans Pageant." },
];

export function authMethodOf(server?: Pick<Server, "auth_method"> | null): AuthMethod {
  return server?.auth_method ?? "Password";
}

/** Problème à signaler pour la méthode choisie (null si tout va bien) */
export function authWarning(method: AuthMethod, keys: SshKeyView[], keyId: string | null | undefined): string | null {
  if (method !== "Key") return null;
  if (keys.length === 0) return "Aucune clé SSH enregistrée : crée ou importe une clé dans Paramètres → Clés SSH.";
  if (!keyId) return "Choisis la clé à utiliser.";
  if (!keys.some((k) => k.id === keyId)) return "La clé choisie a été supprimée : choisis-en une autre.";
  return null;
}

/** Serveurs utilisables comme hôte de rebond : pas le serveur lui-même, et pas un serveur qui
 *  passe déjà par un rebond (un seul niveau, donc aucune boucle possible) */
export function jumpCandidates(servers: Server[], currentId: string | undefined): Server[] {
  return servers.filter((s) => s.id !== currentId && !s.jump_host_id);
}

/** Serveurs qui passent par `serverId` : celui-ci ne peut alors pas avoir de rebond */
export function jumpDependents(servers: Server[], serverId: string | undefined): Server[] {
  return serverId ? servers.filter((s) => s.jump_host_id === serverId) : [];
}

/** Même règle que le backend : l'emplacement des clés autorisées diffère sur ces OS */
export function deployBlockedReason(os: OsType): string | null {
  if (os === "Windows") {
    return "Déploiement automatique impossible sur Windows : OpenSSH y lit C:\\ProgramData\\ssh\\administrators_authorized_keys pour les administrateurs. Copie la clé publique (Paramètres → Clés SSH) et ajoute-la à la main.";
  }
  if (os === "ESXi") {
    return "Déploiement automatique impossible sur ESXi : les clés se trouvent dans /etc/ssh/keys-<utilisateur>/authorized_keys. Ajoute la clé publique depuis l'interface ESXi.";
  }
  return null;
}

export function deployWarning(os: OsType): string | null {
  return os === "TrueNAS"
    ? "Sur TrueNAS, le middleware peut régénérer authorized_keys : ajoute aussi la clé dans Identifiants → Utilisateurs pour qu'elle soit conservée."
    : null;
}

/** Résumé court de l'authentification d'un serveur */
export function authSummary(server: Server, keys: SshKeyView[], servers: Server[]): string {
  const method = authMethodOf(server);
  let text = "Mot de passe";
  if (method === "Agent") text = "Agent SSH";
  if (method === "Key") {
    const k = keys.find((x) => x.id === server.ssh_key_id);
    text = k ? `Clé « ${k.name} »` : "Clé supprimée";
  }
  const jump = server.jump_host_id ? servers.find((s) => s.id === server.jump_host_id) : undefined;
  return jump ? `${text} · via ${jump.name}` : text;
}

/** Serveurs qui s'authentifient avec cette clé (sa suppression est alors refusée) */
export function keyUsers(servers: Server[], keyId: string): Server[] {
  return servers.filter((s) => s.auth_method === "Key" && s.ssh_key_id === keyId);
}

/** Nom proposé pour une clé importée : son commentaire, sinon le nom du fichier sans extension */
export function suggestedKeyName(info: KeyFileInfo): string {
  if (info.comment?.trim()) return info.comment.trim().slice(0, 64);
  return info.file_name.replace(/\.(ppk|pem|key)$/i, "").slice(0, 64);
}
