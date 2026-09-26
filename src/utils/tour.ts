import { isVisible } from "./modules";
import type { TKey } from "../i18n";

/**
 * Logique pure du tutoriel interactif (aucun DOM ici — testable en isolation).
 * Le placement des coach-marks et le filtrage des étapes vivent dans ce module ;
 * `TourModal.tsx` ne fait que l'habiller avec du JSX.
 */

/** Une étape du tutoriel : cible un onglet réel de la barre latérale (ou aucun, pour une carte centrée) */
export interface TourStepDef {
  /** Identifiant stable (sert aussi de `tourStep` dans le journal des modifications) */
  id: string;
  /** Sélecteur CSS de l'élément à mettre en évidence ; absent = carte centrée (ex. bienvenue) */
  selector?: string;
  /** Route vers laquelle « Essayer » navigue ; absent = pas de bouton « Essayer » */
  route?: string;
  /** Module optionnel (voir src/utils/modules.ts) : l'étape n'apparaît que si le module est visible */
  module?: string;
  titleKey: TKey;
  textKey: TKey;
}

/** Liste complète des étapes possibles, dans l'ordre d'affichage */
export const TOUR_STEPS: readonly TourStepDef[] = [
  { id: "welcome", titleKey: "tour.steps.welcome.title", textKey: "tour.steps.welcome.text" },
  { id: "dashboard", selector: '[data-nav-route="/"]', route: "/", titleKey: "tour.steps.dashboard.title", textKey: "tour.steps.dashboard.text" },
  { id: "servers", selector: '[data-nav-route="/servers"]', route: "/servers", titleKey: "tour.steps.servers.title", textKey: "tour.steps.servers.text" },
  { id: "console", selector: '[data-nav-route="/console"]', route: "/console", module: "console", titleKey: "tour.steps.console.title", textKey: "tour.steps.console.text" },
  { id: "batch", selector: '[data-nav-route="/batch"]', route: "/batch", module: "batch", titleKey: "tour.steps.batch.title", textKey: "tour.steps.batch.text" },
  { id: "network", selector: '[data-nav-route="/network"]', route: "/network", module: "network", titleKey: "tour.steps.network.title", textKey: "tour.steps.network.text" },
  { id: "alerts", selector: '[data-nav-route="/alerts"]', route: "/alerts", module: "alerts", titleKey: "tour.steps.alerts.title", textKey: "tour.steps.alerts.text" },
  { id: "customization", selector: '[data-nav-zone="favorites"]', titleKey: "tour.steps.customization.title", textKey: "tour.steps.customization.text" },
  { id: "settings", selector: '[data-nav-route="/settings"]', route: "/settings", titleKey: "tour.steps.settings.title", textKey: "tour.steps.settings.text" },
] as const;

/**
 * Étapes à afficher pour un tour complet : les modules masqués sont exclus,
 * les étapes sans `module` (bienvenue, dashboard, serveurs, personnalisation, paramètres)
 * sont toujours incluses.
 */
export function getVisibleSteps(hiddenModules: string[]): TourStepDef[] {
  return TOUR_STEPS.filter((step) => isVisible(step.module, hiddenModules));
}

/**
 * Restreint une liste d'étapes à un sous-ensemble d'identifiants (ordre de `steps` conservé),
 * utilisé par « Quoi de neuf ? » pour ne rejouer que les nouveautés d'une version.
 * Un identifiant inconnu est ignoré ; si rien ne correspond, la liste complète est renvoyée.
 */
export function filterStepsByIds(steps: TourStepDef[], ids: string[] | null | undefined): TourStepDef[] {
  if (!ids || ids.length === 0) return steps;
  const filtered = steps.filter((s) => ids.includes(s.id));
  return filtered.length > 0 ? filtered : steps;
}

export type Placement = "right" | "left" | "bottom" | "top" | "center";

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CardPosition {
  placement: Placement;
  top: number;
  left: number;
}

/** Marge (px) entre la cible mise en évidence et la carte, et entre la carte et les bords de l'écran */
export const TOUR_GAP = 16;
export const TOUR_SCREEN_MARGIN = 12;

/**
 * Calcule où placer la carte d'explication à côté d'une cible : essaie à droite, à gauche
 * puis en bas, en bordure haute d'écran, dans cet ordre, et retient le premier
 * emplacement qui tient entièrement dans la fenêtre ; à défaut, replie en bas (repincé
 * dans les bords). Sans cible (élément introuvable ou étape centrée), la carte est centrée.
 */
export function computeCardPosition(target: Rect | null, viewport: Size, card: Size): CardPosition {
  if (!target) {
    return {
      placement: "center",
      top: Math.max(TOUR_SCREEN_MARGIN, (viewport.height - card.height) / 2),
      left: Math.max(TOUR_SCREEN_MARGIN, (viewport.width - card.width) / 2),
    };
  }

  const candidates: { placement: Placement; top: number; left: number }[] = [
    { placement: "right", top: target.top, left: target.right + TOUR_GAP },
    { placement: "left", top: target.top, left: target.left - TOUR_GAP - card.width },
    { placement: "bottom", top: target.bottom + TOUR_GAP, left: target.left },
    { placement: "top", top: target.top - TOUR_GAP - card.height, left: target.left },
  ];

  const fits = (c: { top: number; left: number }) =>
    c.left >= TOUR_SCREEN_MARGIN &&
    c.left + card.width <= viewport.width - TOUR_SCREEN_MARGIN &&
    c.top >= TOUR_SCREEN_MARGIN &&
    c.top + card.height <= viewport.height - TOUR_SCREEN_MARGIN;

  const found = candidates.find(fits);
  const chosen = found ?? candidates[2]; // repli : sous la cible, quitte à être repincé ensuite

  return { placement: chosen.placement, top: clamp(chosen.top, viewport, card, "top"), left: clamp(chosen.left, viewport, card, "left") };
}

function clamp(value: number, viewport: Size, card: Size, axis: "top" | "left"): number {
  const max = axis === "top" ? viewport.height - card.height - TOUR_SCREEN_MARGIN : viewport.width - card.width - TOUR_SCREEN_MARGIN;
  return Math.min(Math.max(value, TOUR_SCREEN_MARGIN), Math.max(max, TOUR_SCREEN_MARGIN));
}

/** Respecte `prefers-reduced-motion` : pas d'animation dans le tutoriel (coach-marks, mini-exemples) */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
