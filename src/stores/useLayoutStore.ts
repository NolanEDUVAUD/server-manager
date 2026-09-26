/**
 * Préférences d'apparence de la mise en page : largeur de la barre latérale,
 * densité des pages, ordre des onglets et favoris. Persisté dans localStorage
 * (par appareil, jamais partagé) via le middleware `persist` de zustand.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type PageGap = "compact" | "normal" | "spacious";

/** Padding (en pixels) appliqué autour du contenu de la page active */
export const PAGE_GAP_PX: Record<PageGap, number> = { compact: 8, normal: 16, spacious: 28 };

export const SIDEBAR_MIN_WIDTH = 56;
export const SIDEBAR_MAX_WIDTH = 360;
/** En dessous de ce seuil, la barre latérale bascule en mode « icônes seules » */
export const SIDEBAR_COLLAPSE_WIDTH = 120;
export const SIDEBAR_DEFAULT_WIDTH = 224;

/**
 * Fusionne un ordre mémorisé avec l'ordre par défaut : les onglets connus gardent
 * leur position relative, les nouveaux (ou ceux qui n'existaient pas encore lors de
 * l'enregistrement) sont ajoutés à la fin, dans l'ordre par défaut. Les entrées qui ne
 * correspondent plus à un onglet existant (module retiré, ancienne route) sont ignorées.
 */
export function mergeOrder(defaultOrder: string[], stored: string[]): string[] {
  const known = new Set(defaultOrder);
  const kept = stored.filter((r) => known.has(r));
  const keptSet = new Set(kept);
  const missing = defaultOrder.filter((r) => !keptSet.has(r));
  return [...kept, ...missing];
}

/** Déplace `from` juste avant `to` dans la liste (sans effet si l'un des deux est absent) */
export function moveItem(list: string[], from: string, to: string): string[] {
  if (from === to || !list.includes(from) || !list.includes(to)) return list;
  const without = list.filter((x) => x !== from);
  const targetIndex = without.indexOf(to);
  return [...without.slice(0, targetIndex), from, ...without.slice(targetIndex)];
}

/** Ajoute (ou déplace) une route dans les favoris, avant `before` (ou en fin de liste si omis) */
export function addToFavorites(favorites: string[], route: string, before?: string | null): string[] {
  const without = favorites.filter((r) => r !== route);
  if (!before || !without.includes(before)) return [...without, route];
  const targetIndex = without.indexOf(before);
  return [...without.slice(0, targetIndex), route, ...without.slice(targetIndex)];
}

export function removeFromFavorites(favorites: string[], route: string): string[] {
  return favorites.filter((r) => r !== route);
}

interface LayoutState {
  sidebarWidth: number;
  pageGap: PageGap;
  /** Ordre mémorisé de tous les onglets (favoris compris, fusionné via `mergeOrder`) */
  tabOrder: string[];
  /** Routes épinglées, dans leur ordre d'affichage */
  favorites: string[];

  setSidebarWidth: (width: number) => void;
  resetSidebarWidth: () => void;
  setPageGap: (gap: PageGap) => void;
  setTabOrder: (order: string[]) => void;
  resetTabOrder: () => void;
  resetFavorites: () => void;
  setFavorites: (favorites: string[]) => void;
  addFavorite: (route: string, before?: string | null) => void;
  removeFavorite: (route: string) => void;
}

/** localStorage n'est pas toujours disponible (navigation privée, tests…) : jamais bloquant */
function safeStorage() {
  const memory = new Map<string, string>();
  return {
    getItem(name: string): string | null {
      try {
        return localStorage.getItem(name);
      } catch {
        return memory.get(name) ?? null;
      }
    },
    setItem(name: string, value: string) {
      try {
        localStorage.setItem(name, value);
      } catch {
        memory.set(name, value);
      }
    },
    removeItem(name: string) {
      try {
        localStorage.removeItem(name);
      } catch {
        memory.delete(name);
      }
    },
  };
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      pageGap: "normal",
      tabOrder: [],
      favorites: [],

      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))) }),
      resetSidebarWidth: () => set({ sidebarWidth: SIDEBAR_DEFAULT_WIDTH }),
      setPageGap: (gap) => set({ pageGap: gap }),
      setTabOrder: (order) => set({ tabOrder: order }),
      resetTabOrder: () => set({ tabOrder: [] }),
      resetFavorites: () => set({ favorites: [] }),
      setFavorites: (favorites) => set({ favorites }),
      addFavorite: (route, before) => set((s) => ({ favorites: addToFavorites(s.favorites, route, before) })),
      removeFavorite: (route) => set((s) => ({ favorites: removeFromFavorites(s.favorites, route) })),
    }),
    {
      name: "layout-preferences",
      storage: createJSONStorage(safeStorage),
    }
  )
);
