import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { AppUpdateSettings } from "./AppUpdateSettings";
import { NOT_CONFIGURED_KEY, useAppUpdate } from "../stores/useAppUpdate";
import { useStore } from "../stores/useStore";
import { t } from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const upToDate = { configured: true, available: false, version: null, current_version: "0.2.0", date: null, notes: null };

/** Simule le backend : `app_update_info` et `app_update_check` */
function backend(configured: boolean, check: () => Promise<unknown> = () => Promise.resolve(upToDate)) {
  vi.mocked(invoke).mockImplementation((cmd: string) => {
    if (cmd === "app_update_info") return Promise.resolve({ configured, current_version: "0.2.0" });
    if (cmd === "app_update_check") return check();
    return Promise.resolve(undefined);
  });
}

describe("AppUpdateSettings", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAppUpdate.setState({ info: null, status: "idle", update: null, error: null, progress: null, dismissed: false });
  });

  it("indique clairement que les mises à jour ne sont pas configurées", async () => {
    backend(false);
    render(<AppUpdateSettings />);

    expect(await screen.findByText(t(NOT_CONFIGURED_KEY))).toBeInTheDocument();
    expect(screen.getByText("Mises à jour automatiques non configurées pour cette version")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rechercher maintenant/ })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalledWith("app_update_check");
  });

  it("recherche manuelle : chargement puis « à jour »", async () => {
    let answer: (v: unknown) => void = () => {};
    backend(true, () => new Promise((resolve) => { answer = resolve; }));
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher maintenant/ });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(await screen.findByText("Recherche en cours…")).toBeInTheDocument();
    expect(button).toBeDisabled();

    await act(async () => answer(upToDate));
    expect(screen.getByText(/L'application est à jour/)).toBeInTheDocument();
  });

  it("recherche manuelle : erreur lisible", async () => {
    backend(true, () => Promise.reject("Impossible de vérifier les mises à jour : hors ligne"));
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher maintenant/ });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(await screen.findByText(/hors ligne/)).toBeInTheDocument();
    expect(useAppUpdate.getState().status).toBe("error");
  });

  it("une version trouvée réaffiche la bannière masquée", async () => {
    backend(true, () => Promise.resolve({ ...upToDate, available: true, version: "0.3.0" }));
    useAppUpdate.setState({ dismissed: true });
    render(<AppUpdateSettings />);
    const button = await screen.findByRole("button", { name: /Rechercher maintenant/ });
    await waitFor(() => expect(button).toBeEnabled());

    fireEvent.click(button);
    expect(await screen.findByText(/Version 0\.3\.0 disponible/)).toBeInTheDocument();
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
