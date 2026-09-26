import { describe, expect, it } from "vitest";
import { circularLayout, LayoutEdge, LayoutNode, simulate, stepForceLayout } from "./forceLayout";

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
