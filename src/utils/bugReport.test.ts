import { describe, it, expect } from "vitest";
import {
  BugReportInput,
  MAX_BODY_CHARS,
  buildBugReportBody,
  buildBugReportIssueUrl,
  buildBugReportText,
  truncateReportBody,
} from "./bugReport";

function report(extra: Partial<BugReportInput> = {}): BugReportInput {
  return {
    title: "Le ping échoue après veille",
    description: "Après la veille de Windows, le ping ne reprend pas.",
    stepsToReproduce: "1. Mettre le PC en veille\n2. Réveiller\n3. Observer le statut",
    expected: "Le serveur repasse en ligne",
    actual: "Le serveur reste marqué hors-ligne",
    ...extra,
  };
}

describe("buildBugReportBody", () => {
  it("assemble les sections renseignées", () => {
    const body = buildBugReportBody(report());
    expect(body).toContain("### Description");
    expect(body).toContain("Après la veille de Windows");
    expect(body).toContain("### Étapes pour reproduire");
    expect(body).toContain("### Comportement attendu");
    expect(body).toContain("### Comportement observé");
    expect(body).not.toContain("Informations système");
  });

  it("omet les sections vides", () => {
    const body = buildBugReportBody(report({ stepsToReproduce: "", expected: "  " }));
    expect(body).not.toContain("Étapes pour reproduire");
    expect(body).not.toContain("Comportement attendu");
  });

  it("répond un texte de repli si tout est vide", () => {
    const body = buildBugReportBody(report({ description: "", stepsToReproduce: "", expected: "", actual: "" }));
    expect(body).toBe("(aucune description fournie)");
  });

  it("inclut les informations système seulement si fournies, jamais d'IP/hôte/identifiants", () => {
    const withInfo = buildBugReportBody(
      report({
        systemInfo: { appVersion: "0.3.0", platform: "Win32", language: "fr", enabledModules: ["power", "docker"] },
      })
    );
    expect(withInfo).toContain("### Informations système");
    expect(withInfo).toContain("Version de l'application : 0.3.0");
    expect(withInfo).toContain("Plateforme : Win32");
    expect(withInfo).toContain("Langue : fr");
    expect(withInfo).toContain("Modules activés : power, docker");

    const withoutInfo = buildBugReportBody(report({ systemInfo: null }));
    expect(withoutInfo).not.toContain("Informations système");
  });

  it("n'affiche jamais aucune donnée serveur : le type ne le permet même pas", () => {
    // Le formulaire ne collecte jamais IP, identifiants, clés ou noms d'hôte : `BugReportSystemInfo`
    // ne porte que appVersion/platform/language/enabledModules, ce test documente l'intention.
    const body = buildBugReportBody(
      report({ systemInfo: { appVersion: "0.3.0", platform: "Win32", language: "fr", enabledModules: [] } })
    );
    expect(body).toContain("Modules activés : —");
  });
});

describe("truncateReportBody", () => {
  it("laisse un texte court intact", () => {
    expect(truncateReportBody("court")).toBe("court");
  });

  it("tronque au-delà de la limite et ajoute une note, sans dépasser la limite", () => {
    const long = "a".repeat(MAX_BODY_CHARS + 500);
    const truncated = truncateReportBody(long);
    expect(truncated.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(truncated).toContain("tronqué");
  });

  it("le corps complet respecte toujours la limite maximale", () => {
    const body = buildBugReportBody(report({ description: "x".repeat(MAX_BODY_CHARS * 2) }));
    expect([...body].length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});

describe("buildBugReportText", () => {
  it("combine titre et corps pour la copie presse-papier", () => {
    const text = buildBugReportText(report());
    expect(text.startsWith("Le ping échoue après veille\n\n")).toBe(true);
    expect(text).toContain("### Description");
  });

  it("utilise un titre de repli si vide", () => {
    expect(buildBugReportText(report({ title: "   " }))).toContain("(sans titre)");
  });
});

describe("buildBugReportIssueUrl", () => {
  it("construit une adresse « new issue » vers le dépôt du projet", () => {
    const url = buildBugReportIssueUrl(report());
    expect(url.startsWith("https://github.com/NolanEDUVAUD/server-manager/issues/new?")).toBe(true);
    expect(url).toContain("labels=bug");
  });

  it("encode correctement titre et corps", () => {
    const url = buildBugReportIssueUrl(report({ title: "Bug : ça plante & tout" }));
    const params = new URL(url).searchParams;
    expect(params.get("title")).toBe("Bug : ça plante & tout");
    expect(params.get("labels")).toBe("bug");
    expect(params.get("body")).toContain("### Description");
  });

  it("accepte un dépôt de test explicite", () => {
    const url = buildBugReportIssueUrl(report(), "https://github.com/example/repo");
    expect(url.startsWith("https://github.com/example/repo/issues/new?")).toBe(true);
  });
});
