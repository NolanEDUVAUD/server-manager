import { useEffect } from "react";
import { useStore } from "../stores/useStore";

/**
 * Garde la webview native de l'onglet actif alignée sur la zone de contenu
 * mesurée en DOM, y compris lors des redimensionnements de fenêtre.
 */
export function useDashboardTabSync(containerRef: React.RefObject<HTMLDivElement>) {
  const { activeDashboardTabLabel, resizeDashboardTab } = useStore();

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activeDashboardTabLabel) return;

    function sync() {
      const rect = el!.getBoundingClientRect();
      resizeDashboardTab(activeDashboardTabLabel!, rect.left, rect.top, rect.width, rect.height);
    }

    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [containerRef, activeDashboardTabLabel, resizeDashboardTab]);
}
