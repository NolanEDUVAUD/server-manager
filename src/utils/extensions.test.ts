import { describe, expect, it } from "vitest";
import {
  contributionCount,
  extensionThemesOnly,
  InstalledExtension,
  isExtensionId,
  mergeSnippets,
  mergeThemes,
  mergeWebLinks,
  namespacedId,
  parseAndValidateManifest,
  validateManifest,
} from "./extensions";
import { BUILTIN_THEMES } from "./theme";

function baseManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: "com.example.demo",
    name: "Démo",
    version: "1.0.0",
    author: "Quelqu'un",
    description: "Une extension de démonstration",
    ...overrides,
  };
}

describe("validateManifest — champs obligatoires", () => {
  it("accepte un manifeste minimal valide", () => {
    const result = validateManifest(baseManifest());
    expect(result.ok).toBe(true);
  });

  it("rejette une valeur qui n'est pas un objet", () => {
    expect(validateManifest("pas un objet").ok).toBe(false);
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest([1, 2]).ok).toBe(false);
  });

  it("rejette une clé inconnue à la racine", () => {
    const result = validateManifest(baseManifest({ evil: "eval('x')" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes("evil"))).toBe(true);
  });

  it.each([
    ["id", "COM.Example.Demo"],
    ["id", ""],
    ["id", "a".repeat(200)],
    ["version", "1.0"],
    ["version", "v1.0.0"],
    ["name", ""],
    ["author", ""],
    ["description", ""],
  ])("rejette un champ %s invalide (%s)", (field, value) => {
    const result = validateManifest(baseManifest({ [field]: value }));
    expect(result.ok).toBe(false);
  });

  it("accepte des id reverse-dns avec tirets et points multiples", () => {
    expect(validateManifest(baseManifest({ id: "io.github.user.my-extension" })).ok).toBe(true);
  });

  it("accepte une homepage https et rejette http", () => {
    expect(validateManifest(baseManifest({ homepage: "https://example.com" })).ok).toBe(true);
    const result = validateManifest(baseManifest({ homepage: "http://example.com" }));
    expect(result.ok).toBe(false);
  });

  it("valide minAppVersion en semver", () => {
    expect(validateManifest(baseManifest({ minAppVersion: "0.3.0" })).ok).toBe(true);
    expect(validateManifest(baseManifest({ minAppVersion: "0.3" })).ok).toBe(false);
  });
});

