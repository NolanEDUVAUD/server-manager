import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { UpdateBanner } from "./UpdateBanner";
import { useAppUpdate } from "../stores/useAppUpdate";
import { AppUpdateCheck } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

// Capture de l'écouteur de progression pour simuler les événements du backend
let progressHandler: ((e: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, cb: (e: { payload: unknown }) => void) => {
    progressHandler = cb;
    return Promise.resolve(() => {});
  }),
}));

const available: AppUpdateCheck = {
  configured: true,
  available: true,
  version: "0.3.0",
  current_version: "0.2.0",
  date: "2026-09-21T14:13:20+00:00",
  notes: "<img src=x onerror=alert(1)>\n- Correction du ping",
};

/** Le bouton de la bannière, puis celui du ConfirmDialog (rendu après), portent le même libellé */
const installButtons = () => screen.getAllByRole("button", { name: "Installer et redémarrer" });

describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    progressHandler = null;
    useAppUpdate.setState({ info: null, status: "idle", update: null, error: null, progress: null, dismissed: false });
  });

  it("ne s'affiche pas sans version disponible", () => {
    for (const status of ["idle", "checking", "up-to-date", "not-configured", "error"] as const) {
      useAppUpdate.setState({ status });
      const { container, unmount } = render(<UpdateBanner />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });

  it("affiche la version disponible et ses notes en texte, jamais en HTML", () => {
    useAppUpdate.setState({ status: "available", update: available });
    const { container } = render(<UpdateBanner />);

    expect(screen.getByText("Version 0.3.0 disponible")).toBeInTheDocument();
    expect(screen.getByText(/installée : 0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByText(/publiée le 21\/09\/2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Notes de version/ }));
    expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("n'installe qu'après confirmation, en disant ce qui va se passer", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useAppUpdate.setState({ status: "available", update: available });
    render(<UpdateBanner />);

    fireEvent.click(installButtons()[0]);
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByText("Installer la version 0.3.0 ?")).toBeInTheDocument();
    const message = screen.getByText(/téléchargée depuis GitHub/);
    expect(message).toHaveTextContent(/signature sera vérifiée/);
    expect(message).toHaveTextContent(/redémarrera/);
    expect(message).toHaveTextContent(/seront interrompues/);

    // Annuler : rien n'est lancé
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(invoke).not.toHaveBeenCalled();

    // Confirmer : installation de la version exacte affichée
    fireEvent.click(installButtons()[0]);
    fireEvent.click(installButtons()[1]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("app_update_install", { version: "0.3.0" }));
  });

  it("affiche la progression puis une erreur lisible avec un nouvel essai", async () => {
    let fail: (e: unknown) => void = () => {};
    vi.mocked(invoke).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    useAppUpdate.setState({ status: "available", update: available });
    render(<UpdateBanner />);

    fireEvent.click(installButtons()[0]);
    fireEvent.click(installButtons()[1]);
    expect(await screen.findByText("Préparation du téléchargement…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plus tard" })).toBeNull();

    await waitFor(() => expect(progressHandler).not.toBeNull());
    act(() => progressHandler!({ payload: { phase: "downloading", downloaded: 50, total: 200 } }));
    expect(screen.getByText("Téléchargement… 25 %")).toBeInTheDocument();
    act(() => progressHandler!({ payload: { phase: "verifying", downloaded: 200, total: 200 } }));
    expect(screen.getByText("Vérification de la signature…")).toBeInTheDocument();

    await act(async () => fail("Téléchargement ou vérification de la signature impossible : signature invalide"));
    expect(await screen.findByText(/signature invalide/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer l'installation" })).toBeInTheDocument();
  });

  it("« Plus tard » masque la bannière", () => {
    useAppUpdate.setState({ status: "available", update: available });
    const { container } = render(<UpdateBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(container).toBeEmptyDOMElement();
    expect(invoke).not.toHaveBeenCalled();
  });
});
