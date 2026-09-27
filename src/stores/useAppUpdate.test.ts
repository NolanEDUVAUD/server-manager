import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useAppUpdate } from "./useAppUpdate";
import { useStore } from "./useStore";
import { useAppUpdateCheck } from "../hooks/useAppUpdateCheck";
import { installConfirmMessage, progressLabel, progressPercent, formatReleaseDate, formatCheckedAt } from "../utils/appUpdate";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const githubCheck = (over: object = {}) => ({
  current_version: "0.2.0",
  available: false,
  latest_version: "0.2.0",
  name: "",
  notes: null,
  html_url: "https://github.com/NolanEDUVAUD/server-manager/releases/tag/v0.2.0",
  published_at: null,
  ...over,
});

/** Simule le backend : `app_update_info`, `check_github_release` et l'updater signé */
function backend(configured: boolean, onCheck: () => Promise<unknown> = () => Promise.resolve(githubCheck())) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "app_update_info") return Promise.resolve({ configured, current_version: "0.2.0" });
    if (cmd === "check_github_release") return onCheck();
    return Promise.resolve(undefined);
  });
}

function setCheckOnStartup(value: boolean) {
  const s = useStore.getState().settings;
  useStore.setState({ initialized: true, settings: { ...s, general: { ...s.general, check_updates: value } } });
}

function reset() {
  useAppUpdate.setState({ info: null, status: "idle", github: null, lastCheckedAt: null, error: null, progress: null, dismissed: false });
}

describe("useAppUpdate", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    reset();
  });

  it("une recherche silencieuse qui échoue ne montre aucune erreur", async () => {
    backend(true, () => Promise.reject("hors ligne"));
    await useAppUpdate.getState().check({ silent: true });
    expect(useAppUpdate.getState().status).toBe("idle");
    expect(useAppUpdate.getState().error).toBeNull();
    expect(useAppUpdate.getState().lastCheckedAt).not.toBeNull();
  });

  it("une recherche manuelle qui échoue affiche l'erreur", async () => {
    backend(true, () => Promise.reject("hors ligne"));
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toBe("error");
    expect(useAppUpdate.getState().error).toBe("hors ligne");
  });

  it("fonctionne sans updater signé configuré : la recherche interroge toujours GitHub", async () => {
    backend(false, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    await useAppUpdate.getState().check();
    expect(invoke).toHaveBeenCalledWith("check_github_release");
    expect(useAppUpdate.getState().status).toBe("available");
    expect(useAppUpdate.getState().github?.latest_version).toBe("0.3.0");
  });

  it("distingue à jour et disponible", async () => {
    backend(true);
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().status).toBe("up-to-date");

    backend(true, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    useAppUpdate.setState({ dismissed: true });
    await useAppUpdate.getState().check({ silent: true });
    expect(useAppUpdate.getState().status).toBe("available");
    expect(useAppUpdate.getState().github?.latest_version).toBe("0.3.0");
    // Silencieuse : ne réaffiche pas une bannière masquée
    expect(useAppUpdate.getState().dismissed).toBe(true);
  });

  it("une recherche manuelle qui trouve une version réaffiche la bannière masquée", async () => {
    backend(true, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    useAppUpdate.setState({ dismissed: true });
    await useAppUpdate.getState().check();
    expect(useAppUpdate.getState().dismissed).toBe(false);
  });

  it("n'installe rien sans version disponible mémorisée", async () => {
    await useAppUpdate.getState().install();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("installe via l'updater signé quand il propose la même version", async () => {
    backend(true, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    await useAppUpdate.getState().loadInfo();
    await useAppUpdate.getState().check();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "app_update_check") {
        return Promise.resolve({ configured: true, available: true, version: "0.3.0", current_version: "0.2.0", date: null, notes: null });
      }
      return Promise.resolve(undefined);
    });
    await useAppUpdate.getState().install();
    expect(invoke).toHaveBeenCalledWith("app_update_install", { version: "0.3.0" });
  });

  it("ouvre la release dans le navigateur si l'updater signé n'est pas configuré", async () => {
    backend(false, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    await useAppUpdate.getState().loadInfo();
    await useAppUpdate.getState().check();
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useAppUpdate.getState().install();
    expect(invoke).toHaveBeenCalledWith("open_external_url", { url: githubCheck().html_url });
    expect(invoke).not.toHaveBeenCalledWith("app_update_install", expect.anything());
    expect(useAppUpdate.getState().status).toBe("available");
  });

  it("ouvre la release dans le navigateur si l'updater signé ne propose pas la même version", async () => {
    backend(true, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    await useAppUpdate.getState().loadInfo();
    await useAppUpdate.getState().check();
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "app_update_check") {
        return Promise.resolve({ configured: true, available: false, version: null, current_version: "0.2.0", date: null, notes: null });
      }
      return Promise.resolve(undefined);
    });
    await useAppUpdate.getState().install();
    expect(invoke).toHaveBeenCalledWith("open_external_url", expect.anything());
  });
});

describe("useAppUpdateCheck (démarrage)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    reset();
  });

  it("recherche une mise à jour au démarrage quand le réglage est actif, même sans updater signé", async () => {
    backend(false, () => Promise.resolve(githubCheck({ available: true, latest_version: "0.3.0" })));
    setCheckOnStartup(true);
    renderHook(() => useAppUpdateCheck());
    await waitFor(() => expect(useAppUpdate.getState().status).toBe("available"));
    expect(invoke).toHaveBeenCalledWith("check_github_release");
  });

  it("ne contacte pas GitHub si le réglage est désactivé", async () => {
    backend(true);
    setCheckOnStartup(false);
    renderHook(() => useAppUpdateCheck());
    await waitFor(() => expect(useAppUpdate.getState().info).not.toBeNull());
    expect(invoke).not.toHaveBeenCalledWith("check_github_release");
  });
});

describe("utilitaires de mise à jour", () => {
  it("décrit ce que fait l'installation automatique (signée)", () => {
    const m = installConfirmMessage("0.3.0");
    expect(m).toContain("0.3.0");
    expect(m).toMatch(/signature sera vérifiée/);
    expect(m).toMatch(/redémarrera/);
    expect(m).toMatch(/interrompues/);
  });

  it("décrit l'ouverture du navigateur quand l'updater signé n'est pas disponible", () => {
    const m = installConfirmMessage("0.3.0", false);
    expect(m).toContain("0.3.0");
    expect(m).toMatch(/navigateur/);
    expect(m).not.toMatch(/signature sera vérifiée/);
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

  it("formate l'horodatage de la dernière recherche", () => {
    expect(formatCheckedAt(null)).toBe("");
    expect(formatCheckedAt(Date.now())).not.toBe("");
  });
});
