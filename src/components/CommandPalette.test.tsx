import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

const minipc = {
  id: "o", name: "minipc", ip: "192.168.1.10", mac_address: "02:00:00:00:00:01",
  shutdown_command: "sudo shutdown -h now", reboot_command: "sudo reboot",
} as Server;

function openPalette() {
  act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
}

/** Tape une requête dans la palette et valide le premier résultat */
function runCommand(query: string) {
  openPalette();
  const input = screen.getByLabelText("Recherche de commande");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    navigate.mockReset();
    useStore.setState({
      servers: [minipc, { id: "w", name: "Workstation", ip: "192.168.1.11", mac_address: "", shutdown_command: "shutdown /s /t 0", reboot_command: "shutdown /r /t 0" } as Server],
      groups: [{ id: "g", name: "Lab", server_ids: ["o"], icon: null }],
      wakeGroup: vi.fn().mockResolvedValue([]),
      wakeServer: vi.fn().mockResolvedValue("ok"),
      shutdownServer: vi.fn().mockResolvedValue({ success: true, output: "", error: null }),
      rebootServer: vi.fn().mockResolvedValue({ success: true, output: "", error: null }),
      pingServer: vi.fn().mockResolvedValue({ server_id: "o", online: true, latency_ms: 2 }),
      openTerminal: vi.fn(),
      shortcutsHelpOpen: false,
    });
  });

  const renderPalette = () =>
    render(<MemoryRouter><CommandPalette pages={[{ to: "/network", label: "Réseau" }]} /></MemoryRouter>);

  it("s'ouvre avec Ctrl+K et navigue vers une page", () => {
    renderPalette();
    expect(screen.queryByLabelText("Recherche de commande")).toBeNull();
    runCommand("reseau");
    expect(navigate).toHaveBeenCalledWith("/network");
  });

  it("se ferme avec Échap", () => {
    renderPalette();
    openPalette();
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByLabelText("Recherche de commande")).toBeNull();
  });

  it("propose les actions sur un serveur précis", () => {
    renderPalette();
    openPalette();
    fireEvent.change(screen.getByLabelText("Recherche de commande"), { target: { value: "minipc" } });
    for (const label of ["Réveiller minipc", "Arrêter minipc", "Redémarrer minipc", "Ouvrir la console sur minipc", "Pinger minipc", "Modifier minipc"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("ne propose pas de réveil pour un serveur sans adresse MAC", () => {
    renderPalette();
    openPalette();
    fireEvent.change(screen.getByLabelText("Recherche de commande"), { target: { value: "workstation" } });
    expect(screen.getByText("Arrêter Workstation")).toBeTruthy();
    expect(screen.queryByText("Réveiller Workstation")).toBeNull();
  });

  it("ouvre une console sur un serveur", () => {
    renderPalette();
    runCommand("cons mini");
    expect(useStore.getState().openTerminal).toHaveBeenCalledWith("o");
    expect(navigate).toHaveBeenCalledWith("/console");
  });

  it("l'arrêt demande confirmation, avec la commande exécutée, et Annuler n'éteint rien", async () => {
    renderPalette();
    runCommand("arreter mini");
    expect(useStore.getState().shutdownServer).not.toHaveBeenCalled();
    expect(screen.getByText(/minipc \(192\.168\.1\.10\) va être éteint via SSH/)).toBeTruthy();
    expect(screen.getByText(/Commande exécutée : sudo shutdown -h now/)).toBeTruthy();
    fireEvent.click(screen.getByText("Annuler"));
    expect(useStore.getState().shutdownServer).not.toHaveBeenCalled();

    runCommand("arreter mini");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Arrêter" })); });
    expect(useStore.getState().shutdownServer).toHaveBeenCalledWith("o");
  });

  it("le redémarrage et le réveil d'un serveur demandent aussi confirmation", async () => {
    renderPalette();
    runCommand("redemarrer mini");
    expect(useStore.getState().rebootServer).not.toHaveBeenCalled();
    expect(screen.getByText(/Commande exécutée : sudo reboot/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Redémarrer" })); });
    expect(useStore.getState().rebootServer).toHaveBeenCalledWith("o");

    runCommand("reveiller minipc");
    expect(useStore.getState().wakeServer).not.toHaveBeenCalled();
    expect(screen.getByText(/MAC 02:00:00:00:00:01/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Réveiller" })); });
    expect(useStore.getState().wakeServer).toHaveBeenCalledWith("o");
  });

  it("Échap annule une confirmation en attente", () => {
    renderPalette();
    runCommand("arreter mini");
    act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByText(/va être éteint/)).toBeNull();
    expect(useStore.getState().shutdownServer).not.toHaveBeenCalled();
  });

  it("« Modifier » ouvre le formulaire du serveur sur la page Serveurs", () => {
    renderPalette();
    runCommand("modifier mini");
    expect(navigate).toHaveBeenCalledWith("/servers", { state: { editServerId: "o" } });
  });

  it("demande confirmation avant un Wake-on-LAN de groupe", async () => {
    renderPalette();
    runCommand("reveiller lab");
    expect(useStore.getState().wakeGroup).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Réveiller" })); });
    expect(useStore.getState().wakeGroup).toHaveBeenCalledWith("g");
  });

  it("ouvre l'aide des raccourcis clavier", () => {
    renderPalette();
    runCommand("raccourcis");
    expect(useStore.getState().shortcutsHelpOpen).toBe(true);
  });
});
