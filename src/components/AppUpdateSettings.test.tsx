import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { AppUpdateSettings } from "./AppUpdateSettings";
import { useAppUpdate } from "../stores/useAppUpdate";
import { useStore } from "../stores/useStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const upToDate = {
  current_version: "0.2.0",
  available: false,
  latest_version: "0.2.0",
  name: "",
  notes: null,
  html_url: "https://github.com/NolanEDUVAUD/server-manager/releases/tag/v0.2.0",
  published_at: null,
};

/** Simule le backend : `app_update_info` et `check_github_release` */
function backend(configured: boolean, check: () => Promise<unknown> = () => Promise.resolve(upToDate)) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "app_update_info") return Promise.resolve({ configured, current_version: "0.2.0" });
    if (cmd === "check_github_release") return check();
    return Promise.resolve(undefined);
  });
}

describe("AppUpdateSettings", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppUpdate.setState({ info: null, status: "idle", github: null, lastCheckedAt: null, error: null, progress: null, dismissed: false });
  });

  it("affiche toujours la version installée, même si l'updater signé n'est pas configuré", async () => {
    backend(false);
    render(<AppUpdateSettings />);

    expect(await screen.findByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rechercher des mises à jour/ })).toBeEnabled();
  });

  it("recherche manuelle : chargement puis « à jour », avec l'heure de la dernière recherche", async () => {
    let answer: (v: unknown) => void = () => {};
    backend(true, () => new Promise((resolve) => { answer = resolve; }));
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher des mises à jour/ });

    expect(screen.getByText("Aucune recherche pour l'instant")).toBeInTheDocument();
    fireEvent.click(button);
    expect(await screen.findByText("Recherche en cours…")).toBeInTheDocument();
    expect(button).toBeDisabled();

    await act(async () => answer(upToDate));
    expect(screen.getByText(/L'application est à jour/)).toBeInTheDocument();
    expect(screen.queryByText("Aucune recherche pour l'instant")).toBeNull();
  });

  it("recherche manuelle : erreur lisible", async () => {
    backend(true, () => Promise.reject("Impossible de vérifier les mises à jour : hors ligne"));
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher des mises à jour/ });

    fireEvent.click(button);
    expect(await screen.findByText(/hors ligne/)).toBeInTheDocument();
    expect(useAppUpdate.getState().status).toBe("error");
  });

  it("une version trouvée propose l'installation avec confirmation", async () => {
    backend(true, () => Promise.resolve({ ...upToDate, available: true, latest_version: "0.3.0", notes: "Corrections" }));
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher des mises à jour/ });

    fireEvent.click(button);
    expect(await screen.findByText(/Version 0\.3\.0 disponible/)).toBeInTheDocument();
    expect(screen.getByText("Corrections")).toBeInTheDocument();
    expect(screen.getByText("Installation automatique et signée disponible")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Installer et redémarrer" }));
    expect(screen.getByText("Installer la version 0.3.0 ?")).toBeInTheDocument();
  });

  it("sans updater signé configuré, dit que la version sera ouverte sur GitHub", async () => {
    backend(false, () => Promise.resolve({ ...upToDate, available: true, latest_version: "0.3.0" }));
    render(<AppUpdateSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /Rechercher des mises à jour/ }));
    expect(await screen.findByText("La version sera ouverte sur GitHub : installation manuelle")).toBeInTheDocument();
  });

  it("une recherche manuelle qui trouve une version réaffiche la bannière masquée", async () => {
    backend(true, () => Promise.resolve({ ...upToDate, available: true, latest_version: "0.3.0" }));
    useAppUpdate.setState({ dismissed: true });
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher des mises à jour/ });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Version 0\.3\.0 disponible/)).toBeInTheDocument());
    expect(useAppUpdate.getState().dismissed).toBe(false);
  });

  it("la case « au démarrage » enregistre le réglage", async () => {
    backend(true);
    const updateGeneral = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ updateGeneral });
    render(<AppUpdateSettings />);

    const box = screen.getByRole("checkbox", { name: /Vérifier les mises à jour au démarrage/ });
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(updateGeneral).toHaveBeenCalledWith({ check_updates: false }));
  });
});
