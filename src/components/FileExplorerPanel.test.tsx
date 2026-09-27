import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { FileExplorerPanel } from "./FileExplorerPanel";
import { SftpEntry } from "../types";
import { useFileExplorerStore } from "../stores/useFileExplorerStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const dir: SftpEntry = { name: "logs", path: "/home/user/logs", kind: "dir", size: 0, modified: 1_700_000_000, permissions: "drwxr-xr-x", owner: 0, group: 0 };
const file: SftpEntry = { name: "notes.txt", path: "/home/user/notes.txt", kind: "file", size: 42, modified: 1_700_000_000, permissions: "-rw-r--r--", owner: 0, group: 0 };
const hidden: SftpEntry = { name: ".bashrc", path: "/home/user/.bashrc", kind: "file", size: 12, modified: 1_700_000_000, permissions: "-rw-r--r--", owner: 0, group: 0 };

function mockInvoke() {
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
    const params = args as Record<string, unknown> | undefined;
    if (cmd === "sftp_home") return "/home/user";
    if (cmd === "sftp_list") {
      if (params?.path === "/home/user/logs") return [];
      return [dir, file, hidden];
    }
    throw new Error(`unmocked: ${cmd}`);
  });
}

describe("FileExplorerPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useFileExplorerStore.setState({ showHidden: false, panelOpen: false, width: 340 });
  });

  it("charge le dossier personnel puis liste ses entrées, fichiers cachés masqués par défaut", async () => {
    mockInvoke();
    render(<FileExplorerPanel serverId="srv-1" />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sftp_home", { serverId: "srv-1" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sftp_list", { serverId: "srv-1", path: "/home/user" }));

    expect(await screen.findByText("logs")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByText(".bashrc")).not.toBeInTheDocument();
  });

  it("le filtre restreint la liste affichée", async () => {
    mockInvoke();
    render(<FileExplorerPanel serverId="srv-1" />);
    await screen.findByText("logs");
    fireEvent.change(screen.getByPlaceholderText("Filtrer…"), { target: { value: "note" } });
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
    expect(screen.queryByText("logs")).not.toBeInTheDocument();
  });

  it("double-clic sur un dossier y navigue et met à jour le fil d'Ariane", async () => {
    mockInvoke();
    render(<FileExplorerPanel serverId="srv-1" />);
    const row = await screen.findByText("logs");
    fireEvent.doubleClick(row);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("sftp_list", { serverId: "srv-1", path: "/home/user/logs" }));
    expect(await screen.findByText("Dossier vide.")).toBeInTheDocument();
    // Le fil d'Ariane contient désormais "logs"
    expect(screen.getAllByText("logs").length).toBeGreaterThan(0);
  });

  it("affiche une erreur si le listage échoue", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "sftp_home") return "/home/user";
      if (cmd === "sftp_list") throw new Error("Connexion perdue");
      throw new Error(cmd);
    });
    render(<FileExplorerPanel serverId="srv-1" />);
    expect(await screen.findByText(/Connexion perdue/)).toBeInTheDocument();
  });

  it("le bouton fichiers cachés révèle les entrées commençant par un point", async () => {
    mockInvoke();
    render(<FileExplorerPanel serverId="srv-1" />);
    await screen.findByText("logs");
    expect(screen.queryByText(".bashrc")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Fichiers cachés"));
    expect(await screen.findByText(".bashrc")).toBeInTheDocument();
  });
});