describe("validateManifest — contributes.snippets", () => {
  it("accepte des snippets valides", () => {
    const result = validateManifest(baseManifest({
      contributes: { snippets: [{ name: "Uptime", command: "uptime" }, { name: "Disk", command: "df -h", description: "Espace disque" }] },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.contributes?.snippets).toHaveLength(2);
  });

  it("rejette un snippet multi-lignes", () => {
    const result = validateManifest(baseManifest({ contributes: { snippets: [{ name: "x", command: "a\nb" }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette un snippet sans commande", () => {
    const result = validateManifest(baseManifest({ contributes: { snippets: [{ name: "x" }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette une clé inconnue dans un snippet", () => {
    const result = validateManifest(baseManifest({ contributes: { snippets: [{ name: "x", command: "y", script: "evil" }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette plus de 50 snippets", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `s${i}`, command: `echo ${i}` }));
    const result = validateManifest(baseManifest({ contributes: { snippets: many } }));
    expect(result.ok).toBe(false);
  });

  it("rejette contributes.snippets qui n'est pas une liste", () => {
    const result = validateManifest(baseManifest({ contributes: { snippets: "echo hi" } }));
    expect(result.ok).toBe(false);
  });
});

describe("validateManifest — contributes.themes", () => {
  it("accepte un thème valide", () => {
    const result = validateManifest(baseManifest({
      contributes: { themes: [{ id: "demo-theme", name: "Démo", colors: { "--bg-primary": "#111111" } }] },
    }));
    expect(result.ok).toBe(true);
  });

  it("rejette un thème sans couleurs", () => {
    const result = validateManifest(baseManifest({ contributes: { themes: [{ id: "x", name: "X", colors: {} }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette un id de thème avec majuscules", () => {
    const result = validateManifest(baseManifest({ contributes: { themes: [{ id: "Demo", name: "X", colors: { a: "#fff" } }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette une valeur de couleur non-string", () => {
    const result = validateManifest(baseManifest({ contributes: { themes: [{ id: "x", name: "X", colors: { a: 123 } }] } }));
    expect(result.ok).toBe(false);
  });
});

describe("validateManifest — contributes.webLinks", () => {
  it("accepte un lien https", () => {
    const result = validateManifest(baseManifest({ contributes: { webLinks: [{ name: "Documentation", url: "https://example.com/docs" }] } }));
    expect(result.ok).toBe(true);
  });

  it("rejette un lien http (non chiffré)", () => {
    const result = validateManifest(baseManifest({ contributes: { webLinks: [{ name: "Documentation", url: "http://example.com" }] } }));
    expect(result.ok).toBe(false);
  });

  it("rejette javascript: comme URL", () => {
    const result = validateManifest(baseManifest({ contributes: { webLinks: [{ name: "x", url: "javascript:alert(1)" }] } }));
    expect(result.ok).toBe(false);
  });
});

describe("validateManifest — clé inconnue dans contributes", () => {
  it("rejette une clé contributes inconnue (ex. « scripts »)", () => {
    const result = validateManifest(baseManifest({ contributes: { scripts: ["evil.js"] } }));
    expect(result.ok).toBe(false);
  });
});

describe("parseAndValidateManifest", () => {
  it("rejette un JSON malformé", () => {
    const result = parseAndValidateManifest("{ not json");
    expect(result.ok).toBe(false);
  });

  it("valide un JSON bien formé", () => {
    const result = parseAndValidateManifest(JSON.stringify(baseManifest()));
    expect(result.ok).toBe(true);
  });
});

describe("namespacedId / isExtensionId", () => {
  it("préfixe systématiquement par ext:<id>:", () => {
    expect(namespacedId("com.example.demo", "uptime")).toBe("ext:com.example.demo:uptime");
  });

  it("reconnaît un id d'extension", () => {
    expect(isExtensionId("ext:com.example.demo:uptime")).toBe(true);
    expect(isExtensionId("uptime")).toBe(false);
  });
});

function installed(manifestOverrides: Record<string, unknown>, enabled = true): InstalledExtension {
  const result = validateManifest(baseManifest(manifestOverrides));
  if (!result.ok) throw new Error("manifeste de test invalide : " + result.errors.join(", "));
  return { manifest: result.manifest, enabled };
}

describe("fusion des contributions", () => {
  it("mergeSnippets ajoute les snippets namespacés des extensions activées", () => {
    const ext = installed({ contributes: { snippets: [{ name: "Uptime", command: "uptime" }] } });
    const merged = mergeSnippets([{ id: "native-1", name: "Natif", command: "ls" }], [ext]);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("ext:com.example.demo:Uptime");
  });

  it("mergeSnippets ignore les extensions désactivées", () => {
    const ext = installed({ contributes: { snippets: [{ name: "Uptime", command: "uptime" }] } }, false);
    const merged = mergeSnippets([], [ext]);
    expect(merged).toHaveLength(0);
  });

  it("mergeThemes garde les builtins et ajoute les thèmes namespacés", () => {
    const ext = installed({ contributes: { themes: [{ id: "demo", name: "Démo", colors: { "--bg-primary": "#000" } }] } });
    const merged = mergeThemes([ext]);
    expect(merged.length).toBe(BUILTIN_THEMES.length + 1);
    expect(merged[merged.length - 1].id).toBe("ext:com.example.demo:demo");
  });

  it("extensionThemesOnly ne retourne que les thèmes d'extension", () => {
    const ext = installed({ contributes: { themes: [{ id: "demo", name: "Démo", colors: { "--bg-primary": "#000" } }] } });
    expect(extensionThemesOnly([ext])).toHaveLength(1);
    expect(extensionThemesOnly([])).toHaveLength(0);
  });

  it("mergeWebLinks associe chaque lien à son extension", () => {
    const ext = installed({ contributes: { webLinks: [{ name: "Docs", url: "https://example.com/docs" }] } });
    const links = mergeWebLinks([ext]);
    expect(links).toEqual([{ name: "Docs", url: "https://example.com/docs", extensionId: "com.example.demo", extensionName: "Démo" }]);
  });

  it("contributionCount compte toutes les contributions", () => {
    const ext = installed({
      contributes: {
        snippets: [{ name: "a", command: "a" }],
        themes: [{ id: "t", name: "T", colors: { a: "#fff" } }],
        webLinks: [{ name: "l", url: "https://x.test" }],
      },
    });
    expect(contributionCount(ext.manifest)).toBe(3);
    expect(contributionCount(installed({}).manifest)).toBe(0);
  });
});
