import { describe, it, expect } from "vitest";
import { Server, SshKeyView } from "../types";
import {
  authSummary,
  authWarning,
  deployBlockedReason,
  deployWarning,
  jumpCandidates,
  jumpDependents,
  keyUsers,
  suggestedKeyName,
} from "./sshAuth";

const srv = (id: string, name: string, extra: Partial<Server> = {}): Server => ({
  id, name, ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "", ssh_port: 22,
  shutdown_command: "", reboot_command: "", os_type: "Linux", ...extra,
});

const key = (id: string, name: string): SshKeyView => ({
  id, name, algorithm: "ssh-ed25519", public_key: "ssh-ed25519 AAAA test", fingerprint: "SHA256:abc",
  created_at: 0, has_private_key: true,
});

describe("sshAuth", () => {
  it("avertit quand la méthode « clé » n'a pas de clé utilisable", () => {
    expect(authWarning("Key", [], null)).toMatch(/Aucune clé SSH/);
    expect(authWarning("Key", [key("k1", "Portable")], null)).toMatch(/Choisis la clé/);
    expect(authWarning("Key", [key("k1", "Portable")], "supprimée")).toMatch(/a été supprimée/);
    expect(authWarning("Key", [key("k1", "Portable")], "k1")).toBeNull();
    expect(authWarning("Password", [], null)).toBeNull();
  });

  it("ne propose comme rebond ni le serveur lui-même ni un serveur qui a déjà un rebond", () => {
    const servers = [srv("a", "minipc"), srv("b", "FwNode"), srv("c", "DockerHost", { jump_host_id: "b" })];
    expect(jumpCandidates(servers, "a").map((s) => s.id)).toEqual(["b"]);
    expect(jumpCandidates(servers, undefined).map((s) => s.id)).toEqual(["a", "b"]);
    // b sert de rebond à c : b ne peut pas avoir lui-même de rebond
    expect(jumpDependents(servers, "b").map((s) => s.name)).toEqual(["DockerHost"]);
    expect(jumpDependents(servers, undefined)).toEqual([]);
  });

  it("bloque le déploiement là où authorized_keys est ailleurs", () => {
    expect(deployBlockedReason("Windows")).toMatch(/administrators_authorized_keys/);
    expect(deployBlockedReason("ESXi")).toMatch(/keys-/);
    expect(deployBlockedReason("Linux")).toBeNull();
    expect(deployWarning("TrueNAS")).toMatch(/TrueNAS/);
    expect(deployWarning("Proxmox")).toBeNull();
  });

  it("résume l'authentification d'un serveur", () => {
    const keys = [key("k1", "Portable")];
    const servers = [srv("a", "minipc"), srv("b", "FwNode", { auth_method: "Key", ssh_key_id: "k1", jump_host_id: "a" })];
    expect(authSummary(servers[0], keys, servers)).toBe("Mot de passe");
    expect(authSummary(servers[1], keys, servers)).toBe("Clé « Portable » · via minipc");
    expect(authSummary(srv("c", "x", { auth_method: "Key", ssh_key_id: "absente" }), keys, servers)).toBe("Clé supprimée");
  });

  it("liste les serveurs qui utilisent une clé et propose un nom d'import", () => {
    const servers = [
      srv("a", "minipc", { auth_method: "Key", ssh_key_id: "k1" }),
      srv("b", "FwNode", { auth_method: "Password", ssh_key_id: "k1" }),
    ];
    expect(keyUsers(servers, "k1").map((s) => s.name)).toEqual(["minipc"]);
    expect(suggestedKeyName({ file_name: "id_ed25519", format: "OpenSSH", encrypted: true, algorithm: null, comment: null })).toBe("id_ed25519");
    expect(suggestedKeyName({ file_name: "cle.ppk", format: "PuTTY (PPK v3)", encrypted: false, algorithm: "ssh-rsa", comment: "rsa-key-20260925" })).toBe("rsa-key-20260925");
    expect(suggestedKeyName({ file_name: "portable.ppk", format: "PuTTY (PPK v3)", encrypted: false, algorithm: null, comment: "" })).toBe("portable");
  });
});
