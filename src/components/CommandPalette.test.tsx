import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "./CommandPalette";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => navigate }));

function openPalette() {
  act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    navigate.mockReset();
    useStore.setState({
      servers: [{ id: "o", name: "minipc", ip: "192.168.50.53" } as Server],
      groups: [{ id: "g", name: "Lab", server_ids: ["o"], icon: null }],
      wakeGroup: vi.fn().mockResolvedValue([]),
      pingServer: vi.fn().mockResolvedValue({}),
      openTerminal: vi.fn(),
    });
  });

  const renderPalette = () =>
    render(<MemoryRouter><CommandPalette pages={[{ to: "/network", label: "Réseau" }]} /></MemoryRouter>);

  it("s'ouvre avec Ctrl+K et navigue vers une page", () => {
    renderPalette();
    expect(screen.queryByLabelText("Recherche de commande")).toBeNull();
    openPalette();
    const input = screen.getByLabelText("Recherche de commande");
    fireEvent.change(input, { target: { value: "reseau" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/network");
  });

  it("ouvre une console sur un serveur", () => {
    renderPalette();
    openPalette();
    const input = screen.getByLabelText("Recherche de commande");
    fireEvent.change(input, { target: { value: "cons mini" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().openTerminal).toHaveBeenCalledWith("o");
    expect(navigate).toHaveBeenCalledWith("/console");
  });

  it("demande confirmation avant un Wake-on-LAN de groupe", () => {
    renderPalette();
    openPalette();
    const input = screen.getByLabelText("Recherche de commande");
    fireEvent.change(input, { target: { value: "reveiller lab" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useStore.getState().wakeGroup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmer"));
    expect(useStore.getState().wakeGroup).toHaveBeenCalledWith("g");
  });

  it("ne propose jamais d'arrêt ni de redémarrage", () => {
    renderPalette();
    openPalette();
    fireEvent.change(screen.getByLabelText("Recherche de commande"), { target: { value: "eteindre" } });
    expect(screen.getByText("Aucun résultat")).toBeTruthy();
  });
});
