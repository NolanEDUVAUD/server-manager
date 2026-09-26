import { useCallback } from "react";
import { useDraftStore } from "../stores/useDraftStore";

interface Options {
  /**
   * Recopie aussi la valeur dans sessionStorage : elle survit alors à un rechargement
   * complet de la page, pas seulement à un changement d'onglet/page interne.
   * À NE JAMAIS activer pour un champ contenant un secret (mot de passe, jeton…) —
   * dans ce cas on garde le comportement par défaut (mémoire seule, jamais écrit sur
   * le disque).
   */
  session?: boolean;
}

function readSession<T>(key: string): T | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : undefined;
  } catch {
    // navigation privée, quota dépassé, storage désactivé… : on continue sans
    return undefined;
  }
}

function writeSession<T>(key: string, value: T) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // idem : la persistance en mémoire (le store zustand) suffit à assurer le comportement attendu
  }
}

/**
 * Comme `useState`, mais la valeur n'est pas perdue quand le composant est démonté —
 * en particulier lors d'une navigation react-router vers une autre page puis retour.
 * La valeur vit dans `useDraftStore`, un store zustand partagé (un singleton du module,
 * donc conservé tant que l'application tourne), le temps de la session.
 *
 * `key` doit être unique pour ce champ dans toute l'appli (ex. "logs.query",
 * "batch.script") : deux composants qui partagent la même clé partagent aussi l'état.
 */
export function usePersistentState<T>(key: string, initial: T, options: Options = {}): [T, (updater: T | ((prev: T) => T)) => void] {
  const stored = useDraftStore((s) => s.drafts[key] as T | undefined);
  const setDraft = useDraftStore((s) => s.setDraft);

  const value = stored !== undefined ? stored : options.session ? readSession<T>(key) ?? initial : initial;

  const setValue = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const next = typeof updater === "function" ? (updater as (prev: T) => T)(value) : updater;
      setDraft(key, next);
      if (options.session) writeSession(key, next);
    },
    // `value` est volontairement dans les dépendances : un appel avec une fonction de
    // mise à jour doit toujours partir de la dernière valeur affichée, jamais d'une
    // valeur capturée au premier rendu.
    [key, setDraft, value, options.session]
  );

  return [value, setValue];
}
