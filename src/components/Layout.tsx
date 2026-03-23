import { NavLink } from "react-router-dom";
import { LayoutDashboard, Server, Layers, Settings, Wifi } from "lucide-react";
import { useStore } from "../stores/useStore";
import { cn } from "../utils";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/servers", icon: Server, label: "Serveurs" },
  { to: "/groups", icon: Layers, label: "Groupes" },
  { to: "/settings", icon: Settings, label: "Paramètres" },
];

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { servers, statuses } = useStore();

  const onlineCount = servers.filter((s) => statuses[s.id]?.online).length;
  const totalCount = servers.length;

  return (
    <div className="flex h-screen bg-win-bg text-win-text overflow-hidden select-none">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="w-56 flex flex-col bg-win-surface border-r border-win-border shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-win-border">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-win bg-win-accent/15">
              <Server size={18} className="text-win-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-win-text leading-tight">
                Server Manager
              </p>
              <p className="text-xs text-win-muted leading-tight">Power Control</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-win text-sm transition-all duration-150",
                  isActive
                    ? "bg-win-accent text-white shadow-sm"
                    : "text-win-muted hover:text-win-text hover:bg-win-hover"
                )
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Compteur en ligne */}
        {totalCount > 0 && (
          <div className="px-4 py-3 border-t border-win-border">
            <div className="flex items-center gap-2 text-xs">
              <Wifi
                size={12}
                className={onlineCount > 0 ? "text-green-400" : "text-gray-500"}
              />
              <span className="text-win-muted">
                <span
                  className={
                    onlineCount > 0 ? "text-green-400 font-semibold" : "text-gray-500"
                  }
                >
                  {onlineCount}
                </span>
                <span>/{totalCount} en ligne</span>
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
