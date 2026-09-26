import { describe, it, expect } from "vitest";
import { eulaText, EULA_VERSION } from "./eula";

describe("EULA", () => {
  it("est rédigée en anglais et interdit la monétisation sans accord écrit préalable", () => {
    expect(eulaText).toContain("END-USER LICENSE AGREEMENT");
    expect(eulaText).toContain("MONETIZATION RESTRICTIONS");
    expect(eulaText).toContain("strictly prohibited without the prior written agreement");
    expect(eulaText).toContain("must contact the Author");
    expect(eulaText).toContain("LIMITATION OF LIABILITY");
    expect(eulaText).toContain("ACCEPTANCE");
  });

  it("est anonyme : aucun nom de personne, aucune adresse menant à un compte", () => {
    // Le nom du développeur apparaît dans l'adresse du dépôt : aucune URL n'est permise
    expect(eulaText).not.toMatch(/nolan|eduvaud/i);
    expect(eulaText).not.toMatch(/https?:\/\//i);
    expect(eulaText).not.toMatch(/github\.com|@/i);
  });

  it("ne contient que de l'ASCII (page de licence de l'installateur)", () => {
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(eulaText)).toBe(true);
  });

  it("a une version semver", () => {
    expect(EULA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
