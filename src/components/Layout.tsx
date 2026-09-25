import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Server, Layers, Settings, Wifi, Boxes, LayoutPanelTop, Activity, TerminalSquare, History, CalendarClock, Container, BellRing, Radar, Archive, PowerOff, Network, ListChecks, PackageSearch, ScrollText, Lock } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useLockStore } from "../stores/useLockStore";
import { cn } from "../utils";
import { isVisible } from "../utils/modules";
import { Onboarding } from "./Onboarding";
import { Console } from "../pages/Console";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsHelp } from "./ShortcutsHelp";
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
  { to: "/services", icon: Radar, labelKey: "layout.nav.services", module: "services" },
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

  return (
    <div id="app-root" className="flex h-screen bg-bg-primary text-text-primary overflow-hidden select-none">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-14 md:w-56 flex flex-col bg-bg-secondary border-r border-border-primary shrink-0 min-h-0">
        {/* Logo */}
        <div className="px-3 md:px-5 py-4 md:py-5 border-b border-border-primary shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-win bg-accent-primary/15">
              <Server size={18} className="text-accent-primary" />
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-semibold text-text-primary leading-tight">
                Server Manager
              </p>
              <p className="text-xs text-text-secondary leading-tight">Power Control</p>
            </div>
          </div>
        </div>

        {/* Navigation : défile quand la fenêtre est trop basse pour tous les onglets */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-2 md:p-3 space-y-0.5">
          {nav.map(({ to, icon: Icon, labelKey }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              title={t(labelKey)}
              className={({ isActive }) =>
                cn(
                  "flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-win text-sm transition-all duration-150",
                  isActive
                    ? "bg-accent-primary text-white shadow-sm"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
                )
              }
            >
              <Icon size={16} className="shrink-0" />
              <span className="hidden md:inline truncate">{t(labelKey)}</span>
            </NavLink>
          ))}
        </nav>

        {/* Verrouillage (si une méthode est configurée) */}
        {lockEnabled && (
          <div className="px-2 md:px-3 pt-2 border-t border-border-primary shrink-0">
            <button
              onClick={() => lockNow().catch(() => {})}
              title={t("layout.lockNowTitle", { combo: t("shortcuts.lockCombo") })}
              className="w-full flex items-center justify-center md:justify-start gap-3 px-3 py-2 rounded-win text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all duration-150"
            >
              <Lock size={16} className="shrink-0" />
              <span className="hidden md:inline truncate">{t("layout.lock")}</span>
            </button>
          </div>
        )}

        {/* Compteur en ligne */}
        {totalCount > 0 && (
          <div className="px-2 md:px-4 py-3 border-t border-border-primary shrink-0" title={t("layout.onlineTitle", { online: onlineCount, total: totalCount })}>
            <div className="flex items-center justify-center md:justify-start gap-2 text-xs">
              <Wifi
                size={12}
                className={onlineCount > 0 ? "text-green-400" : "text-gray-500"}
              />
              <span className="text-text-secondary hidden md:inline">
                <span
                  className={
                    onlineCount > 0 ? "text-green-400 font-semibold" : "text-gray-500"
                  }
                >
                  {onlineCount}
                </span>
                <span>{t("layout.onlineSuffix", { total: totalCount })}</span>
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <CommandPalette pages={nav.map((n) => ({ to: n.to, label: t(n.labelKey) }))} />
      <ShortcutsHelp />
      <Onboarding />
      <main className="flex-1 min-w-0 relative overflow-hidden flex flex-col">
        {/* Nouvelle version signée disponible (au-dessus du contenu, qu'elle pousse vers le bas) */}
        <UpdateBanner />
        <div className={cn("flex-1 min-h-0 overflow-y-auto", onConsole && "hidden")}>{children}</div>
        {/* Console montée en permanence : les terminaux et leurs sessions SSH
            survivent à la navigation entre les pages */}
        <div className={cn("flex-1 min-h-0 overflow-y-auto", !onConsole && "hidden")}>
          <Console />
        </div>
      </main>
    </div>
  );
}
