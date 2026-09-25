import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./useStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const srv = (id: string, name: string): Server => ({
  id, name, ip: "10.0.0.1", mac_address: "", ssh_user: "root", ssh_password: "",
  ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux",
});

describe("terminal sessions store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    useStore.setState({
      servers: [srv("a", "minipc"), srv("b", "truenas")],
      terminalSessions: [],
      activeTerminalKey: null,
    });
  });

  it("openTerminal ajoute une session en connexion et l'active", () => {
    const key = useStore.getState().openTerminal("a");

    const { terminalSessions, activeTerminalKey } = useStore.getState();
    expect(terminalSessions).toHaveLength(1);
    expect(terminalSessions[0]).toMatchObject({ key, serverId: "a", title: "minipc", status: "connecting", attempt: 0 });
    expect(activeTerminalKey).toBe(key);
  });

  it("numérote les sessions multiples sur le même serveur", () => {
    useStore.getState().openTerminal("a");
    useStore.getState().openTerminal("a");

    expect(useStore.getState().terminalSessions.map((s) => s.title)).toEqual(["minipc", "minipc (2)"]);
  });

  it("closeTerminal ferme la session côté backend et active la voisine", async () => {
    const k1 = useStore.getState().openTerminal("a");
    const k2 = useStore.getState().openTerminal("b");
    useStore.getState().updateTerminal(k2, { sessionId: "sess-2", status: "open" });

    await useStore.getState().closeTerminal(k2);

    expect(invoke).toHaveBeenCalledWith("terminal_close", { sessionId: "sess-2" });
    expect(useStore.getState().terminalSessions.map((s) => s.key)).toEqual([k1]);
    expect(useStore.getState().activeTerminalKey).toBe(k1);
  });

  it("closeTerminal sur une session jamais connectée n'appelle pas le backend", async () => {
    const k = useStore.getState().openTerminal("a");

    await useStore.getState().closeTerminal(k);

    expect(invoke).not.toHaveBeenCalled();
    expect(useStore.getState().activeTerminalKey).toBeNull();
  });

  it("reconnectTerminal relance la connexion d'une session fermée", () => {
    const k = useStore.getState().openTerminal("a");
    useStore.getState().updateTerminal(k, { status: "closed", closedReason: "Déconnecté", sessionId: undefined });

    useStore.getState().reconnectTerminal(k);

    expect(useStore.getState().terminalSessions[0]).toMatchObject({ status: "connecting", attempt: 1, closedReason: undefined });
  });
});
