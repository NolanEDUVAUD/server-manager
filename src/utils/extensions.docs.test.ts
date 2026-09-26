// Vérifie que l'exemple de manifeste documenté dans docs/extensions.md
// (docs/examples/homelab-extras/manifest.json, repris tel quel dans le
// Markdown) reste valide au regard du schéma réel. Si ce test casse, c'est
// que le schéma a changé sans que la documentation ne soit mise à jour.
import { describe, expect, it } from "vitest";
import { parseAndValidateManifest } from "./extensions";
import example from "../../docs/examples/homelab-extras/manifest.json";

describe("exemple de manifeste documenté (docs/extensions.md)", () => {
  it("le fichier docs/examples/homelab-extras/manifest.json passe validateManifest", () => {
    const raw = JSON.stringify(example);
    const result = parseAndValidateManifest(raw);
    if (!result.ok) {
      throw new Error(`Manifeste d'exemple invalide :\n${result.errors.join("\n")}`);
    }
    expect(result.ok).toBe(true);
    expect(result.manifest.id).toBe("io.github.alice.homelab-extras");
    expect(result.manifest.contributes?.snippets).toHaveLength(2);
    expect(result.manifest.contributes?.themes).toHaveLength(1);
    expect(result.manifest.contributes?.webLinks).toHaveLength(1);
  });
});
