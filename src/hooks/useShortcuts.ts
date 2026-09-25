import { useEffect, useRef } from "react";
import { createShortcutMatcher, isEditableTarget, ShortcutId } from "../utils/shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/**
 * Branche des raccourcis de la table (utils/shortcuts.ts) sur la fenêtre, tant que
 * `enabled` est vrai. Chaque composant ne déclare que les raccourcis qu'il gère.
 */
export function useShortcuts(handlers: ShortcutHandlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  // Les gestionnaires changent à chaque rendu : seul l'ensemble des identifiants relance l'écoute
  const ids = Object.keys(handlers).sort().join(",");

  useEffect(() => {
    if (!enabled || !ids) return;
    const match = createShortcutMatcher(ids.split(",") as ShortcutId[]);
    function onKey(e: KeyboardEvent) {
      if (e.isComposing) return;
      const id = match({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, inEditable: isEditableTarget(e.target) });
      const handler = id ? ref.current[id] : undefined;
      if (handler) {
        e.preventDefault();
        handler();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, enabled]);
}
