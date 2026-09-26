/**
 * Mise en page : navigation, favoris et personnalisation (largeur, densité).
 * La console est toujours montée ; les tests de son propre contenu vivent ailleurs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Layout } from "./Layout";
import { useStore } from "../stores/useStore";
import { useLayoutStore, SIDEBAR_DEFAULT_WIDTH } from "../stores/useLayoutStore";
import { setLanguage } from "../i18n";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn().mockResolvedValue("0.3.0") }));

function renderLayout() {
  return render(
    <MemoryRouter>
      <Layout>
        <p>contenu</p>
      </Layout>
    </MemoryRouter>
  );
}

describe("Layout", () => {
  beforeEach(() => {
    useStore.setState({ servers: [], statuses: {} });
    useLayoutStore.setState({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH, pageGap: "normal", tabOrder: [], favorites: [] });
  });
  afterEach(() => {
    cleanup();
    setLanguage("fr");
  });

  it("affiche la navigation et le contenu de la page", () => {
    renderLayout();
    expect(screen.getByText("Server Manager")).toBeInTheDocument();
    expect(screen.getByText("Serveurs")).toBeInTheDocument();
    expect(screen.getByText("contenu")).toBeInTheDocument();
  });

  it("n'affiche plus l'onglet Services (supprimé)", () => {
    renderLayout();
    expect(screen.queryByText("layout.nav.services")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Services")).not.toBeInTheDocument();
  });

  it("épingle un onglet en favori puis le retire", async () => {
    renderLayout();
    const [pinButton] = await screen.findAllByTitle("Ajouter aux favoris");
    fireEvent.click(pinButton);
    expect(useLayoutStore.getState().favorites).toHaveLength(1);
    const pinned = useLayoutStore.getState().favorites[0];

    const unpinButton = screen.getByTitle("Retirer des favoris");
    fireEvent.click(unpinButton);
    expect(useLayoutStore.getState().favorites).not.toContain(pinned);
  });

  it("affiche la zone de dépôt des favoris quand elle est vide", () => {
    renderLayout();
    expect(screen.getByText("Glissez un onglet ici")).toBeInTheDocument();
  });

  it("ouvre le panneau de personnalisation et change la densité des pages", () => {
    renderLayout();
    fireEvent.click(screen.getByTitle("Personnaliser"));
    fireEvent.click(screen.getByText("Spacieux"));
    expect(useLayoutStore.getState().pageGap).toBe("spacious");
  });

  it("réinitialise l'ordre des onglets depuis le panneau de personnalisation", () => {
    useLayoutStore.setState({ tabOrder: ["/servers", "/"] });
    renderLayout();
    fireEvent.click(screen.getByTitle("Personnaliser"));
    fireEvent.click(screen.getByText("Réinitialiser l'ordre des onglets"));
    expect(useLayoutStore.getState().tabOrder).toEqual([]);
  });

  it("bascule en mode icônes seules sous le seuil de repli, et réinitialise au double-clic", () => {
    renderLayout();
    const handle = screen.getByRole("separator", { name: /Redimensionner/ });
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientX: 60 });
    fireEvent.mouseUp(window);
    expect(useLayoutStore.getState().sidebarWidth).toBe(60);
    expect(screen.queryByText("Serveurs")).not.toBeInTheDocument();

    fireEvent.doubleClick(handle);
    expect(useLayoutStore.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
