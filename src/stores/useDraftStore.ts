import { create } from "zustand";

/// Petit dépôt en mémoire pour les brouillons de saisie (recherches, formulaires en
/// cours…) qui doivent survivre à un changement de page. React-router démonte les
/// pages à la navigation, donc un `useState` local y perd tout ce qui a été tapé ;
/// ce store zustand, lui, est un singleton du module et reste vivant tant que
/// l'application tourne. Utilisé via le hook `usePersistentState`.
interface DraftState {
  drafts: Record<string, unknown>;
  setDraft: (key: string, value: unknown) => void;
  clearDraft: (key: string) => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},
  setDraft: (key, value) => set((s) => ({ drafts: { ...s.drafts, [key]: value } })),
  clearDraft: (key) =>
    set((s) => {
      if (!(key in s.drafts)) return s;
      const drafts = { ...s.drafts };
      delete drafts[key];
      return { drafts };
    }),
}));
