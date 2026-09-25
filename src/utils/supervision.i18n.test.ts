import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { setLanguage, t } from "../i18n";
import { CONDITION_LABELS, describeCondition } from "./alerts";
import { authWarnings, describeProbe, suggestProbes } from "./probes";
import { CATEGORY_LABELS, probeFromPreset, SERVICE_CATALOG } from "./serviceCatalog";
import { checkCustomFields, nameError } from "./organisation";
import { formatPercent } from "../pages/History";
import { Server } from "../types";

const pve = { id: "pve", name: "minipc", os_type: "Proxmox", ip: "192.168.1.10" } as Server;

describe("textes de supervision (utilitaires) en anglais", () => {
  afterEach(() => setLanguage("fr"));

  it("conditions d'alerte", () => {
    setLanguage("en");
    expect(t(CONDITION_LABELS.ProbeDown)).toBe("Service unreachable (probe)");
    expect(describeCondition({ type: "CpuAbove", percent: 90, minutes: 5 })).toBe("CPU > 90 % for 5 min");
    expect(describeCondition({ type: "TempAbove", celsius: 80, minutes: 0 })).toBe("CPU > 80 °C");
    expect(describeCondition({ type: "ActionFailed" })).toBe("As soon as an action fails");
  });

  it("sondes : description, suggestions et avertissements", () => {
    setLanguage("en");
    expect(describeProbe({ type: "Http", url: "http://x/ready", expect_status: 200, keyword: "ready" })).toBe("http://x/ready → 200 · “ready”");
    expect(suggestProbes([pve], []).map((p) => p.name)).toEqual(["minipc · Proxmox interface", "minipc · certificate"]);
    const truenas = probeFromPreset(SERVICE_CATALOG.find((s) => s.id === "truenas")!, "192.168.1.30", null);
    expect(authWarnings({ ...truenas, verify_tls: false })[0]).toContain("Certificate not verified");
  });

  it("catalogue : chaque conseil et chaque catégorie existent dans les deux langues", () => {
    for (const lang of ["fr", "en"] as const) {
      setLanguage(lang);
      for (const s of SERVICE_CATALOG) {
        expect(t(s.help)).not.toBe(s.help);
        expect(t(CATEGORY_LABELS[s.category])).not.toBe(CATEGORY_LABELS[s.category]);
      }
    }
    setLanguage("en");
    expect(t(SERVICE_CATALOG.find((s) => s.id === "home-assistant")!.help)).toContain("Long-lived access tokens");
    // Sans adresse, l'URL contient un repère dans la langue active
    expect(probeFromPreset(SERVICE_CATALOG.find((s) => s.id === "grafana")!, "", null).kind).toMatchObject({ url: "http://address:3000/api/health" });
  });

  it("validation de l'organisation et pourcentages", () => {
    setLanguage("en");
    expect(nameError("  ", 32, [])).toBe("Name required");
    expect(checkCustomFields([{ key: "", value: "x" }]).rows).toEqual(["Key required"]);
    expect(formatPercent(99.999)).toBe("99.99 %");
    setLanguage("fr");
    expect(formatPercent(99.999)).toBe("99,99 %");
  });
});
