import { describe, it, expect } from "vitest";
import { probeFromPreset, SERVICE_CATALOG } from "./serviceCatalog";
import { authWarnings } from "./probes";
import { hiddenExcept, isVisible, MODULES } from "./modules";

describe("catalogue de services", () => {
  it("a des identifiants uniques et des chemins valides", () => {
    const ids = SERVICE_CATALOG.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SERVICE_CATALOG) {
      expect(s.path.startsWith("/")).toBe(true);
      if (s.jsonPath) expect(s.jsonPath).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
  });

  it("construit l'URL et omet le port par défaut", () => {
    const ha = SERVICE_CATALOG.find((s) => s.id === "home-assistant")!;
    const p = probeFromPreset(ha, "10.0.0.5", "srv1");
    expect(p.kind).toMatchObject({ type: "Http", url: "http://10.0.0.5:8123/api/", json_path: "message" });
    expect(p.auth).toEqual({ type: "Bearer" });
    expect(p.server_id).toBe("srv1");
    const nc = probeFromPreset(SERVICE_CATALOG.find((s) => s.id === "nextcloud")!, "cloud.example.org", null);
    expect(nc.kind).toMatchObject({ url: "https://cloud.example.org/status.php" });
  });

  it("vérifie le certificat par défaut dès qu'il y a des identifiants", () => {
    for (const s of SERVICE_CATALOG) {
      expect(probeFromPreset(s, "h", null).verify_tls).toBe(s.auth.type !== "None");
    }
  });
});

describe("avertissements de sécurité", () => {
  const base = probeFromPreset(SERVICE_CATALOG.find((s) => s.id === "truenas")!, "nas", null);

  it("signale un secret envoyé en HTTP ou sans vérifier le certificat", () => {
    expect(authWarnings(base)).toEqual([]);
    expect(authWarnings({ ...base, verify_tls: false })[0]).toContain("Certificat non vérifié");
    expect(authWarnings({ ...base, kind: { ...base.kind, url: "http://nas/api" } as typeof base.kind })[0]).toContain("en clair");
    expect(authWarnings({ ...base, auth: { type: "None" }, verify_tls: false })).toEqual([]);
  });
});

describe("modules", () => {
  it("masque tout sauf la sélection ; les onglets de base restent visibles", () => {
    const hidden = hiddenExcept(["services", "console"]);
    expect(hidden).not.toContain("services");
    expect(hidden).toContain("proxmox");
    expect(hidden.length).toBe(MODULES.length - 2);
    expect(isVisible(undefined, hidden)).toBe(true);
    expect(isVisible("proxmox", hidden)).toBe(false);
  });
});
