/**
 * Ossature de l'application et réglages en anglais : palette, écran de verrouillage,
 * bannière de mise à jour, accueil, badges, modules et messages de validation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { CommandPalette } from "./CommandPalette";
import { LockGate } from "./LockGate";
import { UpdateBanner } from "./UpdateBanner";
import { StatusBadge } from "./StatusBadge";
import { Dashboard } from "../pages/Dashboard";
import { retentionError } from "./HistorySettingsPanel";
import { useStore } from "../stores/useStore";
import { useLockStore } from "../stores/useLockStore";
import { useAppUpdate } from "../stores/useAppUpdate";
import { MODULES } from "../utils/modules";
import { formatIdle, pinError } from "../utils/lock";
import { progressLabel } from "../utils/appUpdate";
import { setLanguage } from "../i18n";
import { LockStatus, Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const minipc = {
  id: "o", name: "minipc", ip: "192.168.1.10", mac_address: "02:00:00:00:00:01",
  shutdown_command: "sudo shutdown -h now", reboot_command: "sudo reboot",
} as Server;

describe("interface en anglais", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    setLanguage("en");
  });
  // Démonter avant de revenir au français (sinon React re-rend hors de act)
  afterEach(() => {
    cleanup();
    setLanguage("fr");
  });

  it("palette de commandes : actions, confirmation et résultat vide", () => {
    useStore.setState({ servers: [minipc], groups: [], shortcutsHelpOpen: false });
    render(<MemoryRouter><CommandPalette pages={[{ to: "/network", label: "Network" }]} /></MemoryRouter>);
    act(() => { fireEvent.keyDown(window, { key: "k", ctrlKey: true }); });

    const input = screen.getByLabelText("Command search");
    expect(screen.getByText("Esc")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "minipc" } });
    for (const label of ["Wake minipc", "Shut down minipc", "Restart minipc", "Open console on minipc", "Ping minipc", "Edit minipc"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    fireEvent.change(input, { target: { value: "shut down minipc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText(/minipc \(192\.168\.1\.10\) will be powered off over SSH/)).toBeInTheDocument();
    expect(screen.getByText(/Command run: sudo shutdown -h now/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shut down" })).toBeInTheDocument();
  });

  it("écran de verrouillage", async () => {
    const locked: LockStatus = {
      enabled: true, locked: true, method: "Hello", has_pin: true, master_password: false, idle_minutes: 10,
      lock_on_session_lock: true, hello_available: true, session_detection: true, retry_after_ms: 0,
    };
    vi.mocked(invoke).mockImplementation(async (cmd: string) => {
      if (cmd === "lock_status") return locked;
      throw new Error("non utilisé");
    });
    useLockStore.setState({ status: null, error: null });
    render(<LockGate><p>minipc</p></LockGate>);

    expect(await screen.findByRole("dialog", { name: "Application locked" })).toBeInTheDocument();
    expect(screen.getByText("Server Manager is locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock with Windows Hello" })).toBeInTheDocument();
    expect(screen.getByText("or with the backup PIN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeInTheDocument();
  });

  it("bannière de mise à jour", () => {
    useAppUpdate.setState({
      status: "available", dismissed: false, error: null, progress: null,
      info: { configured: true, current_version: "0.2.0" },
      github: {
        current_version: "0.2.0", available: true, latest_version: "0.3.0", name: "0.3.0",
        notes: null, html_url: "https://github.com/NolanEDUVAUD/server-manager/releases/tag/v0.3.0",
        published_at: "2026-09-21T14:13:20+00:00",
      },
    });
    render(<UpdateBanner />);
    expect(screen.getByText("Version 0.3.0 available")).toBeInTheDocument();
    expect(screen.getByText(/installed: 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/released on 21\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install and restart" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
  });

  it("tableau de bord sans serveur", () => {
    useStore.setState({ servers: [], statuses: {} });
    render(<Dashboard />);
    expect(screen.getAllByText("No servers configured")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add server" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeInTheDocument();
  });

  it("un composant affiché suit le changement de langue", () => {
    setLanguage("fr");
    render(<StatusBadge status={{ online: true, latency_ms: null, last_checked: 0 }} />);
    expect(screen.getByText("En ligne")).toBeInTheDocument();
    act(() => setLanguage("en"));
    expect(screen.getByText("Online")).toBeInTheDocument();
  });

  it("modules, validations et libellés hors composant", () => {
    expect(MODULES[0].label).toBe("Shutdown / startup");
    expect(MODULES.find((m) => m.key === "console")!.description).toBe("Built-in SSH terminal with tabs");
    expect(pinError("12")).toBe("The PIN must have 4 to 12 digits");
    expect(formatIdle(0)).toBe("Never");
    expect(progressLabel(null)).toBe("Preparing download…");
    expect(retentionError({ raw_days: 0, hourly_days: 90, event_days: 90 })).toBe("Detailed samples: between 1 and 31 days");

    // Les libellés des modules sont lus à chaque accès : ils suivent la langue active
    setLanguage("fr");
    expect(MODULES[0].label).toBe("Arrêt / démarrage");
  });
});
