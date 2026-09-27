/**
 * Tutoriel interactif : navigation (boutons, clavier), rôles ARIA, filtrage par
 * modules visibles et bouton « Essayer » qui navigue sans fermer le tour.
 * Le positionnement des coach-marks est couvert par src/utils/tour.test.ts (logique pure).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { TourModal } from "./TourModal";
import { useTourStore } from "../stores/useTourStore";
import { useStore } from "../stores/useStore";
import { t, setLanguage } from "../i18n";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTour(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationProbe />
      <TourModal />
    </MemoryRouter>
  );
}

describe("TourModal", () => {
  beforeEach(() => {
    useTourStore.setState({ isOpen: true, onlyIds: null });
    useStore.setState((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, hidden_modules: [] } } }));
  });

  afterEach(() => {
    cleanup();
    useTourStore.setState({ isOpen: false, onlyIds: null });
    setLanguage("fr");
  });

  it("s'affiche comme une boîte de dialogue accessible, à la première étape", () => {
    renderTour();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(t("tour.steps.welcome.title"))).toBeInTheDocument();
    expect(screen.getByText(t("tour.progress", { current: 1, total: 9 }))).toBeInTheDocument();
  });

  it("ne s'affiche pas quand le tour est fermé", () => {
    useTourStore.setState({ isOpen: false });
    renderTour();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("avance et recule avec les boutons Suivant / Précédent", () => {
    renderTour();
    fireEvent.click(screen.getByText(t("tour.next")));
    expect(screen.getByText(t("tour.steps.dashboard.title"))).toBeInTheDocument();
    expect(screen.getByText(t("tour.progress", { current: 2, total: 9 }))).toBeInTheDocument();

    fireEvent.click(screen.getByText(t("tour.prev")));
    expect(screen.getByText(t("tour.steps.welcome.title"))).toBeInTheDocument();
  });

  it("navigue avec les flèches du clavier et ferme avec Échap", () => {
    renderTour();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(t("tour.steps.dashboard.title"))).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText(t("tour.steps.welcome.title"))).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useTourStore.getState().isOpen).toBe(false);
  });

  it("« Passer le tutoriel » ferme le tour immédiatement", () => {
    renderTour();
    fireEvent.click(screen.getByTitle(t("tour.skip")));
    expect(useTourStore.getState().isOpen).toBe(false);
  });

  it("affiche le bouton « Terminé » sur la dernière étape et ferme le tour", () => {
    renderTour();
    for (let i = 0; i < 8; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(t("tour.steps.settings.title"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("tour.done")));
    expect(useTourStore.getState().isOpen).toBe(false);
  });

  it("« Essayer » navigue vers l'onglet visé sans fermer ni avancer le tour", () => {
    renderTour("/");
    // Étape « serveurs » : welcome -> dashboard -> servers
    fireEvent.click(screen.getByText(t("tour.next")));
    fireEvent.click(screen.getByText(t("tour.next")));
    expect(screen.getByText(t("tour.steps.servers.title"))).toBeInTheDocument();

    fireEvent.click(screen.getByText(t("tour.try")));

    expect(screen.getByTestId("location").textContent).toBe("/servers");
    expect(useTourStore.getState().isOpen).toBe(true);
    expect(screen.getByText(t("tour.steps.servers.title"))).toBeInTheDocument();
  });

  it("ne propose pas « Essayer » quand on est déjà sur l'onglet visé", () => {
    renderTour("/servers");
    fireEvent.click(screen.getByText(t("tour.next")));
    fireEvent.click(screen.getByText(t("tour.next")));
    expect(screen.getByText(t("tour.steps.servers.title"))).toBeInTheDocument();
    expect(screen.queryByText(t("tour.try"))).not.toBeInTheDocument();
  });

  it("exclut les étapes des modules masqués (progression et contenu)", () => {
    useStore.setState((s) => ({ settings: { ...s.settings, general: { ...s.settings.general, hidden_modules: ["console", "batch"] } } }));
    renderTour();
    expect(screen.getByText(t("tour.progress", { current: 1, total: 7 }))).toBeInTheDocument();
    for (let i = 0; i < 6; i++) fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText(t("tour.steps.settings.title"))).toBeInTheDocument();
  });

  it("rejoue uniquement les étapes demandées via onlyIds (Quoi de neuf ?)", () => {
    useTourStore.setState({ isOpen: true, onlyIds: ["network"] });
    renderTour();
    expect(screen.getByText(t("tour.steps.network.title"))).toBeInTheDocument();
    expect(screen.getByText(t("tour.progress", { current: 1, total: 1 }))).toBeInTheDocument();
    expect(screen.getByText(t("tour.done"))).toBeInTheDocument();
  });
});
