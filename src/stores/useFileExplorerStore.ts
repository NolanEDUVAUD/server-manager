/**
 * Préférences du panneau « Fichiers » de la Console (explorateur SFTP) : largeur,
 * visibilité et affichage des fichiers cachés. Persisté dans localStorage (par appareil),
 * jamais partagé — comme `useLayoutStore`, dont on reprend le stockage tolérant aux
 * échecs (navigation privée, tests…).
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const EXPLORER_MIN_WIDTH = 240;
export const EXPLORER_MAX_WIDTH = 640;
export const EXPLORER_DEFAULT_WIDTH = 340;

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

interface FileExplorerState {
  /** Panneau ouvert à côté du terminal actif */
  panelOpen: boolean;
  width: number;
  showHidden: boolean;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setWidth: (width: number) => void;
  setShowHidden: (show: boolean) => void;
}

export const useFileExplorerStore = create<FileExplorerState>()(
  persist(
    (set) => ({
      panelOpen: false,
      width: EXPLORER_DEFAULT_WIDTH,
      showHidden: false,
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setWidth: (width) => set({ width: Math.round(Math.min(EXPLORER_MAX_WIDTH, Math.max(EXPLORER_MIN_WIDTH, width))) }),
      setShowHidden: (showHidden) => set({ showHidden }),
    }),
    {
      name: "file-explorer-preferences",
      storage: createJSONStorage(safeStorage),
    }
  )
);
