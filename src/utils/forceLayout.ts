// src/utils/forceLayout.ts
//
// Simulation « ressort/répulsion » à la main pour la vue Graphe du réseau (façon
// Obsidian) : pas de dépendance, juste de la physique 2D très simplifiée, appelée à
// chaque frame par le composant (requestAnimationFrame). Module pur, testable sans
// React ni DOM : `stepForceLayout` fait avancer la simulation d'un pas, `simulate`
// enchaîne plusieurs pas (pratique en test, pour atteindre un état stable).

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Un nœud fixe (ex. déplacé à la souris) ignore les forces et garde sa position */
  fixed?: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface ForceOptions {
  width: number;
  height: number;
  /** Force de répulsion entre toute paire de nœuds (loi en 1/distance²) */
  repulsion?: number;
  /** Longueur de ressort visée pour une arête */
  springLength?: number;
  springStrength?: number;
  /** Amortissement appliqué à la vitesse à chaque pas (0-1) */
  damping?: number;
  /** Force qui ramène doucement les nœuds vers le centre (évite qu'ils dérivent hors champ) */
  centerStrength?: number;
}

type ResolvedOptions = Required<Omit<ForceOptions, "width" | "height">> & { width: number; height: number };

const DEFAULTS: Omit<ResolvedOptions, "width" | "height"> = {
  repulsion: 6000,
  springLength: 120,
  springStrength: 0.02,
  damping: 0.82,
  centerStrength: 0.015,
};

/**
 * Fait avancer la simulation d'un pas de temps (mutation en place, pour éviter une
 * réallocation à chaque frame ; le composant appelant décide quand redessiner).
 * Déterministe sauf pour deux nœuds exactement superposés (écart aléatoire minime,
 * juste pour sortir de la superposition).
 */
export function stepForceLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: ForceOptions): LayoutNode[] {
  const o: ResolvedOptions = { ...DEFAULTS, ...opts };
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Répulsion entre toute paire de nœuds (O(n²), largement suffisant pour un homelab)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.0001) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const force = o.repulsion / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.fixed) {
        a.vx += fx;
        a.vy += fy;
      }
      if (!b.fixed) {
        b.vx -= fx;
        b.vy -= fy;
      }
    }
  }

  // Ressorts : les arêtes tirent les nœuds connectés vers `springLength`
  for (const e of edges) {
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    if (!a || !b || a === b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
    const diff = dist - o.springLength;
    const force = diff * o.springStrength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.fixed) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.fixed) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Recentrage doux (évite que le nuage de nœuds dérive hors du cadre visible)
  const cx = o.width / 2;
  const cy = o.height / 2;
  for (const n of nodes) {
    if (n.fixed) continue;
    n.vx += (cx - n.x) * o.centerStrength;
    n.vy += (cy - n.y) * o.centerStrength;
  }

  // Intégration + amortissement
  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= o.damping;
    n.vy *= o.damping;
    n.x += n.vx;
    n.y += n.vy;
  }

  return nodes;
}

/** Enchaîne plusieurs pas de simulation (pratique en test pour atteindre un état stable). */
export function simulate(nodes: LayoutNode[], edges: LayoutEdge[], opts: ForceOptions, iterations = 200): LayoutNode[] {
  for (let i = 0; i < iterations; i++) stepForceLayout(nodes, edges, opts);
  return nodes;
}

/** Position de départ en cercle autour du centre, pour éviter que tous les nœuds démarrent superposés. */
export function circularLayout(ids: string[], width: number, height: number, radius = Math.min(width, height) / 3): LayoutNode[] {
  const cx = width / 2;
  const cy = height / 2;
  return ids.map((id, i) => {
    const angle = (2 * Math.PI * i) / Math.max(ids.length, 1);
    return { id, x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), vx: 0, vy: 0 };
  });
}
