import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { usePersistentState } from "./usePersistentState";
import { useDraftStore } from "../stores/useDraftStore";

describe("usePersistentState", () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {} });
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it("démarre avec la valeur initiale quand rien n'est encore stocké", () => {
    const { result } = renderHook(() => usePersistentState("k1", "hello"));
    expect(result.current[0]).toBe("hello");
  });

  it("survit à un démontage puis remontage du composant (équivalent d'une navigation)", () => {
    const hook1 = renderHook(() => usePersistentState("k2", ""));
    act(() => hook1.result.current[1]("texte tapé par l'utilisateur"));
    expect(hook1.result.current[0]).toBe("texte tapé par l'utilisateur");
    hook1.unmount();

    // Un nouveau composant qui utilise la même clé retrouve la valeur : le store
    // zustand qui la porte n'a pas été affecté par le démontage.
    const hook2 = renderHook(() => usePersistentState("k2", ""));
    expect(hook2.result.current[0]).toBe("texte tapé par l'utilisateur");
  });

  it("deux clés différentes n'interfèrent pas entre elles", () => {
    const a = renderHook(() => usePersistentState("a", "init-a"));
    const b = renderHook(() => usePersistentState("b", "init-b"));
    act(() => a.result.current[1]("changé"));
    expect(a.result.current[0]).toBe("changé");
    expect(b.result.current[0]).toBe("init-b");
  });

  it("accepte une fonction de mise à jour basée sur la valeur précédente", () => {
    const { result } = renderHook(() => usePersistentState("counter", 0));
    act(() => result.current[1]((prev) => prev + 1));
    act(() => result.current[1]((prev) => prev + 1));
    expect(result.current[0]).toBe(2);
  });

  it("avec session: true, la valeur est relisible depuis sessionStorage même après réinitialisation du store", () => {
    const hook1 = renderHook(() => usePersistentState("sess", "", { session: true }));
    act(() => hook1.result.current[1]("valeur persistée"));
    hook1.unmount();

    // Simule un rechargement complet de page : le store en mémoire est vidé,
    // seul sessionStorage garde la trace.
    useDraftStore.setState({ drafts: {} });

    const hook2 = renderHook(() => usePersistentState("sess", "", { session: true }));
    expect(hook2.result.current[0]).toBe("valeur persistée");
  });

  it("sans session: true, la valeur ne survit pas à une réinitialisation du store (comportement mémoire seule pour les secrets)", () => {
    const hook1 = renderHook(() => usePersistentState("secret", ""));
    act(() => hook1.result.current[1]("mot-de-passe"));
    hook1.unmount();

    useDraftStore.setState({ drafts: {} });

    const hook2 = renderHook(() => usePersistentState("secret", ""));
    expect(hook2.result.current[0]).toBe("");
  });
});
