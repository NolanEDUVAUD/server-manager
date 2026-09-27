/**
 * Raccourcis clavier : table unique, source de vérité à la fois pour le gestionnaire
 * clavier (`useShortcuts`, palette) et pour l'aide affichée avec « ? ».
 * Ajouter un raccourci ici suffit à le documenter ; les raccourcis de navigation
 * (`to`) sont même branchés automatiquement par la mise en page.
 * Descriptions et groupes sont des clés de traduction, résolues à l'affichage.
 */
import { t, TKey } from "../i18n";

/** global : n'importe où · page : page Serveurs · palette : champ de la palette */
export type ShortcutContext = "global" | "page" | "palette";

export interface ShortcutDef {
  id: string;
  /** Valeur(s) de KeyboardEvent.key : une touche, ou une séquence de deux touches (« g » puis « s ») */
  keys: readonly string[];
  /** Avec Ctrl (ou ⌘ sur macOS) */
  ctrl?: boolean;
  /** Avec Maj, en plus de Ctrl (Ctrl+Maj+L) */
  shift?: boolean;
  descriptionKey: TKey;
  groupKey: TKey;
  context: ShortcutContext;
  /** Actif aussi quand le focus est dans un champ de saisie */
  inInputs?: boolean;
  /** Page ouverte par un raccourci de navigation */
  to?: string;
}

export const SHORTCUTS = [
  // ── Existant avant la v0.3 : Ctrl+K, Échap et ↑ ↓ Entrée dans la palette ──
  { id: "palette", keys: ["k"], ctrl: true, descriptionKey: "shortcuts.desc.palette", groupKey: "shortcuts.groups.general", context: "global", inInputs: true },
  { id: "close", keys: ["Escape"], descriptionKey: "shortcuts.desc.close", groupKey: "shortcuts.groups.general", context: "global", inInputs: true },
  { id: "palette-next", keys: ["ArrowDown"], descriptionKey: "shortcuts.desc.paletteNext", groupKey: "shortcuts.groups.palette", context: "palette", inInputs: true },
  { id: "palette-prev", keys: ["ArrowUp"], descriptionKey: "shortcuts.desc.palettePrev", groupKey: "shortcuts.groups.palette", context: "palette", inInputs: true },
  { id: "palette-run", keys: ["Enter"], descriptionKey: "shortcuts.desc.paletteRun", groupKey: "shortcuts.groups.palette", context: "palette", inInputs: true },
  // ── Nouveaux ──
  { id: "lock", keys: ["l"], ctrl: true, shift: true, descriptionKey: "shortcuts.desc.lock", groupKey: "shortcuts.groups.general", context: "global", inInputs: true },
  { id: "help", keys: ["?"], descriptionKey: "shortcuts.desc.help", groupKey: "shortcuts.groups.general", context: "global" },
  { id: "search", keys: ["/"], descriptionKey: "shortcuts.desc.search", groupKey: "shortcuts.groups.pages", context: "page" },
  { id: "go-dashboard", keys: ["g", "d"], descriptionKey: "shortcuts.desc.goDashboard", groupKey: "shortcuts.groups.navigation", context: "global", to: "/" },
  { id: "go-servers", keys: ["g", "s"], descriptionKey: "shortcuts.desc.goServers", groupKey: "shortcuts.groups.navigation", context: "global", to: "/servers" },
  { id: "go-console", keys: ["g", "c"], descriptionKey: "shortcuts.desc.goConsole", groupKey: "shortcuts.groups.navigation", context: "global", to: "/console" },
  { id: "go-settings", keys: ["g", "p"], descriptionKey: "shortcuts.desc.goSettings", groupKey: "shortcuts.groups.navigation", context: "global", to: "/settings" },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

type NavShortcut = Extract<(typeof SHORTCUTS)[number], { to: string }>;

/** Raccourcis de navigation (« g » puis une lettre), branchés par la mise en page */
export const NAV_SHORTCUTS: readonly NavShortcut[] = SHORTCUTS.filter((s): s is NavShortcut => "to" in s);

/** Délai maximal entre les deux touches d'une séquence */
export const SEQUENCE_TIMEOUT_MS = 1500;

/** Touches dont le nom se traduit (« Échap » / « Esc ») */
const KEY_NAMES: Record<string, TKey> = {
  Escape: "shortcuts.keys.escape",
  Enter: "shortcuts.keys.enter",
};

/** Touches affichées par un symbole */
const KEY_SYMBOLS: Record<string, string> = {
  ArrowDown: "↓",
  ArrowUp: "↑",
};

/**
 * Touches à afficher : une entrée par touche successive, chacune pouvant être une
 * combinaison (ex. [["Ctrl", "K"]] ou [["g"], ["s"]] pour « g puis s »)
 */
export function shortcutKeys(def: ShortcutDef): string[][] {
  const label = (k: string) => (KEY_NAMES[k] ? t(KEY_NAMES[k]) : KEY_SYMBOLS[k] ?? (def.ctrl ? k.toUpperCase() : k));
  return def.ctrl
    ? [["Ctrl", ...(def.shift ? [t("shortcuts.keys.shift")] : []), ...def.keys.map(label)]]
    : def.keys.map((k) => [label(k)]);
}

/** Évènement clavier réduit à ce qui compte pour la correspondance */
export interface KeyInput {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
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
      (d) =>
        d.keys.length === 1 &&
        d.keys[0] === key &&
        !!d.ctrl === ctrl &&
        // Maj ne compte que pour les combinaisons Ctrl (« ? » se tape déjà avec Maj)
        (!d.ctrl || !!d.shift === !!input.shiftKey) &&
        !input.altKey &&
        (d.inInputs || !input.inEditable),
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
