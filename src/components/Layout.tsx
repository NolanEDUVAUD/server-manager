import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import {
  LayoutDashboard, Server, Layers, Settings, Wifi, Boxes, LayoutPanelTop, Activity, TerminalSquare,
  History, CalendarClock, Container, BellRing, Archive, PowerOff, Network, ListChecks, PackageSearch,
  ScrollText, Lock, Pin, PinOff, SlidersHorizontal, RotateCcw, Info,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { useLockStore } from "../stores/useLockStore";
import {
  useLayoutStore, mergeOrder, moveItem, PAGE_GAP_PX, PageGap,
  SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_COLLAPSE_WIDTH, SIDEBAR_DEFAULT_WIDTH,
} from "../stores/useLayoutStore";
import { cn } from "../utils";
import { isVisible } from "../utils/modules";
import { Onboarding } from "./Onboarding";
import { Console } from "../pages/Console";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { TourModal } from "./TourModal";
import { WhatsNewModal } from "./WhatsNewModal";
import { EulaModal } from "./EulaModal";
import { useShortcuts, ShortcutHandlers } from "../hooks/useShortcuts";
import { NAV_SHORTCUTS } from "../utils/shortcuts";
import { UpdateBanner } from "./UpdateBanner";
import { SupportBanner } from "./SupportBanner";
import { TKey, useT } from "../i18n";

const NAV_ITEMS: { to: string; icon: typeof Server; labelKey: TKey; module?: string }[] = [
  { to: "/", icon: LayoutDashboard, labelKey: "layout.nav.dashboard" },
  { to: "/servers", icon: Server, labelKey: "layout.nav.servers" },
  { to: "/groups", icon: Layers, labelKey: "layout.nav.groups" },
  { to: "/lab-power", icon: PowerOff, labelKey: "layout.nav.power", module: "power" },
  { to: "/resources", icon: Activity, labelKey: "layout.nav.resources", module: "resources" },
  { to: "/network", icon: Network, labelKey: "layout.nav.network", module: "network" },
  { to: "/docker", icon: Container, labelKey: "layout.nav.docker", module: "docker" },
  { to: "/console", icon: TerminalSquare, labelKey: "layout.nav.console", module: "console" },
  { to: "/batch", icon: ListChecks, labelKey: "layout.nav.batch", module: "batch" },
  { to: "/updates", icon: PackageSearch, labelKey: "layout.nav.updates", module: "updates" },
  { to: "/history", icon: History, labelKey: "layout.nav.history", module: "history" },
  { to: "/logs", icon: ScrollText, labelKey: "layout.nav.logs", module: "logs" },
  { to: "/alerts", icon: BellRing, labelKey: "layout.nav.alerts", module: "alerts" },
  { to: "/scheduler", icon: CalendarClock, labelKey: "layout.nav.scheduler", module: "scheduler" },
  { to: "/proxmox", icon: Boxes, labelKey: "layout.nav.proxmox", module: "proxmox" },
  { to: "/backups", icon: Archive, labelKey: "layout.nav.backups", module: "proxmox" },
  { to: "/dashboards", icon: LayoutPanelTop, labelKey: "layout.nav.web", module: "web" },
  { to: "/settings", icon: Settings, labelKey: "layout.nav.settings" },
];

type NavItem = (typeof NAV_ITEMS)[number];

const PAGE_GAP_CHOICES: PageGap[] = ["compact", "normal", "spacious"];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { servers, statuses, settings } = useStore();
  const { t } = useT();
  const onConsole = useLocation().pathname === "/console";
  const nav = NAV_ITEMS.filter((i) => isVisible(i.module, settings.general.hidden_modules ?? []));

  const onlineCount = servers.filter((s) => statuses[s.id]?.online).length;
  const totalCount = servers.length;
  const lockEnabled = useLockStore((s) => !!s.status?.enabled);
  const lockNow = useLockStore((s) => s.lockNow);

  // Raccourcis de navigation (« g » puis une lettre) : lus dans la table, vers les pages visibles
  const navigate = useNavigate();
  const navShortcuts: ShortcutHandlers = Object.fromEntries(
    NAV_SHORTCUTS.map((s) => [s.id, () => { if (nav.some((n) => n.to === s.to)) navigate(s.to); }])
  );
  useShortcuts(navShortcuts);

  // Version installée (lue une fois au démarrage ; vide si indisponible, ex. en test)
  const [version, setVersion] = useState("");
  useEffect(() => {
    let alive = true;
    getVersion()
      .then((v) => { if (alive) setVersion(v); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Build de pré-version (défini par le workflow de release) : affiché à côté du numéro
  const isBeta = import.meta.env.VITE_RELEASE_CHANNEL === "beta";
  const versionLabel = version ? `v${version}${isBeta ? ` ${t("layout.beta")}` : ""}` : "";

  // ── Largeur de la barre latérale (redimensionnable, persistée) ─────────────
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const resetSidebarWidth = useLayoutStore((s) => s.resetSidebarWidth);
  const collapsed = sidebarWidth < SIDEBAR_COLLAPSE_WIDTH;
  const resizing = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return;
      setSidebarWidth(e.clientX);
    }
    function onUp() {
      resizing.current = false;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [setSidebarWidth]);

  // ── Densité des pages ────────────────────────────────────────────────────
  const pageGap = useLayoutStore((s) => s.pageGap);
  const setPageGap = useLayoutStore((s) => s.setPageGap);

  // ── Ordre des onglets et favoris (glisser-déposer) ──────────────────────
  const tabOrderRaw = useLayoutStore((s) => s.tabOrder);
  const favoritesRaw = useLayoutStore((s) => s.favorites);
  const setTabOrder = useLayoutStore((s) => s.setTabOrder);
  const resetTabOrder = useLayoutStore((s) => s.resetTabOrder);
  const resetFavorites = useLayoutStore((s) => s.resetFavorites);
  const addFavorite = useLayoutStore((s) => s.addFavorite);
  const removeFavorite = useLayoutStore((s) => s.removeFavorite);

  // Séparer /settings des autres onglets (ne doit pas être draggable)
  const navWithoutSettings = nav.filter((n) => n.to !== "/settings");
  const settingsItem = nav.find((n) => n.to === "/settings");

  const defaultOrder = navWithoutSettings.map((n) => n.to);
  // Nettoyer les ordres/favoris persistés contenant /settings
  const cleanedTabOrder = tabOrderRaw.filter((r) => r !== "/settings");
  const cleanedFavorites = favoritesRaw.filter((r) => r !== "/settings");

  const order = mergeOrder(defaultOrder, cleanedTabOrder);
  const favorites = cleanedFavorites.filter((r) => defaultOrder.includes(r));
  const byRoute = new Map<string, NavItem>(navWithoutSettings.map((n) => [n.to, n]));
  const favNav = favorites.map((r) => byRoute.get(r)).filter((n): n is NavItem => !!n);
  const mainNav = order
    .filter((r) => !favorites.includes(r))
    .map((r) => byRoute.get(r))
    .filter((n): n is NavItem => !!n);

  // Glisser-déposer des onglets, implémenté au pointeur plutôt qu'avec l'API HTML5
  // drag & drop : sous Tauri/WebView2 (Windows), quand `dragDropEnabled` de la fenêtre
  // intercepte le drag-drop natif de l'OS, les événements `dragstart`/`dragover`/`drop`
  // du navigateur ne se déclenchent jamais correctement — le HTML5 DnD ne fonctionne
  // qu'en environnement Chromium « pur » (tests, devtools), pas dans l'app réelle.
  type DropTarget = { route: string | null; zone: "main" | "favorites"; before: boolean } | null;
  const [dragRoute, setDragRoute] = useState<string | null>(null);
  const [dropTarget, setDropTargetState] = useState<DropTarget>(null);
  // Les gestionnaires window (pointermove/pointerup) sont attachés une seule fois, au
  // pointerdown : ce sont des fonctions fraîches à chaque rendu qui ne « voient » jamais
  // les mises à jour d'état suivantes (fermeture figée). `dropTarget` doit donc aussi
  // vivre dans une ref, seule source fiable pour `onPointerUp` ; l'état ne sert qu'au rendu
  // (indicateur visuel de la position de dépôt).
  const dropTargetRef = useRef<DropTarget>(null);
  function setDropTarget(target: DropTarget) {
    dropTargetRef.current = target;
    setDropTargetState(target);
  }
  const dragCandidate = useRef<{ route: string; pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const navRef = useRef<HTMLElement>(null);

  /** Distance (px) au-delà de laquelle un appui devient un glissement (sinon : un simple clic) */
  const DRAG_THRESHOLD = 5;

  function computeDropTarget(clientX: number, clientY: number): { route: string | null; zone: "main" | "favorites"; before: boolean } | null {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el || !navRef.current?.contains(el)) return null;
    const zoneEl = el.closest("[data-nav-zone]") as HTMLElement | null;
    const zone = (zoneEl?.getAttribute("data-nav-zone") as "main" | "favorites" | null) ?? "main";
    const itemEl = el.closest("[data-nav-route]") as HTMLElement | null;
    if (!itemEl) return { route: null, zone, before: true };
    const rect = itemEl.getBoundingClientRect();
    return { route: itemEl.getAttribute("data-nav-route"), zone, before: clientY < rect.top + rect.height / 2 };
  }

  /** Route juste après `target` dans `list`, pour transformer un dépôt « après X » en « avant Y » */
  function routeAfter(list: string[], target: string): string | undefined {
    const idx = list.indexOf(target);
    return idx >= 0 ? list[idx + 1] : undefined;
  }

  function commitDrop(route: string, target: { route: string | null; zone: "main" | "favorites"; before: boolean } | null) {
    if (!target) return;
    if (target.zone === "favorites") {
      const before = target.route ? (target.before ? target.route : routeAfter(favorites, target.route)) : undefined;
      addFavorite(route, before ?? null);
      return;
    }
    if (favorites.includes(route)) removeFavorite(route);
    const to = target.route ? (target.before ? target.route : routeAfter(order, target.route)) : undefined;
    setTabOrder(to ? moveItem(order, route, to) : [...order.filter((r) => r !== route), route]);
  }

  // Les écouteurs posés sur window doivent garder la même référence pour pouvoir être
  // retirés, tout en appelant les gestionnaires du dernier rendu (état à jour).
  const latestHandlers = useRef({ move: (_e: PointerEvent) => {}, up: () => {}, key: (_e: KeyboardEvent) => {}, cancel: () => {} });
  const windowListeners = useRef({
    move: (e: PointerEvent) => latestHandlers.current.move(e),
    up: () => latestHandlers.current.up(),
    key: (e: KeyboardEvent) => latestHandlers.current.key(e),
    cancel: () => latestHandlers.current.cancel(),
  }).current;

  function endDrag() {
    window.removeEventListener("pointermove", windowListeners.move);
    window.removeEventListener("pointerup", windowListeners.up);
    window.removeEventListener("pointercancel", windowListeners.cancel);
    window.removeEventListener("keydown", windowListeners.key);
  }

  function onPointerMove(e: PointerEvent) {
    const candidate = dragCandidate.current;
    if (!candidate) return;
    if (!candidate.dragging) {
      const dx = e.clientX - candidate.startX;
      const dy = e.clientY - candidate.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      candidate.dragging = true;
      suppressClick.current = true;
      setDragRoute(candidate.route);
    }
    setDropTarget(computeDropTarget(e.clientX, e.clientY));
  }

  function onPointerUp() {
    const candidate = dragCandidate.current;
    dragCandidate.current = null;
    endDrag();
    if (candidate?.dragging) {
      commitDrop(candidate.route, dropTargetRef.current);
      // Le clic de fin de glissement ne doit pas déclencher la navigation du lien ;
      // on relâche la garde juste après pour ne pas gêner le prochain vrai clic.
      requestAnimationFrame(() => { suppressClick.current = false; });
    }
    setDragRoute(null);
    setDropTarget(null);
  }

  function cancelDrag() {
    if (!dragCandidate.current) return;
    dragCandidate.current = null;
    endDrag();
    setDragRoute(null);
    setDropTarget(null);
    requestAnimationFrame(() => { suppressClick.current = false; });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") cancelDrag();
  }
  latestHandlers.current = { move: onPointerMove, up: onPointerUp, key: onKeyDown, cancel: cancelDrag };

  function onItemPointerDown(route: string) {
    return (e: React.PointerEvent) => {
      // e.button vaut 0 pour le bouton principal (clic gauche / doigt / stylet) ; on ignore
      // clic droit et clic milieu. Certains environnements (jsdom en test) ne renseignent
      // pas la propriété : on ne bloque alors pas le geste.
      if (e.button !== undefined && e.button !== 0) return;
      dragCandidate.current = { route, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
      endDrag();
      window.addEventListener("pointermove", windowListeners.move);
      window.addEventListener("pointerup", windowListeners.up);
      window.addEventListener("pointercancel", windowListeners.cancel);
      window.addEventListener("keydown", windowListeners.key);
    };
  }

  function onItemClickCapture(e: React.MouseEvent) {
    if (!suppressClick.current) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // État des popovers d'info
  const [openHelpPopover, setOpenHelpPopover] = useState<string | null>(null);
  const helpPopoverRef = useRef<{ route: string; timeoutId: ReturnType<typeof setTimeout> } | null>(null);

  // Mapping des routes vers les clés d'aide (pour éviter les clés dynamiques)
  const helpKeyMap: Record<string, string> = {
    "/": "dashboard",
    "/servers": "servers",
    "/groups": "groups",
    "/lab-power": "power",
    "/resources": "resources",
    "/network": "network",
    "/docker": "docker",
    "/console": "console",
    "/batch": "batch",
    "/updates": "updates",
    "/history": "history",
    "/logs": "logs",
    "/alerts": "alerts",
    "/scheduler": "scheduler",
    "/proxmox": "proxmox",
    "/backups": "backups",
    "/dashboards": "web",
    "/settings": "settings",
  };

  const getHelpText = (route: string): string => {
    const key = helpKeyMap[route];
    const helpTexts: Record<string, string> = {
      dashboard: t("layout.help.dashboard"),
      servers: t("layout.help.servers"),
      groups: t("layout.help.groups"),
      power: t("layout.help.power"),
      resources: t("layout.help.resources"),
      network: t("layout.help.network"),
      docker: t("layout.help.docker"),
      console: t("layout.help.console"),
      batch: t("layout.help.batch"),
      updates: t("layout.help.updates"),
      history: t("layout.help.history"),
      logs: t("layout.help.logs"),
      alerts: t("layout.help.alerts"),
      scheduler: t("layout.help.scheduler"),
      proxmox: t("layout.help.proxmox"),
      backups: t("layout.help.backups"),
      web: t("layout.help.web"),
      settings: t("layout.help.settings"),
    };
    return key ? helpTexts[key] : "";
  };

  function renderNavItem(item: NavItem, opts: { favorite: boolean; isSettings?: boolean }) {
    const { to, icon: Icon, labelKey } = item;
    const dropHere = dropTarget?.route === to;
    const isSettings = opts.isSettings ?? false;

    // Pour le mode collapsed, on ajoute " — description" au titre
    const helpText = getHelpText(to);
    const collapsedTitle = collapsed ? `${t(labelKey)} — ${helpText}` : undefined;

    return (
      <div
        key={to}
        data-nav-route={to}
        onPointerDown={isSettings ? undefined : onItemPointerDown(to)}
        onClickCapture={isSettings ? undefined : onItemClickCapture}
        className={cn(
          "group/nav relative touch-none",
          dragRoute === to && "opacity-50",
          dropHere && dropTarget?.before && "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-accent-primary",
          dropHere && !dropTarget?.before && "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent-primary"
        )}
      >
        <NavLink
          to={to}
          end={to === "/"}
          title={collapsedTitle || t(labelKey)}
          // Un lien est glissable nativement : le navigateur lancerait son propre glisser
          // (et annulerait les événements pointeur, pointerup compris). On le désactive.
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 px-3 py-2 rounded-win text-sm transition-all duration-150",
              collapsed ? "justify-center" : "justify-start pr-7",
              isActive
                ? "bg-accent-primary text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            )
          }
        >
          <Icon size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{t(labelKey)}</span>}
        </NavLink>
        {!collapsed && (
          <>
            <button
              type="button"
              title={helpText}
              aria-label={t("layout.aboutTab", { tab: t(labelKey) })}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpenHelpPopover(openHelpPopover === to ? null : to);
              }}
              onMouseEnter={() => {
                if (helpPopoverRef.current) clearTimeout(helpPopoverRef.current.timeoutId);
                setOpenHelpPopover(to);
              }}
              onMouseLeave={() => {
                helpPopoverRef.current = {
                  route: to,
                  timeoutId: setTimeout(() => {
                    setOpenHelpPopover((current) => (current === to ? null : current));
                  }, 150),
                };
              }}
              className={cn(
                "absolute top-1/2 -translate-y-1/2 p-1 rounded text-text-secondary opacity-0 group-hover/nav:opacity-100 focus-visible:opacity-100 hover:text-accent-primary hover:bg-bg-hover transition-opacity",
                isSettings ? "right-1.5" : "right-9"
              )}
            >
              <Info size={12} />
            </button>
            {!isSettings && <button
              type="button"
              title={opts.favorite ? t("layout.unpin") : t("layout.pin")}
              onClick={() => (opts.favorite ? removeFavorite(to) : addFavorite(to))}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-secondary opacity-0 group-hover/nav:opacity-100 hover:text-accent-primary hover:bg-bg-hover transition-opacity"
            >
              {opts.favorite ? <PinOff size={13} /> : <Pin size={13} />}
            </button>}
          </>
        )}
      </div>
    );
  }

  /** Bulle d'aide placée juste à droite de la barre latérale, alignée sur l'onglet */
  function helpPopoverPosition(route: string): React.CSSProperties {
    const rect = document.querySelector(`[data-nav-route="${route}"]`)?.getBoundingClientRect();
    if (!rect) return { left: 8, top: 8 };
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - 16), window.innerHeight - 80);
    return { left: rect.right + 8, top };
  }

  // Popover d'aide
  useEffect(() => {
    if (openHelpPopover && helpPopoverRef.current?.timeoutId) {
      clearTimeout(helpPopoverRef.current.timeoutId);
      helpPopoverRef.current = null;
    }
  }, [openHelpPopover]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenHelpPopover(null);
    }
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target?.closest(".help-popover") && !target?.closest("[class*='group/nav']")) {
        setOpenHelpPopover(null);
      }
    }
    if (openHelpPopover) {
      document.addEventListener("keydown", handleEscape);
      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("keydown", handleEscape);
        document.removeEventListener("click", handleClickOutside);
      };
    }
  }, [openHelpPopover]);

  return (
    <div
      id="app-root"
      className="flex h-screen bg-bg-primary text-text-primary overflow-hidden select-none"
      style={{ ["--page-gap" as string]: `${PAGE_GAP_PX[pageGap]}px` }}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="relative flex flex-col bg-bg-secondary border-r border-border-primary shrink-0 min-h-0"
        style={{ width: sidebarWidth }}
      >
        {/* Logo */}
        <div className={cn("py-4 border-b border-border-primary shrink-0", collapsed ? "px-2" : "px-5 py-5")}>
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <img src="/app-icon.png" alt="" width={30} height={30} className="shrink-0 select-none" draggable={false} />
            {!collapsed && (
              <div title={versionLabel || undefined}>
                <p className="text-sm font-semibold text-text-primary leading-tight">
                  Server Manager
                </p>
                <p className="text-xs text-text-secondary leading-tight">
                  Power Control{version ? ` · v${version}` : ""}
                  {version && isBeta && (
                    <span className="ml-1 px-1 rounded bg-accent-warning/20 text-accent-warning text-[10px] font-semibold uppercase">
                      {t("layout.beta")}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
          {collapsed && version && (
            <div className="sr-only">{versionLabel}</div>
          )}
        </div>

        {/* Navigation : défile quand la fenêtre est trop basse pour tous les onglets */}
        <nav
          ref={navRef}
          data-nav-zone="main"
          className={cn(
            "flex-1 min-h-0 overflow-y-auto space-y-0.5",
            collapsed ? "p-2" : "p-3",
            dragRoute && dropTarget?.zone === "main" && !dropTarget.route && "bg-bg-hover/40"
          )}
        >
          {/* Favoris : toujours visibles (même vides) pour servir de zone de dépôt */}
          {(!collapsed || favNav.length > 0) && (
            <div
              data-nav-zone="favorites"
              className={cn(
                "mb-1 rounded-win",
                !collapsed && "pb-2 mb-2 border-b border-border-primary",
                dragRoute && dropTarget?.zone === "favorites" && !dropTarget.route && "bg-bg-hover/40"
              )}
            >
              {!collapsed && (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary/70">
                  {t("layout.favorites")}
                </p>
              )}
              {favNav.length === 0 && !collapsed && (
                <p className="px-3 py-2 text-xs text-text-secondary/60 border border-dashed border-border-primary rounded-win text-center">
                  {t("layout.favoritesEmpty")}
                </p>
              )}
              <div className="space-y-0.5">
                {favNav.map((item) => renderNavItem(item, { favorite: true }))}
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            {mainNav.map((item) => renderNavItem(item, { favorite: false }))}
          </div>
        </nav>

        {/* Verrouillage (si une méthode est configurée) */}
        {lockEnabled && (
          <div className="px-2 md:px-3 pt-2 border-t border-border-primary shrink-0">
            <button
              onClick={() => lockNow().catch(() => {})}
              title={t("layout.lockNowTitle", { combo: t("shortcuts.lockCombo") })}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-win text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150",
                collapsed ? "justify-center" : "justify-start"
              )}
            >
              <Lock size={16} className="shrink-0" />
              {!collapsed && <span className="truncate">{t("layout.lock")}</span>}
            </button>
          </div>
        )}

        {/* Paramètres : épinglé en bas, au-dessus du compteur en ligne */}
        {settingsItem && (
          <div className="px-2 py-2 border-t border-border-primary shrink-0">
            {renderNavItem(settingsItem, { favorite: false, isSettings: true })}
          </div>
        )}

        {/* Compteur en ligne */}
        {totalCount > 0 && (
          <div className={cn("py-3 border-t border-border-primary shrink-0", collapsed ? "px-2" : "px-4")} title={t("layout.onlineTitle", { online: onlineCount, total: totalCount })}>
            <div className={cn("flex items-center gap-2 text-xs", collapsed && "justify-center")}>
              <Wifi
                size={12}
                className={onlineCount > 0 ? "text-green-400" : "text-gray-500"}
              />
              {!collapsed && (
                <span className="text-text-secondary">
                  <span
                    className={
                      onlineCount > 0 ? "text-green-400 font-semibold" : "text-gray-500"
                    }
                  >
                    {onlineCount}
                  </span>
                  <span>{t("layout.onlineSuffix", { total: totalCount })}</span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Poignée de redimensionnement (double-clic : réinitialiser) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.resizeSidebar")}
          title={t("layout.resizeSidebar")}
          onMouseDown={(e) => { e.preventDefault(); resizing.current = true; }}
          onDoubleClick={resetSidebarWidth}
          className="absolute top-0 -right-0.5 h-full w-1.5 cursor-col-resize hover:bg-accent-primary/40 active:bg-accent-primary/60 z-10"
        />
      </aside>

      {/* ── Popover d'aide ─────────────────────────────────────────────────── */}
      {openHelpPopover && createPortal(
        <div
          role="tooltip"
          className="help-popover fixed bg-bg-tertiary border border-border-primary rounded-win shadow-win-hover px-2.5 py-2 text-xs text-text-secondary z-dropdown max-w-xs pointer-events-none"
          style={helpPopoverPosition(openHelpPopover)}
        >
          {getHelpText(openHelpPopover)}
        </div>,
        document.body
      )}

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <CommandPalette pages={nav.map((n) => ({ to: n.to, label: t(n.labelKey) }))} />
      <ShortcutsHelp />
      <EulaModal />
      <Onboarding />
      <TourModal />
      <WhatsNewModal />
      <main className="flex-1 min-w-0 relative overflow-hidden flex flex-col">
        {/* Nouvelle version signée disponible (au-dessus du contenu, qu'elle pousse vers le bas) */}
        <UpdateBanner />
        {/* Bannière d'invitation à soutenir le projet */}
        <SupportBanner />
        <div
          className={cn("flex-1 min-h-0 overflow-y-auto", onConsole && "hidden")}
          style={{ padding: "var(--page-gap)" }}
        >
          {children}
        </div>
        {/* Console montée en permanence : les terminaux et leurs sessions SSH
            survivent à la navigation entre les pages */}
        <div className={cn("flex-1 min-h-0 overflow-y-auto", !onConsole && "hidden")}>
          <Console />
        </div>
      </main>
    </div>
  );
}
