import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES, relativeLuminance, titleBarColors } from "./theme";

describe("barre de titre aux couleurs du thème", () => {
  it("calcule la luminance", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("rgb(0,0,0)")).toBeNull();
  });

  it("donne une couleur de fond, de texte et un mode pour chaque thème intégré", () => {
    for (const theme of BUILTIN_THEMES) {
      const colors = titleBarColors(theme);
      expect(colors, theme.id).not.toBeNull();
      expect(colors!.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors!.text).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("détecte un thème clair", () => {
    const light = { ...BUILTIN_THEMES[0], colors: { ...BUILTIN_THEMES[0].colors, "--bg-secondary": "#f3f3f3", "--text-primary": "#1a1a1a" } };
    expect(titleBarColors(light)!.dark).toBe(false);
    expect(titleBarColors(BUILTIN_THEMES[0])!.dark).toBe(true);
  });
});
