/**
 * Raccourcis clavier : table unique, source de vérité à la fois pour le gestionnaire
 * clavier (`useShortcuts`, palette) et pour l'aide affichée avec « ? ».
 * Ajouter un raccourci ici suffit à le documenter ; les raccourcis de navigation
 * (`to`) sont même branchés automatiquement par la mise en page.
 */

/** global : n'importe où · page : pages Serveurs et Services · palette : champ de la palette */
export type ShortcutContext = "global" | "page" | "palette";

export interface ShortcutDef {
  id: string;
  /** Valeur(s) de KeyboardEvent.key : une touche, ou une séquence de deux touches (« g » puis « s ») */
  keys: readonly string[];
  /** Avec Ctrl (ou ⌘ sur macOS) */
  ctrl?: boolean;
  description: string;
  group: string;
  context: ShortcutContext;
  /** Actif aussi quand le focus est dans un champ de saisie */
  inInputs?: boolean;
  /** Page ouverte par un raccourci de navigation */
  to?: string;
}

export const SHORTCUTS = [
  // ── Existant avant la v0.3 : Ctrl+K, Échap et ↑ ↓ Entrée dans la palette ──
  { id: "palette", keys: ["k"], ctrl: true, description: "Ouvrir ou fermer la palette de commandes", group: "Général", context: "global", inInputs: true },
  { id: "close", keys: ["Escape"], description: "Fermer la palette, l'aide ou la demande de confirmation", group: "Général", context: "global", inInputs: true },
  { id: "palette-next", keys: ["ArrowDown"], description: "Résultat suivant", group: "Palette de commandes", context: "palette", inInputs: true },
  { id: "palette-prev", keys: ["ArrowUp"], description: "Résultat précédent", group: "Palette de commandes", context: "palette", inInputs: true },
  { id: "palette-run", keys: ["Enter"], description: "Exécuter l'action choisie (les actions sur un serveur demandent confirmation)", group: "Palette de commandes", context: "palette", inInputs: true },
  // ── Nouveaux ──
  { id: "help", keys: ["?"], description: "Afficher cette aide", group: "Général", context: "global" },
  { id: "search", keys: ["/"], description: "Aller à la recherche (pages Serveurs et Services)", group: "Pages Serveurs et Services", context: "page" },
  { id: "go-dashboard", keys: ["g", "d"], description: "Aller au tableau de bord", group: "Navigation", context: "global", to: "/" },
  { id: "go-servers", keys: ["g", "s"], description: "Aller aux serveurs", group: "Navigation", context: "global", to: "/servers" },
  { id: "go-services", keys: ["g", "v"], description: "Aller aux services", group: "Navigation", context: "global", to: "/services" },
  { id: "go-console", keys: ["g", "c"], description: "Aller à la console SSH", group: "Navigation", context: "global", to: "/console" },
  { id: "go-settings", keys: ["g", "p"], description: "Aller aux paramètres", group: "Navigation", context: "global", to: "/settings" },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

type NavShortcut = Extract<(typeof SHORTCUTS)[number], { to: string }>;

/** Raccourcis de navigation (« g » puis une lettre), branchés par la mise en page */
export const NAV_SHORTCUTS: readonly NavShortcut[] = SHORTCUTS.filter((s): s is NavShortcut => "to" in s);

/** Délai maximal entre les deux touches d'une séquence */
export const SEQUENCE_TIMEOUT_MS = 1500;

const KEY_LABELS: Record<string, string> = {
  Escape: "Échap",
  ArrowDown: "↓",
  ArrowUp: "↑",
  Enter: "Entrée",
};

/**
 * Touches à afficher : une entrée par touche successive, chacune pouvant être une
 * combinaison (ex. [["Ctrl", "K"]] ou [["g"], ["s"]] pour « g puis s »)
 */
export function shortcutKeys(def: ShortcutDef): string[][] {
  const label = (k: string) => KEY_LABELS[k] ?? (def.ctrl ? k.toUpperCase() : k);
  return def.ctrl ? [["Ctrl", ...def.keys.map(label)]] : def.keys.map((k) => [label(k)]);
}

/** Évènement clavier réduit à ce qui compte pour la correspondance */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /** Le focus est dans un champ de saisie (input, textarea, select, contenu éditable) */
  inEditable?: boolean;
}

/**
 * Gestionnaire pur : renvoie l'identifiant du raccourci reconnu (ou null) parmi `ids`.
 * Garde en mémoire la première touche d'une séquence pendant `timeoutMs`.
 */
export function createShortcutMatcher(ids: readonly ShortcutId[], timeoutMs = SEQUENCE_TIMEOUT_MS) {
  const defs: readonly ShortcutDef[] = SHORTCUTS.filter((s) => ids.includes(s.id));
  let pending: { key: string; at: number } | null = null;

  return function match(input: KeyInput, now = Date.now()): ShortcutId | null {
    const ctrl = !!(input.ctrlKey || input.metaKey);
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    const plain = !ctrl && !input.altKey && !input.inEditable;

    // Deuxième touche d'une séquence
    const first = pending && now - pending.at <= timeoutMs ? pending.key : null;
    pending = null;
    if (first && plain) {
      const seq = defs.find((d) => d.keys.length === 2 && d.keys[0] === first && d.keys[1] === key);
      if (seq) return seq.id as ShortcutId;
    }

    const single = defs.find(
      (d) => d.keys.length === 1 && d.keys[0] === key && !!d.ctrl === ctrl && !input.altKey && (d.inInputs || !input.inEditable),
    );
    if (single) return single.id as ShortcutId;

    // Première touche d'une séquence : on attend la suivante
    if (plain && defs.some((d) => d.keys.length === 2 && d.keys[0] === key)) {
      pending = { key, at: now };
    }
    return null;
  };
}

/** Cible d'un évènement clavier dans laquelle on tape du texte (les raccourcis à une touche y sont ignorés) */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color"].includes(target.type);
  }
  return false;
}
