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

  // ── Glisser-déposer des onglets (au pointeur, pas en HTML5 drag & drop : voir Layout.tsx) ──
  describe("glisser-déposer des onglets", () => {
    /** Positionne artificiellement chaque onglet sur une ligne (jsdom ne fait pas de layout réel). */
    function stubRect(el: Element, top: number, height = 32) {
      vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
        top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON() {},
      } as DOMRect);
    }

    function itemsByRoute(container: HTMLElement) {
      const items = Array.from(container.querySelectorAll<HTMLElement>("[data-nav-route]"));
      items.forEach((el, i) => stubRect(el, i * 32));
      return new Map(items.map((el) => [el.getAttribute("data-nav-route"), el]));
    }

    /** jsdom n'implémente pas elementFromPoint : on le fournit nous-mêmes. */
    function stubElementFromPoint(el: Element) {
      document.elementFromPoint = vi.fn(() => el as Element);
    }

    /**
     * jsdom ne construit pas de vrai `PointerEvent`, et `fireEvent.pointer*` de
     * testing-library ne reporte alors pas `clientX`/`clientY`/`button` sur l'événement
     * généré. On construit donc l'événement nous-mêmes à partir d'un `MouseEvent` (qui,
     * lui, supporte ces propriétés) et on y ajoute `pointerId` manuellement — le
     * composant ne lit rien d'autre de spécifique à `PointerEvent`.
     */
    function firePointer(type: "pointerdown" | "pointermove" | "pointerup", target: Document | Node | Element | Window, opts: { clientX: number; clientY: number; button?: number; pointerId: number }) {
      const event = new MouseEvent(type, { clientX: opts.clientX, clientY: opts.clientY, button: opts.button ?? 0, bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerId", { value: opts.pointerId });
      fireEvent(target, event);
    }

    afterEach(() => {
      // @ts-expect-error -- retire le stub sans toucher aux autres mocks (getVersion, invoke…)
      delete document.elementFromPoint;
    });

    it("réordonne deux onglets par glisser-déposer (pointerdown → move au-delà du seuil → pointerup)", () => {
      const { container } = renderLayout();
      const items = itemsByRoute(container);
      const groups = items.get("/groups")!; // juste après /servers dans l'ordre par défaut
      const servers = items.get("/servers")!;

      firePointer("pointerdown", servers, { clientX: 10, clientY: 32, pointerId: 1 });
      // Sous le seuil de 5px : pas encore un glissement
      stubElementFromPoint(servers);
      firePointer("pointermove", window, { clientX: 10, clientY: 34, pointerId: 1 });
      expect(useLayoutStore.getState().tabOrder).toEqual([]);

      // Au-delà du seuil, au-dessus de la moitié haute de /groups → inséré avant lui
      stubElementFromPoint(groups);
      firePointer("pointermove", window, { clientX: 10, clientY: 64 + 4, pointerId: 1 });
      firePointer("pointerup", window, { clientX: 10, clientY: 68, pointerId: 1 });

      const order = useLayoutStore.getState().tabOrder;
      expect(order.indexOf("/servers")).toBeLessThan(order.indexOf("/groups"));
    });

    it("dépose un onglet dans les Favoris", () => {
      const { container } = renderLayout();
      const items = itemsByRoute(container);
      const servers = items.get("/servers")!;
      const favoritesZone = container.querySelector('[data-nav-zone="favorites"]') as HTMLElement;
      stubRect(favoritesZone, 0, 40);

      firePointer("pointerdown", servers, { clientX: 10, clientY: 32, pointerId: 2 });
      stubElementFromPoint(favoritesZone);
      firePointer("pointermove", window, { clientX: 10, clientY: 20, pointerId: 2 });
      firePointer("pointerup", window, { clientX: 10, clientY: 20, pointerId: 2 });

      expect(useLayoutStore.getState().favorites).toContain("/servers");
    });

    it("Échap annule le glissement en cours sans modifier l'ordre ni les favoris", () => {
      const { container } = renderLayout();
      const items = itemsByRoute(container);
      const groups = items.get("/groups")!;
      const servers = items.get("/servers")!;

      firePointer("pointerdown", servers, { clientX: 10, clientY: 32, pointerId: 3 });
      stubElementFromPoint(groups);
      firePointer("pointermove", window, { clientX: 10, clientY: 68, pointerId: 3 });
      fireEvent.keyDown(window, { key: "Escape" });
      firePointer("pointerup", window, { clientX: 10, clientY: 68, pointerId: 3 });

      expect(useLayoutStore.getState().tabOrder).toEqual([]);
      expect(useLayoutStore.getState().favorites).toEqual([]);
    });

    it("un simple clic (sans mouvement) ne déclenche pas de glissement et laisse la navigation faire son travail", () => {
      const { container } = renderLayout();
      const items = itemsByRoute(container);
      const servers = items.get("/servers")!;

      firePointer("pointerdown", servers, { clientX: 10, clientY: 32, pointerId: 4 });
      firePointer("pointerup", window, { clientX: 10, clientY: 32, pointerId: 4 });

      // Pas de glissement détecté : aucun état de layout modifié, le clic natif du lien
      // (non intercepté) peut naviguer normalement.
      expect(useLayoutStore.getState().tabOrder).toEqual([]);
      expect(screen.queryByText("Serveurs")).toBeInTheDocument();
    });
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
