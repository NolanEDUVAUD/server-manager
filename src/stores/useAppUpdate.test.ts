import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAppUpdate } from "./useAppUpdate";
import { useStore } from "./useStore";
import { useAppUpdateCheck } from "../hooks/useAppUpdateCheck";
import { installConfirmMessage, progressLabel, progressPercent, formatReleaseDate } from "../utils/appUpdate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const check = (over: object = {}) => ({
  configured: true, available: false, version: null, current_version: "0.2.0", date: null, notes: null, ...over,
});

function backend(configured: boolean, onCheck: () => Promise<unknown> = () => Promise.resolve(check())) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "app_update_info") return Promise.resolve({ configured, current_version: "0.2.0" });
    if (cmd === "app_update_check") return onCheck();
    return Promise.resolve(undefined);
  });
}

function setCheckOnStartup(value: boolean) {
  const s = useStore.getState().settings;
  useStore.setState({ initialized: true, settings: { ...s, general: { ...s.general, check_updates: value } } });
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useAppUpdate.setState({ info: null, status: "idle", update: null, error: null, progress: null, dismissed: false });
  });

  it("une recherche silencieuse qui échoue ne montre aucune erreur", async () => {
    backend(true, () => Promise.reject("hors ligne"));
    await useAppUpdate.getState().check({ silent: true });
    expect(useAppUpdate.getState().status).toBe("idle");
    expect(useAppUpdate.getState().error).toBeNull();
  });

  it("une recherche manuelle qui échoue affiche l'erreur", async () => {
    backend(true, () => Promise.reject("hors ligne"));
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toBe("error");
    expect(useAppUpdate.getState().error).toBe("hors ligne");
  });

  it("distingue non configuré, à jour et disponible", async () => {
    backend(true, () => Promise.resolve(check({ configured: false })));
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toBe("not-configured");

    backend(true);
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toBe("up-to-date");

    backend(true, () => Promise.resolve(check({ available: true, version: "0.3.0" })));
    useAppUpdate.setState({ dismissed: true });
    await useAppUpdate.getState().check({ silent: true });
    expect(useAppUpdate.getState().status).toBe("available");
    expect(useAppUpdate.getState().update?.version).toBe("0.3.0");
    // Silencieuse : ne réaffiche pas une bannière masquée
    expect(useAppUpdate.getState().dismissed).toBe(true);
  });

  it("n'installe rien sans version mémorisée", async () => {
    await useAppUpdate.getState().install();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("useAppUpdateCheck (démarrage)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppUpdate.setState({ info: null, status: "idle", update: null, error: null, progress: null, dismissed: false });
  });

  it("recherche une mise à jour quand la clé est configurée et le réglage actif", async () => {
    backend(true, () => Promise.resolve(check({ available: true, version: "0.3.0" })));
    setCheckOnStartup(true);
    renderHook(() => useAppUpdateCheck());
    await waitFor(() => expect(useAppUpdate.getState().status).toBe("available"));
    expect(invoke).toHaveBeenCalledWith("app_update_check");
  });

  it("ne contacte pas GitHub si le réglage est désactivé", async () => {
    backend(true);
    setCheckOnStartup(false);
    renderHook(() => useAppUpdateCheck());
    await waitFor(() => expect(useAppUpdate.getState().info).not.toBeNull());
    expect(invoke).not.toHaveBeenCalledWith("app_update_check");
  });

  it("ne contacte pas GitHub si les mises à jour ne sont pas configurées", async () => {
    backend(false);
    setCheckOnStartup(true);
    renderHook(() => useAppUpdateCheck());
    await waitFor(() => expect(useAppUpdate.getState().status).toBe("not-configured"));
    expect(invoke).not.toHaveBeenCalledWith("app_update_check");
  });
});

describe("utilitaires de mise à jour", () => {
  it("décrit ce que fait l'installation", () => {
    const m = installConfirmMessage("0.3.0");
    expect(m).toContain("0.3.0");
    expect(m).toMatch(/signature sera vérifiée/);
    expect(m).toMatch(/redémarrera/);
    expect(m).toMatch(/interrompues/);
  });

  it("formate la progression", () => {
    expect(progressLabel(null)).toBe("Préparation du téléchargement…");
    expect(progressPercent({ phase: "downloading", downloaded: 999, total: 1000 })).toBe(99);
    expect(progressPercent({ phase: "downloading", downloaded: 5, total: null })).toBeNull();
    expect(progressLabel({ phase: "downloading", downloaded: 3 * 1024 * 1024, total: null })).toBe("Téléchargement… 3 Mo");
    expect(progressLabel({ phase: "installing", downloaded: 1, total: 1 })).toMatch(/redémarrer/);
  });

  it("formate la date de publication", () => {
    expect(formatReleaseDate("2026-09-21T14:13:20+00:00")).toBe("21/09/2026");
    expect(formatReleaseDate(null)).toBe("");
    expect(formatReleaseDate("pas une date")).toBe("");
  });
});
