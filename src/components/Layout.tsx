import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";
import {
  LayoutDashboard, Server, Layers, Settings, Wifi, Boxes, LayoutPanelTop, Activity, TerminalSquare,
  History, CalendarClock, Container, BellRing, Archive, PowerOff, Network, ListChecks, PackageSearch,
  ScrollText, Lock, Pin, PinOff, SlidersHorizontal, RotateCcw,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { useLockStore } from "../stores/useLockStore";
import {
  useLayoutStore, mergeOrder, moveItem, PAGE_GAP_PX, PageGap,
  SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_COLLAPSE_WIDTH,
} from "../stores/useLayoutStore";
import { cn } from "../utils";
import { isVisible } from "../utils/modules";
import { Onboarding } from "./Onboarding";
import { Console } from "../pages/Console";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { TourModal } from "./TourModal";
import { WhatsNewModal } from "./WhatsNewModal";
import { useShortcuts, ShortcutHandlers } from "../hooks/useShortcuts";
import { NAV_SHORTCUTS } from "../utils/shortcuts";
import { UpdateBanner } from "./UpdateBanner";
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
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // ── Ordre des onglets et favoris (glisser-déposer) ──────────────────────
  const tabOrderRaw = useLayoutStore((s) => s.tabOrder);
  const favoritesRaw = useLayoutStore((s) => s.favorites);
  const setTabOrder = useLayoutStore((s) => s.setTabOrder);
  const resetTabOrder = useLayoutStore((s) => s.resetTabOrder);
  const addFavorite = useLayoutStore((s) => s.addFavorite);
  const removeFavorite = useLayoutStore((s) => s.removeFavorite);

  const defaultOrder = nav.map((n) => n.to);
  const order = mergeOrder(defaultOrder, tabOrderRaw);
  const favorites = favoritesRaw.filter((r) => defaultOrder.includes(r));
  const byRoute = new Map<string, NavItem>(nav.map((n) => [n.to, n]));
  const favNav = favorites.map((r) => byRoute.get(r)).filter((n): n is NavItem => !!n);
  const mainNav = order
    .filter((r) => !favorites.includes(r))
    .map((r) => byRoute.get(r))
    .filter((n): n is NavItem => !!n);

  const [dragRoute, setDragRoute] = useState<string | null>(null);

  function onItemDragStart(route: string) {
    return (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", route);
      setDragRoute(route);
    };
  }

  function dropOnMain(target: string | null) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const route = dragRoute ?? e.dataTransfer.getData("text/plain");
      if (!route) return;
      if (favorites.includes(route)) removeFavorite(route);
      setTabOrder(target ? moveItem(order, route, target) : [...order.filter((r) => r !== route), route]);
      setDragRoute(null);
    };
  }

  function dropOnFavorites(target: string | null) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const route = dragRoute ?? e.dataTransfer.getData("text/plain");
      if (!route) return;
      addFavorite(route, target ?? undefined);
      setDragRoute(null);
    };
  }

  function renderNavItem(item: NavItem, opts: { favorite: boolean; onDrop: (e: React.DragEvent) => void }) {
    const { to, icon: Icon, labelKey } = item;
    return (
      <div
        key={to}
        draggable
        onDragStart={onItemDragStart(to)}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onDrop={opts.onDrop}
        className={cn("group/nav relative", dragRoute === to && "opacity-50")}
      >
        <NavLink
          to={to}
          end={to === "/"}
          title={t(labelKey)}
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
          <button
            type="button"
            title={opts.favorite ? t("layout.unpin") : t("layout.pin")}
            onClick={() => (opts.favorite ? removeFavorite(to) : addFavorite(to))}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-text-secondary opacity-0 group-hover/nav:opacity-100 hover:text-accent-primary hover:bg-bg-hover transition-opacity"
          >
            {opts.favorite ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
        )}
      </div>
    );
  }

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
            <div className="p-1.5 rounded-win bg-accent-primary/15">
              <Server size={18} className="text-accent-primary" />
            </div>
            {!collapsed && (
              <div title={version ? `v${version}` : undefined}>
                <p className="text-sm font-semibold text-text-primary leading-tight">
                  Server Manager
                </p>
                <p className="text-xs text-text-secondary leading-tight">
                  Power Control{version ? ` · v${version}` : ""}
                </p>
              </div>
            )}
          </div>
          {collapsed && version && (
            <div className="sr-only">v{version}</div>
          )}
        </div>

        {/* Navigation : défile quand la fenêtre est trop basse pour tous les onglets */}
        <nav
          className={cn("flex-1 min-h-0 overflow-y-auto space-y-0.5", collapsed ? "p-2" : "p-3")}
          onDragOver={(e) => e.preventDefault()}
          onDrop={dropOnMain(null)}
        >
          {/* Favoris : toujours visibles (même vides) pour servir de zone de dépôt */}
          {(!collapsed || favNav.length > 0) && (
            <div
              className={cn("mb-1", !collapsed && "pb-2 mb-2 border-b border-border-primary")}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={dropOnFavorites(null)}
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
                {favNav.map((item) => renderNavItem(item, { favorite: true, onDrop: dropOnFavorites(item.to) }))}
              </div>
            </div>
          )}

          <div className="space-y-0.5">
            {mainNav.map((item) => renderNavItem(item, { favorite: false, onDrop: dropOnMain(item.to) }))}
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

        {/* Personnalisation : densité des pages, réinitialisation de l'ordre */}
        <div className="relative px-2 py-2 border-t border-border-primary shrink-0">
          <button
            onClick={() => setCustomizeOpen((v) => !v)}
            title={t("layout.customize")}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-win text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150",
              collapsed ? "justify-center" : "justify-start"
            )}
          >
            <SlidersHorizontal size={16} className="shrink-0" />
            {!collapsed && <span className="truncate">{t("layout.customize")}</span>}
          </button>
          {customizeOpen && (
            <div className="absolute bottom-full left-2 mb-2 w-64 bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover p-3 space-y-3 z-20">
              <p className="text-xs font-semibold text-text-primary">{t("layout.customizeTitle")}</p>
              <div>
                <p className="text-[11px] text-text-secondary mb-1.5">{t("layout.pageGapLabel")}</p>
                <div className="flex gap-1">
                  {PAGE_GAP_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      onClick={() => setPageGap(choice)}
                      className={cn(
                        "flex-1 px-2 py-1 rounded-win text-xs transition-colors",
                        pageGap === choice
                          ? "bg-accent-primary text-white"
                          : "bg-bg-secondary text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                      )}
                    >
                      {t(`layout.pageGap.${choice}` as const)}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={resetTabOrder}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-win text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <RotateCcw size={13} />
                {t("layout.resetOrder")}
              </button>
            </div>
          )}
        </div>

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

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <CommandPalette pages={nav.map((n) => ({ to: n.to, label: t(n.labelKey) }))} />
      <ShortcutsHelp />
      <Onboarding />
      <TourModal />
      <WhatsNewModal />
      <main className="flex-1 min-w-0 relative overflow-hidden flex flex-col">
        {/* Nouvelle version signée disponible (au-dessus du contenu, qu'elle pousse vers le bas) */}
        <UpdateBanner />
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
