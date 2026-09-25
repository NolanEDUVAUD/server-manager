import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, LayoutPanelTop, Plus, Globe } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useDashboardTabSync } from "../hooks/useDashboardTabSync";
import { cn } from "../utils";
import { webTargets, WebTarget } from "../utils/webTargets";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/Toast";
import { useT } from "../i18n";

/** Liste des interfaces web ouvrables (menu déroulant ou page vide). */
function TargetPicker({ targets, openLabels, onPick, compact }: {
  targets: WebTarget[];
  openLabels: Set<string>;
  onPick: (t: WebTarget) => void;
  compact?: boolean;
}) {
  const { t } = useT();
  if (targets.length === 0) {
    return (
      <p className="text-text-muted text-sm p-3">
        {t("webTabs.none")}
      </p>
    );
  }
  return (
    <div className={cn(compact ? "flex flex-col py-1" : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3")}>
      {targets.map((target) => (
        <button
          key={target.label}
          onClick={() => onPick(target)}
          className={cn(
            "flex items-center gap-2.5 text-left transition-all duration-150",
            compact
              ? "px-3 py-2 text-sm hover:bg-bg-hover"
              : "p-3 rounded-win bg-bg-tertiary border border-border-primary hover:border-accent-primary/40 hover:shadow-win-hover"
          )}
        >
          <Globe size={16} className="text-accent-primary shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block text-text-primary text-sm truncate">{target.title}</span>
            <span className="block text-text-muted text-xs truncate">{target.kind} · {target.url}</span>
          </span>
          {openLabels.has(target.label) && <span className="text-[10px] text-accent-primary shrink-0">{t("webTabs.open")}</span>}
        </button>
      ))}
    </div>
  );
}

export function Dashboards() {
  const { t } = useT();
  const {
    dashboardTabs, activeDashboardTabLabel, setActiveDashboardTab, closeDashboardTab, openDashboardTab,
    servers, proxmoxConnections, loadProxmoxConnections,
  } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { toasts, removeToast, error } = useToast();

  const targets = webTargets(servers, proxmoxConnections);
  const openLabels = new Set(dashboardTabs.map((tab) => tab.label));

  useDashboardTabSync(containerRef);

  // Les connexions Proxmox ne sont chargées d'office que par la page Proxmox
  useEffect(() => {
    if (proxmoxConnections.length === 0) loadProxmoxConnections().catch(() => {});
  }, []);

  // Affiche la webview de l'onglet actif tant que cette page est montée ;
  // la masque au démontage (navigation vers une autre page) ou quand l'onglet
  // actif change, car la webview native n'est pas un élément du DOM et ne
  // disparaît donc pas automatiquement avec le routage React.
  // Elle est aussi masquée pendant que le menu déroulant est ouvert : la webview
  // est dessinée par-dessus tout le HTML et recouvrirait le menu.
  useEffect(() => {
    if (!activeDashboardTabLabel || pickerOpen) return;
    invoke("set_dashboard_tab_visible", { label: activeDashboardTabLabel, visible: true }).catch(() => {});

    return () => {
      invoke("set_dashboard_tab_visible", { label: activeDashboardTabLabel, visible: false }).catch(() => {});
    };
  }, [activeDashboardTabLabel, pickerOpen]);

  // Fermer le menu au clic à l'extérieur
  useEffect(() => {
    if (!pickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  function pick(target: WebTarget) {
    setPickerOpen(false);
    const { kind: _kind, ...tab } = target;
    const rect = containerRef.current?.getBoundingClientRect();
    openDashboardTab(
      tab,
      rect?.left ?? 0,
      rect?.top ?? 0,
      rect?.width ?? window.innerWidth,
      rect?.height ?? window.innerHeight
    ).catch((e) => error(String(e)));
  }

  return (
    <div className="flex flex-col h-full">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center gap-1 border-b border-border-primary bg-bg-secondary px-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
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
                title={t("webTabs.closeTab")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        {dashboardTabs.length > 0 && (
          <div ref={pickerRef} className="relative shrink-0">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="p-1.5 ml-1 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
              title={t("webTabs.openWeb")}
            >
              <Plus size={14} />
            </button>
            {pickerOpen && (
              <div className="absolute left-0 top-full mt-1 w-72 max-h-80 overflow-y-auto z-20 bg-bg-tertiary border border-border-primary rounded-win shadow-win-hover animate-fade-in">
                <TargetPicker targets={targets} openLabels={openLabels} onPick={pick} compact />
              </div>
            )}
          </div>
        )}
      </div>

      {dashboardTabs.length === 0 ? (
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2 text-text-secondary text-sm">
            <LayoutPanelTop size={16} className="opacity-60" />
            {t("webTabs.pick")}
          </div>
          <TargetPicker targets={targets} openLabels={openLabels} onPick={pick} />
        </div>
      ) : null}
      {/* Zone mesurée où se superpose la webview native de l'onglet actif. Toujours
          rendue (même vide) pour que sa position soit mesurable dès le premier onglet */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
