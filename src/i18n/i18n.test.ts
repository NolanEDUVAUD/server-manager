import { describe, it, expect, afterEach } from "vitest";
import { fr } from "./fr";
import { en } from "./en";
import { translate, t, setLanguage, currentLang, isLang, localeOf, TKey } from ".";

type Node = string | { [k: string]: Node };

/** Toutes les feuilles « chemin → texte » d'un dictionnaire (pluriels compris : chemin.one / chemin.other) */
function leaves(node: Node, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node === "string") {
    out.set(prefix, node);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    for (const [p, text] of leaves(v, prefix ? `${prefix}.${k}` : k)) out.set(p, text);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionnaires", () => {
  const frLeaves = leaves(fr as unknown as Node);
  const enLeaves = leaves(en as unknown as Node);

  it("chaque clé existe dans toutes les langues", () => {
    const missingInEn = [...frLeaves.keys()].filter((k) => !enLeaves.has(k));
    const missingInFr = [...enLeaves.keys()].filter((k) => !frLeaves.has(k));
    expect(missingInEn, "clés absentes de en/").toEqual([]);
    expect(missingInFr, "clés absentes de fr/").toEqual([]);
  });

  it("aucune traduction n'est vide", () => {
    const empty = [...frLeaves, ...enLeaves].filter(([, text]) => text.trim() === "").map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("les variables {nom} sont les mêmes dans chaque langue", () => {
    const mismatched = [...frLeaves.keys()].filter(
      (k) => enLeaves.has(k) && placeholders(frLeaves.get(k)!).join() !== placeholders(enLeaves.get(k)!).join()
    );
    expect(mismatched).toEqual([]);
  });

  it("chaque pluriel a une forme « other »", () => {
    const orphans = [...frLeaves.keys()].filter((k) => k.endsWith(".one") && !frLeaves.has(k.replace(/\.one$/, ".other")));
    expect(orphans).toEqual([]);
  });
});

describe("traduction", () => {
  afterEach(() => setLanguage("fr"));

  it("remplace les variables et garde celles qui manquent", () => {
    expect(translate("fr", "common.errorPrefix", { message: "délai dépassé" })).toBe("Erreur : délai dépassé");
    expect(translate("en", "common.errorPrefix")).toBe("Error: {message}");
  });

  it("choisit la forme plurielle selon la langue", () => {
    expect(translate("fr", "common.servers", { count: 1 })).toBe("1 serveur");
    expect(translate("fr", "common.servers", { count: 0 })).toBe("0 serveur");
    expect(translate("fr", "common.servers", { count: 3 })).toBe("3 serveurs");
    expect(translate("en", "common.servers", { count: 0 })).toBe("0 servers");
    expect(translate("en", "common.servers", { count: 1 })).toBe("1 server");
  });

  it("renvoie la clé si elle n'existe pas (au lieu de planter)", () => {
    expect(translate("en", "absent.cle" as TKey)).toBe("absent.cle");
  });

  it("suit la langue active et retombe sur le français pour une valeur inconnue", () => {
    setLanguage("en");
    expect(currentLang()).toBe("en");
    expect(t("common.cancel")).toBe("Cancel");
    expect(document.documentElement.lang).toBe("en");
    setLanguage("de");
    expect(currentLang()).toBe("fr");
    expect(t("common.cancel")).toBe("Annuler");
  });

  it("locales Intl", () => {
    expect(isLang("en") && !isLang("EN")).toBe(true);
    expect(localeOf("fr")).toBe("fr-FR");
    expect(localeOf("en")).toBe("en-GB");
  });
});
