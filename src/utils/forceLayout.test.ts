import { describe, expect, it } from "vitest";
import {
  ALPHA_MIN,
  circularLayout,
  computeFitTransform,
  decayAlpha,
  LayoutEdge,
  LayoutNode,
  resolveCollisions,
  simulate,
  stepForceLayout,
} from "./forceLayout";

const dist = (a: LayoutNode, b: LayoutNode) => Math.hypot(a.x - b.x, a.y - b.y);

describe("stepForceLayout", () => {
  it("garde les positions finies après de nombreux pas", () => {
    const nodes = circularLayout(["a", "b", "c", "d"], 800, 600);
    const edges: LayoutEdge[] = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
    simulate(nodes, edges, { width: 800, height: 600 }, 300);
    for (const n of nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it("écarte deux nœuds superposés (répulsion)", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 400, y: 300, vx: 0, vy: 0 },
      { id: "b", x: 400, y: 300, vx: 0, vy: 0 },
    ];
    simulate(nodes, [], { width: 800, height: 600 }, 30);
    expect(dist(nodes[0], nodes[1])).toBeGreaterThan(1);
  });

  it("rapproche deux nœuds reliés qui démarrent trop éloignés (ressort)", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 100, y: 300, vx: 0, vy: 0 },
      { id: "b", x: 700, y: 300, vx: 0, vy: 0 },
    ];
    const before = dist(nodes[0], nodes[1]);
    simulate(nodes, [{ source: "a", target: "b" }], { width: 800, height: 600, springLength: 120 }, 200);
    expect(dist(nodes[0], nodes[1])).toBeLessThan(before);
  });

  it("stabilise deux nœuds reliés autour de la longueur de ressort", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 380, y: 300, vx: 0, vy: 0 },
      { id: "b", x: 420, y: 300, vx: 0, vy: 0 },
    ];
    simulate(nodes, [{ source: "a", target: "b" }], { width: 800, height: 600, springLength: 120 }, 300);
    expect(dist(nodes[0], nodes[1])).toBeGreaterThan(60);
    expect(dist(nodes[0], nodes[1])).toBeLessThan(200);
  });

  it("des nœuds connectés au même hub finissent plus proches entre eux que d'un nœud isolé, non connecté", () => {
    const nodes = circularLayout(["hub", "a", "b", "isolated"], 800, 600, 250);
    const edges: LayoutEdge[] = [
      { source: "hub", target: "a" },
      { source: "hub", target: "b" },
    ];
    simulate(nodes, edges, { width: 800, height: 600 }, 400);
    const [hub, a, b, isolated] = nodes;
    const avgConnected = (dist(hub, a) + dist(hub, b)) / 2;
    expect(dist(hub, isolated)).toBeGreaterThan(avgConnected);
  });

  it("ignore les arêtes vers un id inconnu sans planter", () => {
    const nodes = circularLayout(["a", "b"], 400, 300);
    expect(() => stepForceLayout(nodes, [{ source: "a", target: "ghost" }], { width: 400, height: 300 })).not.toThrow();
  });

  it("un nœud fixé (fixed) ne bouge pas", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 200, y: 200, vx: 5, vy: 5, fixed: true },
      { id: "b", x: 210, y: 200, vx: 0, vy: 0 },
    ];
    simulate(nodes, [{ source: "a", target: "b" }], { width: 800, height: 600 }, 50);
    expect(nodes[0].x).toBe(200);
    expect(nodes[0].y).toBe(200);
  });
});

describe("decayAlpha", () => {
  it("décroît vers ALPHA_MIN sans jamais repasser en dessous", () => {
    let alpha = 1;
    for (let i = 0; i < 2000; i++) alpha = decayAlpha(alpha);
    expect(alpha - ALPHA_MIN).toBeLessThan(0.001);
    expect(alpha).toBeGreaterThanOrEqual(ALPHA_MIN);
  });

  it("une simulation à alpha quasi nul ne bouge (presque) plus rien (pas de jitter)", () => {
    const nodes = circularLayout(["a", "b", "c"], 800, 600);
    simulate(nodes, [{ source: "a", target: "b" }], { width: 800, height: 600 }, 200);
    const before = nodes.map((n) => ({ x: n.x, y: n.y }));
    stepForceLayout(nodes, [{ source: "a", target: "b" }], { width: 800, height: 600, alpha: ALPHA_MIN });
    for (let i = 0; i < nodes.length; i++) {
      expect(Math.hypot(nodes[i].x - before[i].x, nodes[i].y - before[i].y)).toBeLessThan(0.5);
    }
  });
});

describe("resolveCollisions", () => {
  it("écarte deux nœuds trop proches d'au moins la distance minimale demandée", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 100, y: 100, vx: 0, vy: 0 },
      { id: "b", x: 105, y: 100, vx: 0, vy: 0 },
    ];
    resolveCollisions(nodes, 40);
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeCloseTo(40, 5);
  });

  it("ne bouge pas des nœuds déjà assez éloignés", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 0, y: 0, vx: 0, vy: 0 },
      { id: "b", x: 200, y: 0, vx: 0, vy: 0 },
    ];
    resolveCollisions(nodes, 40);
    expect(nodes[0].x).toBe(0);
    expect(nodes[1].x).toBe(200);
  });

  it("un nœud fixé (déplacé à la souris) repousse l'autre sans bouger lui-même", () => {
    const nodes: LayoutNode[] = [
      { id: "a", x: 100, y: 100, vx: 0, vy: 0, fixed: true },
      { id: "b", x: 105, y: 100, vx: 0, vy: 0 },
    ];
    resolveCollisions(nodes, 40);
    expect(nodes[0].x).toBe(100);
    expect(nodes[0].y).toBe(100);
    expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeCloseTo(40, 5);
  });
});

describe("computeFitTransform", () => {
  it("centre un unique nœud à l'échelle 1 (jamais de zoom au-delà de 100%)", () => {
    const t = computeFitTransform([{ x: 50, y: 50 }], 800, 600);
    expect(t.scale).toBe(1);
    expect(t.tx).toBeCloseTo(350, 5);
    expect(t.ty).toBeCloseTo(250, 5);
  });

  it("fait tenir un grand nuage de nœuds dans le cadre (dézoome)", () => {
    const nodes = circularLayout(["a", "b", "c", "d"], 2000, 2000, 900);
    const t = computeFitTransform(nodes, 800, 600, 40);
    for (const n of nodes) {
      const sx = n.x * t.scale + t.tx;
      const sy = n.y * t.scale + t.ty;
      expect(sx).toBeGreaterThanOrEqual(-1);
      expect(sx).toBeLessThanOrEqual(801);
      expect(sy).toBeGreaterThanOrEqual(-1);
      expect(sy).toBeLessThanOrEqual(601);
    }
    expect(t.scale).toBeLessThan(1);
  });

  it("ne plante pas sans nœud", () => {
    expect(() => computeFitTransform([], 800, 600)).not.toThrow();
  });
});

describe("circularLayout", () => {
  it("place chaque id sur un cercle autour du centre, sans doublon de position", () => {
    const nodes = circularLayout(["a", "b", "c"], 800, 600, 100);
    const cx = 400;
    const cy = 300;
    for (const n of nodes) {
      expect(Math.hypot(n.x - cx, n.y - cy)).toBeCloseTo(100, 5);
    }
    const positions = new Set(nodes.map((n) => `${n.x.toFixed(2)},${n.y.toFixed(2)}`));
    expect(positions.size).toBe(nodes.length);
  });

  it("ne plante pas sur une liste vide", () => {
    expect(circularLayout([], 800, 600)).toEqual([]);
  });
});
