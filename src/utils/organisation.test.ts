import { describe, it, expect } from "vitest";
import { checkCustomFields, isValidColor, looksSensitive, MAX_CUSTOM_FIELDS, nameError, readableTextColor } from "./organisation";

describe("organisation — validation miroir", () => {
  it("couleurs #rrggbb", () => {
    expect(isValidColor("#3b82f6")).toBe(true);
    expect(isValidColor("#3B82F6")).toBe(true);
    for (const bad of ["", "#3b82f", "3b82f6", "#gggggg", "#3b82f6ff", "red"]) expect(isValidColor(bad)).toBe(false);
  });

  it("texte lisible sur la couleur du tag", () => {
    expect(readableTextColor("#ffffff")).toBe("#000000");
    expect(readableTextColor("#eab308")).toBe("#000000");
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#1e3a8a")).toBe("#ffffff");
    expect(readableTextColor("invalide")).toBe("#ffffff");
  });

  it("noms : requis, longueur en caractères, uniques sans casse (hors soi-même)", () => {
    const existing = [{ id: "a", name: "Prod" }];
    expect(nameError("  ", 32, existing)).toBe("Nom requis");
    expect(nameError("é".repeat(32), 32, existing)).toBeNull();
    expect(nameError("é".repeat(33), 32, existing)).toContain("32");
    expect(nameError("PROD", 32, existing)).toBe("Ce nom existe déjà");
    expect(nameError("PROD", 32, existing, "a")).toBeNull();
  });

  it("champs personnalisés : clé requise, longueurs, doublons, nombre ; lignes vides ignorées", () => {
    const check = checkCustomFields([
      { key: "Emplacement", value: "Baie 2" },
      { key: "", value: "" },
      { key: "", value: "sans clé" },
      { key: "k".repeat(41), value: "" },
      { key: "série", value: "v".repeat(501) },
      { key: "EMPLACEMENT", value: "doublon" },
    ]);
    expect(check.rows).toEqual([null, null, "Clé requise", "Clé : 40 caractères au plus", "Valeur : 500 caractères au plus", "Clé en double"]);
    expect(check.global).toBeNull();
    const many = Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({ key: `k${i}`, value: "v" }));
    expect(checkCustomFields(many).global).toContain("20");
    expect(checkCustomFields(many.slice(0, MAX_CUSTOM_FIELDS)).global).toBeNull();
  });

  it("repère les clés qui ressemblent à un secret", () => {
    for (const k of ["password", "Mot de passe", "MDP", "api_key", "API-Key", "Token", "jeton d'accès", "Secret", "Clé d’API", "clé privée", "Pass", "SSH key"]) {
      expect(looksSensitive(k), k).toBe(true);
    }
    for (const k of ["Emplacement", "Numéro de série", "Passerelle", "Utilisateur", "Garantie"]) {
      expect(looksSensitive(k), k).toBe(false);
    }
  });
});
