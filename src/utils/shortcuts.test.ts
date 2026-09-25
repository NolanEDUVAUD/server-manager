import { describe, it, expect } from "vitest";
import { createShortcutMatcher, isEditableTarget, NAV_SHORTCUTS, SEQUENCE_TIMEOUT_MS, SHORTCUTS, ShortcutDef, ShortcutId, shortcutKeys } from "./shortcuts";

const ALL = SHORTCUTS.map((s) => s.id) as ShortcutId[];

/** Frappe les touches d'un raccourci telles que la table les décrit */
function press(match: ReturnType<typeof createShortcutMatcher>, def: ShortcutDef, t0 = 1000): ShortcutId | null {
  let result: ShortcutId | null = null;
  def.keys.forEach((key, i) => {
    result = match({ key, ctrlKey: !!def.ctrl, shiftKey: !!def.shift, inEditable: def.context === "palette" }, t0 + i * 100);
  });
  return result;
}

describe("table des raccourcis", () => {
  it("identifiants et combinaisons uniques par contexte, descriptions renseignées", () => {
    expect(new Set(ALL).size).toBe(ALL.length);
    const combos = SHORTCUTS.map((s) => `${s.context}:${"ctrl" in s ? "ctrl+" : ""}${"shift" in s ? "shift+" : ""}${s.keys.join(">")}`);
    expect(new Set(combos).size).toBe(combos.length);
    for (const s of SHORTCUTS) {
      expect(s.description.length).toBeGreaterThan(5);
      expect(s.keys.length).toBeGreaterThanOrEqual(1);
      expect(s.keys.length).toBeLessThanOrEqual(2);
    }
  });

  it("le gestionnaire clavier reconnaît chaque raccourci exactement comme la table le décrit", () => {
    for (const def of SHORTCUTS) {
      expect(press(createShortcutMatcher(ALL), def), def.id).toBe(def.id);
    }
  });

  it("les raccourcis existants sont conservés : Ctrl+K, Échap, flèches et Entrée dans la palette", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    for (const id of ["palette", "close", "palette-next", "palette-prev", "palette-run"]) expect(ids).toContain(id);
    const m = createShortcutMatcher(ALL);
    expect(m({ key: "K", ctrlKey: true })).toBe("palette");
    expect(m({ key: "k", metaKey: true })).toBe("palette");
    expect(m({ key: "k" })).toBeNull();
  });

  it("les raccourcis à une touche sont ignorés dans un champ de saisie, pas Ctrl+K ni Échap", () => {
    const m = createShortcutMatcher(ALL);
    expect(m({ key: "?", inEditable: true })).toBeNull();
    expect(m({ key: "/", inEditable: true })).toBeNull();
    expect(m({ key: "g", inEditable: true }, 0)).toBeNull();
    expect(m({ key: "s", inEditable: true }, 10)).toBeNull();
    expect(m({ key: "k", ctrlKey: true, inEditable: true })).toBe("palette");
    expect(m({ key: "Escape", inEditable: true })).toBe("close");
  });

  it("séquences : « g » puis « s » dans le délai ; trop lent ou autre touche = rien", () => {
    const m = createShortcutMatcher(ALL);
    expect(m({ key: "g" }, 0)).toBeNull();
    expect(m({ key: "s" }, 500)).toBe("go-servers");
    expect(m({ key: "g" }, 1000)).toBeNull();
    expect(m({ key: "s" }, 1000 + SEQUENCE_TIMEOUT_MS + 1)).toBeNull();
    expect(m({ key: "g" }, 5000)).toBeNull();
    expect(m({ key: "x" }, 5100)).toBeNull();
    expect(m({ key: "s" }, 5200)).toBeNull();
    // Une séquence interrompue n'empêche pas un raccourci simple
    expect(m({ key: "g" }, 6000)).toBeNull();
    expect(m({ key: "?" }, 6100)).toBe("help");
  });

  it("un composant ne reçoit que les raccourcis qu'il déclare", () => {
    const m = createShortcutMatcher(["search"]);
    expect(m({ key: "/" })).toBe("search");
    expect(m({ key: "?" })).toBeNull();
    expect(m({ key: "k", ctrlKey: true })).toBeNull();
  });

  it("navigation : chaque raccourci « g » mène à une page", () => {
    expect(NAV_SHORTCUTS.map((s) => s.to)).toEqual(["/", "/servers", "/services", "/console", "/settings"]);
    expect(NAV_SHORTCUTS.every((s) => s.keys[0] === "g")).toBe(true);
  });

  it("libellés affichés dans l'aide", () => {
    const byId = (id: string) => SHORTCUTS.find((s) => s.id === id)! as ShortcutDef;
    expect(shortcutKeys(byId("palette"))).toEqual([["Ctrl", "K"]]);
    expect(shortcutKeys(byId("go-servers"))).toEqual([["g"], ["s"]]);
    expect(shortcutKeys(byId("close"))).toEqual([["Échap"]]);
    expect(shortcutKeys(byId("palette-next"))).toEqual([["↓"]]);
  });

  it("champs de saisie reconnus", () => {
    const input = document.createElement("input");
    const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
