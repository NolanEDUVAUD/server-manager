import { describe, it, expect } from "vitest";
import { fuzzyFilter, fuzzyScore, fold } from "./fuzzy";

const items = ["Réveiller Workstation 2 (.56)", "Console sur minipc", "Aller à Réseau", "Aller à Ressources", "Ping truenas"];

describe("recherche approximative", () => {
  it("ignore accents et casse", () => {
    expect(fold("Réseau")).toBe("reseau");
    expect(fuzzyFilter(items, "reseau", (x) => x)).toEqual(["Aller à Réseau"]);
  });

  it("combine plusieurs mots et abréviations", () => {
    expect(fuzzyFilter(items, "rev work", (x) => x)).toEqual(["Réveiller Workstation 2 (.56)"]);
    expect(fuzzyFilter(items, "cons mini", (x) => x)).toEqual(["Console sur minipc"]);
  });

  it("classe les débuts de mot avant les sous-séquences", () => {
    expect(fuzzyScore("res", "Aller à Ressources")!).toBeLessThan(fuzzyScore("rsc", "Aller à Ressources")!);
  });

  it("renvoie null sans correspondance et tout pour une requête vide", () => {
    expect(fuzzyScore("zzz", "minipc")).toBeNull();
    expect(fuzzyFilter(items, "  ", (x) => x)).toHaveLength(5);
  });
});
