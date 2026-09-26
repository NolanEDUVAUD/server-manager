import { create } from "zustand";

/**
 * État du tour de présentation interactif.
 * `onlyIds` restreint le tour à un sous-ensemble d'étapes (voir src/utils/tour.ts) :
 * utilisé par « Quoi de neuf ? » pour ne rejouer que les nouveautés d'une version.
 * `open()` sans argument relance le tour complet (ex. « Revoir le tutoriel »).
 */
interface TourStore {
  isOpen: boolean;
  onlyIds: string[] | null;
  open: (onlyIds?: string[]) => void;
  close: () => void;
}

export const useTourStore = create<TourStore>((set) => ({
  isOpen: false,
  onlyIds: null,
  open: (onlyIds) => set({ isOpen: true, onlyIds: onlyIds && onlyIds.length > 0 ? onlyIds : null }),
  close: () => set({ isOpen: false, onlyIds: null }),
}));
