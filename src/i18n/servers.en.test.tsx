import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { formatBytes, formatUptime } from "../utils";
import { authSummary, authWarning, deployBlockedReason } from "../utils/sshAuth";
import { Server } from "../types";
import { setLanguage } from ".";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("serveurs, clés SSH et formats en anglais", () => {
  afterEach(() => setLanguage("fr"));

  it("formats de taille et de durée", () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 Go");
    expect(formatUptime(90_000)).toBe("1 j 1 h");
    setLanguage("en");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatUptime(90_000)).toBe("1 d 1 h");
  });

  it("authentification SSH : avertissements et résumé", () => {
    setLanguage("en");
    expect(authWarning("Key", [], null)).toMatch(/^No SSH key saved/);
    expect(deployBlockedReason("ESXi")).toMatch(/^Automatic deployment is not possible on ESXi/);
    const server = { id: "a", name: "minipc", auth_method: "Password", jump_host_id: "b" } as Server;
    const jump = { id: "b", name: "FwNode" } as Server;
    expect(authSummary(server, [], [server, jump])).toBe("Password · via FwNode");
  });

  it("boutons par défaut des confirmations", () => {
    setLanguage("en");
    render(<ConfirmDialog title="t" message="m" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
