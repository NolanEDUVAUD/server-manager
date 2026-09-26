import { describe, it, expect, beforeEach } from "vitest";
import {
  useLayoutStore, mergeOrder, moveItem, addToFavorites, removeFromFavorites,
  SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_DEFAULT_WIDTH,
} from "./useLayoutStore";

describe("mergeOrder : fusion de l'ordre mémorisé avec l'ordre par défaut", () => {
  it("conserve l'ordre mémorisé pour les onglets connus", () => {
    expect(mergeOrder(["/", "/servers", "/settings"], ["/settings", "/", "/servers"])).toEqual([
      "/settings", "/", "/servers",
    ]);
  });

  it("ajoute les nouveaux onglets à la fin, dans l'ordre par défaut", () => {
    expect(mergeOrder(["/", "/servers", "/docker", "/settings"], ["/settings", "/"])).toEqual([
      "/settings", "/", "/servers", "/docker",
    ]);
  });

  it("ignore les entrées mémorisées qui ne correspondent plus à un onglet existant", () => {
    expect(mergeOrder(["/", "/servers"], ["/services", "/servers", "/"])).toEqual(["/servers", "/"]);
  });

  it("liste mémorisée vide : renvoie l'ordre par défaut tel quel", () => {
    expect(mergeOrder(["/", "/servers"], [])).toEqual(["/", "/servers"]);
  });
});

describe("moveItem : réordonnancement au sein d'une liste", () => {
  it("déplace un élément juste avant la cible", () => {
    expect(moveItem(["/", "/servers", "/docker"], "/docker", "/servers")).toEqual(["/", "/docker", "/servers"]);
    expect(moveItem(["/", "/servers", "/docker"], "/", "/docker")).toEqual(["/servers", "/", "/docker"]);
  });

  it("ne fait rien si la source et la cible sont identiques, ou si l'une est absente", () => {
    const list = ["/", "/servers", "/docker"];
    expect(moveItem(list, "/servers", "/servers")).toBe(list);
    expect(moveItem(list, "/inconnu", "/servers")).toBe(list);
    expect(moveItem(list, "/servers", "/inconnu")).toBe(list);
  });
});

describe("favoris : ajout, retrait, réordonnancement", () => {
  it("ajoute une route en fin de liste par défaut", () => {
    expect(addToFavorites(["/"], "/servers")).toEqual(["/", "/servers"]);
  });

  it("insère avant une route donnée", () => {
    expect(addToFavorites(["/", "/servers"], "/docker", "/servers")).toEqual(["/", "/docker", "/servers"]);
  });

  it("déplace la route si elle est déjà favorite (pas de doublon)", () => {
    expect(addToFavorites(["/", "/servers", "/docker"], "/servers", "/")).toEqual(["/servers", "/", "/docker"]);
  });

  it("ajoute en fin de liste si la cible n'existe pas parmi les favoris", () => {
    expect(addToFavorites(["/"], "/servers", "/inconnu")).toEqual(["/", "/servers"]);
  });

  it("retire une route des favoris", () => {
    expect(removeFromFavorites(["/", "/servers", "/docker"], "/servers")).toEqual(["/", "/docker"]);
    // Sans effet si la route n'y est pas
    expect(removeFromFavorites(["/"], "/servers")).toEqual(["/"]);
  });
});

describe("useLayoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH, pageGap: "normal", tabOrder: [], favorites: [],
    });
  });

  it("largeur de la barre latérale : bornée entre le minimum et le maximum", () => {
    useLayoutStore.getState().setSidebarWidth(10);
    expect(useLayoutStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    useLayoutStore.getState().setSidebarWidth(1000);
    expect(useLayoutStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    useLayoutStore.getState().setSidebarWidth(200);
    expect(useLayoutStore.getState().sidebarWidth).toBe(200);
  });

  it("réinitialise la largeur à la valeur par défaut", () => {
    useLayoutStore.getState().setSidebarWidth(90);
    useLayoutStore.getState().resetSidebarWidth();
    expect(useLayoutStore.getState().sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it("densité des pages", () => {
    useLayoutStore.getState().setPageGap("spacious");
    expect(useLayoutStore.getState().pageGap).toBe("spacious");
  });

  it("réinitialise l'ordre des onglets", () => {
    useLayoutStore.getState().setTabOrder(["/servers", "/"]);
    useLayoutStore.getState().resetTabOrder();
    expect(useLayoutStore.getState().tabOrder).toEqual([]);
  });

  it("ajoute et retire un favori via les actions du store", () => {
    useLayoutStore.getState().addFavorite("/servers");
    expect(useLayoutStore.getState().favorites).toEqual(["/servers"]);
    useLayoutStore.getState().addFavorite("/docker", "/servers");
    expect(useLayoutStore.getState().favorites).toEqual(["/docker", "/servers"]);
    useLayoutStore.getState().removeFavorite("/servers");
    expect(useLayoutStore.getState().favorites).toEqual(["/docker"]);
  });
});
