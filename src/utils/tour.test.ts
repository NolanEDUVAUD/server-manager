import { describe, it, expect } from "vitest";
import { TOUR_STEPS, getVisibleSteps, filterStepsByIds, computeCardPosition } from "./tour";

describe("tour utilities", () => {
  describe("getVisibleSteps", () => {
    it("inclut toutes les étapes quand aucun module n'est masqué", () => {
      const steps = getVisibleSteps([]);
      expect(steps.map((s) => s.id)).toEqual(TOUR_STEPS.map((s) => s.id));
    });

    it("retire les étapes dont le module est masqué", () => {
      const steps = getVisibleSteps(["console", "batch"]);
      expect(steps.map((s) => s.id)).not.toContain("console");
      expect(steps.map((s) => s.id)).not.toContain("batch");
    });

    it("conserve toujours bienvenue, dashboard, serveurs, personnalisation et paramètres", () => {
      const steps = getVisibleSteps(["console", "batch", "network", "alerts"]);
      expect(steps.map((s) => s.id)).toEqual(["welcome", "dashboard", "servers", "customization", "settings"]);
    });

    it("masque toutes les étapes à module quand tout est caché", () => {
      const steps = getVisibleSteps(["console", "batch", "network", "alerts", "docker", "power", "resources", "history", "updates", "logs", "scheduler", "proxmox", "web"]);
      expect(steps.map((s) => s.id)).toEqual(["welcome", "dashboard", "servers", "customization", "settings"]);
    });
  });

  describe("filterStepsByIds", () => {
    const steps = getVisibleSteps([]);

    it("ne garde que les identifiants demandés, dans l'ordre d'origine", () => {
      const filtered = filterStepsByIds(steps, ["settings", "dashboard"]);
      expect(filtered.map((s) => s.id)).toEqual(["dashboard", "settings"]);
    });

    it("ignore les identifiants inconnus", () => {
      const filtered = filterStepsByIds(steps, ["dashboard", "inconnu"]);
      expect(filtered.map((s) => s.id)).toEqual(["dashboard"]);
    });

    it("retombe sur la liste complète si rien ne correspond", () => {
      const filtered = filterStepsByIds(steps, ["inconnu"]);
      expect(filtered).toEqual(steps);
    });

    it("retourne la liste complète sans filtre", () => {
      expect(filterStepsByIds(steps, null)).toEqual(steps);
      expect(filterStepsByIds(steps, undefined)).toEqual(steps);
      expect(filterStepsByIds(steps, [])).toEqual(steps);
    });
  });

  describe("computeCardPosition", () => {
    const viewport = { width: 1200, height: 800 };
    const card = { width: 320, height: 240 };

    it("centre la carte quand il n'y a pas de cible", () => {
      const pos = computeCardPosition(null, viewport, card);
      expect(pos.placement).toBe("center");
      expect(pos.left).toBeCloseTo((1200 - 320) / 2);
      expect(pos.top).toBeCloseTo((800 - 240) / 2);
    });

    it("place la carte à droite quand la place suffit", () => {
      const target = { top: 100, left: 60, right: 200, bottom: 140, width: 140, height: 40 };
      const pos = computeCardPosition(target, viewport, card);
      expect(pos.placement).toBe("right");
      expect(pos.left).toBe(200 + 16);
      expect(pos.top).toBe(100);
    });

    it("bascule à gauche quand la cible est collée au bord droit", () => {
      const target = { top: 100, left: 1000, right: 1180, bottom: 140, width: 180, height: 40 };
      const pos = computeCardPosition(target, viewport, card);
      expect(pos.placement).toBe("left");
      expect(pos.left).toBe(1000 - 16 - 320);
    });

    it("replie en bas puis repince dans l'écran quand rien ne tient à droite ou à gauche", () => {
      // Cible pleine largeur : ni droite ni gauche ne laissent 320px de libre.
      const target = { top: 10, left: 0, right: 1200, bottom: 60, width: 1200, height: 50 };
      const pos = computeCardPosition(target, viewport, card);
      expect(pos.placement).toBe("bottom");
      expect(pos.top).toBe(60 + 16);
      // Repincée horizontalement dans l'écran (left du bord n'aurait pas suffi pour dépasser à droite)
      expect(pos.left).toBeGreaterThanOrEqual(12);
      expect(pos.left + card.width).toBeLessThanOrEqual(viewport.width - 12);
    });

    it("garde toujours la carte entièrement visible", () => {
      const target = { top: 780, left: 5, right: 45, bottom: 800, width: 40, height: 20 };
      const pos = computeCardPosition(target, viewport, card);
      expect(pos.top).toBeGreaterThanOrEqual(12);
      expect(pos.top + card.height).toBeLessThanOrEqual(viewport.height - 12 + 0.001);
      expect(pos.left).toBeGreaterThanOrEqual(12);
      expect(pos.left + card.width).toBeLessThanOrEqual(viewport.width - 12 + 0.001);
    });
  });
});
