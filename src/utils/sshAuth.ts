/** Authentification SSH par clé (1.2) : règles d'affichage et de validation côté interface.
 *  Le backend revalide tout (méthode, clé existante, rebond sans boucle ni second niveau). */
import { AuthMethod, KeyFileInfo, OsType, Server, SshKeyView } from "../types";
import { t, TKey } from "../i18n";

/** Méthodes proposées ; libellés traduits à l'affichage */
export const AUTH_METHODS: { value: AuthMethod; labelKey: TKey; hintKey: TKey }[] = [
  { value: "Password", labelKey: "sshAuth.methods.password", hintKey: "sshAuth.methods.passwordHint" },
  { value: "Key", labelKey: "sshAuth.methods.key", hintKey: "sshAuth.methods.keyHint" },
];

export function authMethodOf(server?: Pick<Server, "auth_method"> | null): AuthMethod {
  return server?.auth_method ?? "Password";
}

/** Problème à signaler pour la méthode choisie (null si tout va bien) */
export function authWarning(method: AuthMethod, keys: SshKeyView[], keyId: string | null | undefined): string | null {
  if (method !== "Key") return null;
  if (keys.length === 0) return t("sshAuth.warnNoKeys");
  if (!keyId) return t("sshAuth.warnChooseKey");
  if (!keys.some((k) => k.id === keyId)) return t("sshAuth.warnKeyDeleted");
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
    return t("sshAuth.blockedWindows");
  }
  if (os === "ESXi") {
    return t("sshAuth.blockedEsxi");
  }
  return null;
}

export function deployWarning(os: OsType): string | null {
  return os === "TrueNAS"
    ? t("sshAuth.truenasWarning")
    : null;
}

/** Résumé court de l'authentification d'un serveur */
export function authSummary(server: Server, keys: SshKeyView[], servers: Server[]): string {
  const method = authMethodOf(server);
  let text = t("sshAuth.methods.password");
  if (method === "Key") {
    const k = keys.find((x) => x.id === server.ssh_key_id);
    text = k ? t("sshAuth.summaryKey", { name: k.name }) : t("sshAuth.summaryKeyDeleted");
  }
  const jump = server.jump_host_id ? servers.find((s) => s.id === server.jump_host_id) : undefined;
  return jump ? t("sshAuth.summaryVia", { text, jump: jump.name }) : text;
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
