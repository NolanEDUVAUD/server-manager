import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { MemoryRouter } from "react-router-dom";
import { Databases } from "./Databases";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

const alpha: Server = {
  id: "a", name: "alpha", ip: "192.168.1.10", mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux",
};

function backend(handlers: Record<string, (args?: unknown) => unknown> = {}) {
  mockedInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd in handlers) return handlers[cmd](args);
    return undefined;
  });
}

const renderPage = () => render(<MemoryRouter><Databases /></MemoryRouter>);

describe("Databases", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    useStore.setState({ servers: [alpha], statuses: { a: { online: true, latency_ms: null, last_checked: Date.now() } } });
    backend();
  });

  it("invite à choisir un serveur avant toute détection", () => {
    renderPage();
    expect(screen.getByText(/serveur pour détecter/i)).toBeInTheDocument();
    expect(mockedInvoke).not.toHaveBeenCalledWith("db_detect_engines", expect.anything());
  });

  it("affiche un état vide quand aucun moteur n'est détecté", async () => {
    backend({ db_detect_engines: () => [] });
    renderPage();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.getByText(/Aucun moteur détecté/i)).toBeInTheDocument());
  });

  it("liste les moteurs détectés et sélectionne le premier", async () => {
    backend({
      db_detect_engines: () => [{ engine: "Postgres", version: "16.1", status: "active", container: null }],
      db_list_databases: () => [{ name: "app", size_bytes: 2048, table_count: 3 }],
    });
    renderPage();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.getByText("PostgreSQL")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
    expect(mockedInvoke).toHaveBeenCalledWith("db_list_databases", expect.objectContaining({ serverId: "a", engine: "Postgres" }));
  });

  it("affiche une erreur de détection lisiblement", async () => {
    backend({ db_detect_engines: () => Promise.reject("Connexion SSH échouée") });
    renderPage();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.getByText("Connexion SSH échouée")).toBeInTheDocument());
  });

  it("Redis affiche son panneau INFO plutôt que les onglets SQL", async () => {
    backend({
      db_detect_engines: () => [{ engine: "Redis", version: "7.2.4", status: "active", container: null }],
      db_redis_info: () => ({ version: "7.2.4", used_memory_human: "1.2M", keys_per_db: [["db0", 5]] }),
    });
    renderPage();
    fireEvent.click(screen.getByText("alpha"));
    await waitFor(() => expect(screen.getByText("Redis")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("7.2.4")).toBeInTheDocument());
    expect(screen.queryByText("Requête SQL")).not.toBeInTheDocument();
  });
});
