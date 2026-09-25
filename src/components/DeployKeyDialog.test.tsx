import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DeployKeyDialog } from "./DeployKeyDialog";
import { SshKeysSettings } from "./SshKeysSettings";
import { useStore } from "../stores/useStore";
import { Server, SshKeyView } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const server: Server = {
  id: "a", name: "minipc", ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "", ssh_port: 22,
  shutdown_command: "", reboot_command: "", os_type: "Linux", auth_method: "Password",
};
const key: SshKeyView = {
  id: "k1", name: "Portable", algorithm: "ssh-ed25519", public_key: "ssh-ed25519 AAAA test",
  fingerprint: "SHA256:0123456789abcdef", created_at: 1_790_000_000_000, has_private_key: true,
};

describe("DeployKeyDialog", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useStore.setState({ servers: [server] });
  });

  it("déploie après confirmation puis bascule le serveur sur la clé en effaçant le mot de passe", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "ssh_keys_list") return [key];
      if (cmd === "ssh_key_deploy") return { added: true, verified: true, detail: null };
      if (cmd === "ssh_key_use_for_server") return { ...server, auth_method: "Key", ssh_key_id: "k1" };
      throw new Error(cmd);
    });
    const onMessage = vi.fn();
    const onClose = vi.fn();
    render(<DeployKeyDialog server={server} onClose={onClose} onMessage={onMessage} />);
    // Rien n'est envoyé au serveur avant la confirmation
    expect(await screen.findByText(/authorized_keys de root@192.168.1.10/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("ssh_key_deploy", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Déployer la clé" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ssh_key_deploy", { serverId: "a", keyId: "k1" }));

    expect(await screen.findByText(/Utiliser la clé pour minipc/)).toBeInTheDocument();
    expect(screen.getByLabelText("Effacer le mot de passe enregistré pour ce serveur")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Utiliser la clé" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ssh_key_use_for_server", { serverId: "a", keyId: "k1", clearPassword: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useStore.getState().servers[0].auth_method).toBe("Key");
    expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("Portable"), "success");
  });

  it("refuse Windows avec un message clair, sans rien envoyer", async () => {
    vi.mocked(invoke).mockResolvedValue([key]);
    render(<DeployKeyDialog server={{ ...server, os_type: "Windows" }} onClose={() => {}} onMessage={() => {}} />);
    expect(screen.getByText(/administrators_authorized_keys/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Déployer la clé" })).toBeNull();
  });

  it("sans clé enregistrée : bouton de déploiement désactivé", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    render(<DeployKeyDialog server={server} onClose={() => {}} onMessage={() => {}} />);
    expect(await screen.findByText(/Aucune clé SSH enregistrée/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Déployer la clé" })).toBeDisabled();
  });
});

describe("SshKeysSettings", () => {
  beforeEach(() => vi.mocked(invoke).mockReset());

  it("liste les clés et bloque la suppression d'une clé utilisée par un serveur", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => (cmd === "ssh_keys_list" ? [key] : undefined));
    useStore.setState({ servers: [{ ...server, auth_method: "Key", ssh_key_id: "k1" }] });
    render(<SshKeysSettings />);
    expect(await screen.findByText("Portable")).toBeInTheDocument();
    expect(screen.getByText(/utilisée par minipc/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Supprimer la clé Portable"));
    expect(screen.getByText(/Choisis d'abord une autre méthode/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("ssh_key_delete", expect.anything());
  });

  it("état vide utile", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    useStore.setState({ servers: [] });
    render(<SshKeysSettings />);
    expect(await screen.findByText("Aucune clé SSH")).toBeInTheDocument();
  });
});
