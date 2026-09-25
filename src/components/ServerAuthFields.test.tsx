import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AuthFieldsValue, ServerAuthFields } from "./ServerAuthFields";
import { ServerForm } from "./ServerForm";
import { useStore } from "../stores/useStore";
import { Server, SshKeyView } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const srv = (id: string, name: string, extra: Partial<Server> = {}): Server => ({
  id, name, ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "", ssh_port: 22,
  shutdown_command: "", reboot_command: "", os_type: "Linux", ...extra,
});
const key: SshKeyView = {
  id: "k1", name: "Portable", algorithm: "ssh-ed25519", public_key: "ssh-ed25519 AAAA test",
  fingerprint: "SHA256:0123456789abcdefghijklmnop", created_at: 0, has_private_key: true,
};

function Harness({ keys, serverId, servers = [] }: { keys: SshKeyView[] | null; serverId?: string; servers?: Server[] }) {
  const [value, setValue] = useState<AuthFieldsValue>({ auth_method: "Password", ssh_key_id: null, jump_host_id: null, clear_password: false });
  return (
    <>
      <ServerAuthFields serverId={serverId} servers={servers} keys={keys} value={value} onChange={(p) => setValue((v) => ({ ...v, ...p }))} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const current = () => JSON.parse(screen.getByTestId("value").textContent ?? "{}");

describe("ServerAuthFields", () => {
  it("choisir « clé de l'app » sans clé enregistrée affiche un avertissement", () => {
    render(<Harness keys={[]} />);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Clé de l'app" }));
    expect(current().auth_method).toBe("Key");
    expect(screen.getByRole("alert")).toHaveTextContent("Aucune clé SSH enregistrée");
    expect(screen.queryByLabelText("Clé de l'app")).toBeNull();
  });

  it("avec des clés : liste déroulante, puis plus d'avertissement une fois la clé choisie", () => {
    render(<Harness keys={[key]} serverId="a" />);
    fireEvent.click(screen.getByRole("radio", { name: "Clé de l'app" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisis la clé");
    fireEvent.change(screen.getByLabelText("Clé de l'app"), { target: { value: "k1" } });
    expect(current().ssh_key_id).toBe("k1");
    expect(screen.queryByRole("alert")).toBeNull();
    // Serveur existant : proposition d'effacer le mot de passe
    fireEvent.click(screen.getByLabelText("Effacer le mot de passe enregistré pour ce serveur"));
    expect(current().clear_password).toBe(true);
    // Retour au mot de passe : la case disparaît et l'effacement est annulé
    fireEvent.click(screen.getByRole("radio", { name: "Mot de passe" }));
    expect(current().clear_password).toBe(false);
    expect(screen.queryByLabelText("Effacer le mot de passe enregistré pour ce serveur")).toBeNull();
  });

  it("le rebond exclut le serveur lui-même et ceux qui ont déjà un rebond", () => {
    const servers = [srv("a", "minipc"), srv("b", "FwNode"), srv("c", "DockerHost", { jump_host_id: "b" })];
    render(<Harness keys={[]} serverId="a" servers={servers} />);
    const options = Array.from((screen.getByLabelText("Hôte de rebond (optionnel)") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Aucun (connexion directe)", "FwNode (192.168.1.10)"]);
    fireEvent.change(screen.getByLabelText("Hôte de rebond (optionnel)"), { target: { value: "b" } });
    expect(current().jump_host_id).toBe("b");
  });
});

describe("ServerForm — authentification", () => {
  beforeEach(() => {
    useStore.setState({ servers: [] });
    vi.mocked(invoke).mockReset();
  });

  it("refuse la méthode « clé » sans clé et n'exige pas de mot de passe", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ServerForm onSubmit={onSubmit} onCancel={() => {}} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ssh_keys_list"));
    fireEvent.change(screen.getByPlaceholderText("Proxmox Master1"), { target: { value: "minipc" } });
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), { target: { value: "192.168.1.10" } });
    fireEvent.click(screen.getByRole("radio", { name: "Clé de l'app" }));
    expect(screen.queryByPlaceholderText("mot de passe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Aucune clé SSH enregistrée");
  });

  it("envoie la méthode, la clé et le rebond choisis", async () => {
    vi.mocked(invoke).mockResolvedValue([key]);
    useStore.setState({ servers: [srv("b", "FwNode")] });
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ServerForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Proxmox Master1"), { target: { value: "minipc" } });
    fireEvent.change(screen.getByPlaceholderText("192.168.1.10"), { target: { value: "192.168.1.10" } });
    fireEvent.click(screen.getByRole("radio", { name: "Clé de l'app" }));
    fireEvent.change(await screen.findByLabelText("Clé de l'app"), { target: { value: "k1" } });
    fireEvent.change(screen.getByLabelText("Hôte de rebond (optionnel)"), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ auth_method: "Key", ssh_key_id: "k1", jump_host_id: "b", ssh_password: "" });
  });
});
