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
  /**
   * Distance minimale forcée entre deux nœuds (évite qu'ils se chevauchent ainsi que
   * leur étiquette). 0 désactive la résolution de collision.
   */
  collisionRadius?: number;
  /**
   * Multiplicateur global des forces (0-1) : la simulation « refroidit » en le
   * ramenant vers 0 au fil des pas (voir `INITIAL_ALPHA`/`ALPHA_DECAY`), ce qui
   * l'arrête proprement au lieu de trembler indéfiniment (jitter).
   */
  alpha?: number;
}

type ResolvedOptions = Required<Omit<ForceOptions, "width" | "height">> & { width: number; height: number };

const DEFAULTS: Omit<ResolvedOptions, "width" | "height"> = {
  repulsion: 6000,
  springLength: 120,
  springStrength: 0.02,
  damping: 0.82,
  centerStrength: 0.015,
  collisionRadius: 30,
  alpha: 1,
};

/** Valeur de départ de `alpha`, et vitesse à laquelle elle décroît vers `ALPHA_MIN`. */
export const INITIAL_ALPHA = 1;
export const ALPHA_DECAY = 0.02;
/** En dessous de ce seuil, la simulation est considérée comme stabilisée (on arrête la boucle). */
export const ALPHA_MIN = 0.01;

/** Fait décroître `alpha` d'un cran vers `ALPHA_MIN` (à appeler une fois par frame). */
export function decayAlpha(alpha: number, decay = ALPHA_DECAY): number {
  return Math.max(ALPHA_MIN, alpha + (ALPHA_MIN - alpha) * decay);
}

/**
 * Fait avancer la simulation d'un pas de temps (mutation en place, pour éviter une
 * réallocation à chaque frame ; le composant appelant décide quand redessiner).
 * Déterministe sauf pour deux nœuds exactement superposés (écart aléatoire minime,
 * juste pour sortir de la superposition).
 */
export function stepForceLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: ForceOptions): LayoutNode[] {
  const o: ResolvedOptions = { ...DEFAULTS, ...opts };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const alpha = o.alpha;

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
      const force = (o.repulsion / distSq) * alpha;
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
    const force = diff * o.springStrength * alpha;
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
    n.vx += (cx - n.x) * o.centerStrength * alpha;
    n.vy += (cy - n.y) * o.centerStrength * alpha;
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

  if (o.collisionRadius > 0) resolveCollisions(nodes, o.collisionRadius);

  return nodes;
}

/**
 * Écarte directement (sans passer par la vitesse) toute paire de nœuds plus proche
 * que `minDistance` : évite que deux nœuds — et donc leurs étiquettes — se
 * chevauchent, y compris pour des nœuds fixés (déplacés à la souris) qui, eux,
 * repoussent les autres sans être repoussés en retour.
 */
export function resolveCollisions(nodes: LayoutNode[], minDistance: number): LayoutNode[] {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.fixed && b.fixed) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= minDistance) continue;
      if (dist < 0.0001) {
        dx = Math.random() - 0.5;
        dy = Math.random() - 0.5;
        dist = Math.sqrt(dx * dx + dy * dy);
      }
      const overlap = (minDistance - dist) / 2;
      const ux = dx / dist;
      const uy = dy / dist;
      if (a.fixed) {
        b.x += ux * overlap * 2;
        b.y += uy * overlap * 2;
      } else if (b.fixed) {
        a.x -= ux * overlap * 2;
        a.y -= uy * overlap * 2;
      } else {
        a.x -= ux * overlap;
        a.y -= uy * overlap;
        b.x += ux * overlap;
        b.y += uy * overlap;
      }
    }
  }
  return nodes;
}

/** Enchaîne plusieurs pas de simulation (pratique en test pour atteindre un état stable). */
export function simulate(nodes: LayoutNode[], edges: LayoutEdge[], opts: ForceOptions, iterations = 200): LayoutNode[] {
  for (let i = 0; i < iterations; i++) stepForceLayout(nodes, edges, opts);
  return nodes;
}

export interface ViewTransform {
  tx: number;
  ty: number;
  scale: number;
}

/**
 * Calcule la transformation (translation + échelle) qui fait tenir tous les
 * nœuds dans le cadre `width`×`height`, avec une marge `padding` — le fameux
 * « fit to view » d'Obsidian, aussi utilisé pour le bouton « Recentrer ».
 * Ne réduit jamais en dessous de `minScale` ni n'agrandit au-delà de `maxScale`,
 * et retombe sur un centrage à l'échelle 1 s'il n'y a rien (ou un seul nœud) à cadrer.
 */
export function computeFitTransform(
  nodes: { x: number; y: number }[],
  width: number,
  height: number,
  padding = 60,
  minScale = 0.2,
  // Jamais > 1 : « ajuster à la vue » ne doit qu'éloigner, pas zoomer un petit
  // graphe au point de perdre le contexte (l'utilisateur zoome lui-même s'il veut).
  maxScale = 1
): ViewTransform {
  if (nodes.length === 0) return { tx: width / 2, ty: height / 2, scale: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }

  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min(maxScale, Math.max(minScale, Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY)));

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { tx: width / 2 - cx * scale, ty: height / 2 - cy * scale, scale };
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
