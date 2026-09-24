import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, LayoutPanelTop } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useDashboardTabSync } from "../hooks/useDashboardTabSync";
import { cn } from "../utils";

export function Dashboards() {
  const { dashboardTabs, activeDashboardTabLabel, setActiveDashboardTab, closeDashboardTab } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);

  useDashboardTabSync(containerRef);

  // Affiche la webview de l'onglet actif tant que cette page est montée ;
  // la masque au démontage (navigation vers une autre page) ou quand l'onglet
  // actif change, car la webview native n'est pas un élément du DOM et ne
  // disparaît donc pas automatiquement avec le routage React.
  useEffect(() => {
    if (!activeDashboardTabLabel) return;
    invoke("set_dashboard_tab_visible", { label: activeDashboardTabLabel, visible: true }).catch(() => {});

    return () => {
      invoke("set_dashboard_tab_visible", { label: activeDashboardTabLabel, visible: false }).catch(() => {});
    };
  }, [activeDashboardTabLabel]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 border-b border-border-primary bg-bg-secondary px-2 shrink-0 overflow-x-auto">
        {dashboardTabs.length === 0 && (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-3 px-1">
            <LayoutPanelTop size={14} className="opacity-50" />
            Aucun onglet ouvert — utilise "Ouvrir l'interface web" depuis une connexion.
          </div>
        )}
        {dashboardTabs.map((tab) => (
          <div
            key={tab.label}
            onClick={() => setActiveDashboardTab(tab.label)}
            className={cn(
              "flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer border-b-2 transition-colors shrink-0",
              activeDashboardTabLabel === tab.label
                ? "border-accent-primary text-text-primary"
                : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            <span className="truncate max-w-[150px]">{tab.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeDashboardTab(tab.label);
              }}
              className="hover:text-red-400 transition-colors"
              title="Fermer l'onglet"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <div ref={containerRef} className="flex-1" />
    </div>
  );
}
