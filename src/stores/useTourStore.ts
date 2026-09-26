import { create } from "zustand";

/** État du tour de présentation au premier lancement */
interface TourStore {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useTourStore = create<TourStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
