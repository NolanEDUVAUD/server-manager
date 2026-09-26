import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MemoryRouter } from "react-router-dom";
import { Batch } from "./Batch";
import { useStore } from "../stores/useStore";
import { useDraftStore } from "../stores/useDraftStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const alpha: Server = {
  id: "a", name: "alpha", ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux",
};
const beta: Server = {
  id: "b", name: "beta", ip: "192.168.1.11", mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux",
};

/** Backend simulé : commandes non listées répondent avec une valeur par défaut raisonnable */
function backend(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in handlers) return handlers[cmd](args);
    if (cmd === "get_batch_tasks") return [];
    if (cmd === "get_ansible_config") return null;
    if (cmd === "smart_batch_detect_os") return [];
    return undefined;
  });
}

const renderBatch = () => render(<MemoryRouter><Batch /></MemoryRouter>);

describe("Batch", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useDraftStore.setState({ drafts: {} });
    useStore.setState({
      servers: [alpha, beta],
      groups: [{ id: "g1", name: "Lab", server_ids: ["a", "b"], icon: null }],
      statuses: {},
    });
    backend();
  });

  it("affiche les trois étapes du flux guidé", () => {
    renderBatch();
    expect(screen.getByText("1. Cibles")).toBeInTheDocument();
    expect(screen.getByText("2. Quoi exécuter")).toBeInTheDocument();
    expect(screen.getByText("3. Options & lancement")).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("filtre les cibles par la recherche", () => {
    renderBatch();
    fireEvent.change(screen.getByLabelText("Rechercher un serveur…"), { target: { value: "alp" } });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("un chip de groupe ajoute ses serveurs à la sélection sans remplacer le reste", () => {
    renderBatch();
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha" }));
    fireEvent.click(screen.getByText("Groupe Lab"));
    expect(screen.getByRole("checkbox", { name: "alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "beta" })).toBeChecked();
  });

  it("bascule vers la commande personnalisée : script, modèles et variables toujours visibles", () => {
    renderBatch();
    fireEvent.click(screen.getByText("Commande personnalisée"));
    expect(screen.getByLabelText("Script")).toBeInTheDocument();
    expect(screen.getByText("Espace disque")).toBeInTheDocument();
    expect(screen.getByText("Variables disponibles")).toBeInTheDocument();
    expect(screen.getByText(/pkg_update/)).toBeInTheDocument();
  });

  it("l'action prête à l'emploi demande un nom pour installer un paquet", () => {
    renderBatch();
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "InstallPackage" } });
    expect(screen.getByLabelText("Nom du paquet")).toBeInTheDocument();
  });

  it("signale qu'Ansible n'est pas encore configuré", () => {
    renderBatch();
    fireEvent.click(screen.getByText("Playbook Ansible"));
    expect(screen.getByText(/n'est pas encore configuré/)).toBeInTheDocument();
  });

  it("prévisualise puis lance une action intelligente sur les cibles choisies", async () => {
    backend({
      smart_batch_preview: async () => [
        { server_id: "a", name: "alpha", os_label: "Debian 12", command: "sudo apt-get update -y", skip_reason: null },
      ],
      smart_batch_run: async () => "run-1",
    });
    renderBatch();
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha" }));
    fireEvent.click(screen.getByText("Aperçu et lancement"));

    await waitFor(() => expect(screen.getByText("Aperçu avant lancement")).toBeInTheDocument());
    expect(mockedInvoke).toHaveBeenCalledWith(
      "smart_batch_preview",
      expect.objectContaining({ serverIds: ["a"], source: { type: "Action", value: { type: "UpdatePackages" } } })
    );
    expect(screen.getByText("sudo apt-get update -y")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Lancer" }));
    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "smart_batch_run",
        expect.objectContaining({ serverIds: ["a"], mode: "Parallel", stopOnError: false })
      )
    );
  });

  it("montre les cibles ignorées dans l'aperçu, sans bloquer les autres", async () => {
    backend({
      smart_batch_preview: async () => [
        { server_id: "a", name: "alpha", os_label: "Debian 12", command: "sudo apt-get update -y", skip_reason: null },
        { server_id: "b", name: "beta", os_label: null, command: null, skip_reason: "OS non reconnu" },
      ],
    });
    renderBatch();
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "beta" }));
    fireEvent.click(screen.getByText("Aperçu et lancement"));
    await waitFor(() => expect(screen.getByText(/ignoré : OS non reconnu/)).toBeInTheDocument());
  });

  it("enregistre la tâche actuelle (script) puis peut la recharger", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Ma tâche");
    const saved = { id: "t1", name: "Ma tâche", script: "uptime", server_ids: ["a"], mode: "Parallel", stop_on_error: false, smart_action: null };
    backend({ save_batch_task: async () => saved });
    renderBatch();
    fireEvent.click(screen.getByText("Commande personnalisée"));
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: "uptime" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "alpha" }));
    fireEvent.click(screen.getByText("Enregistrer la tâche actuelle"));

    await waitFor(() =>
      expect(mockedInvoke).toHaveBeenCalledWith(
        "save_batch_task",
        expect.objectContaining({ task: expect.objectContaining({ name: "Ma tâche", script: "uptime", smart_action: null }) })
      )
    );
  });
});
