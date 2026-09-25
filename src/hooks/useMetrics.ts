import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../stores/useStore";
import { Server, ServerMetrics } from "../types";

/** Windows et ESXi n'exposent pas /proc : pas de collecte possible par SSH. */
export function supportsMetrics(server: Server): boolean {
  return server.os_type !== "Windows" && server.os_type !== "ESXi";
}

export interface MetricsUpdate {
  server_id: string;
  metrics: ServerMetrics | null;
  error: string | null;
}

/**
 * Reçoit les métriques collectées par la boucle Rust (monitor.rs), qui tourne
 * indépendamment de la fenêtre, et les range dans le store (valeurs + historique).
 * Au montage, les derniers points enregistrés en base sont rechargés : les courbes
 * survivent à un redémarrage de l'app.
 */
export function useMetrics() {
  useEffect(() => {
    useStore.getState().loadRecentMetrics().catch(console.error);
    const unlisten = listen<MetricsUpdate>("metrics-update", (e) => {
      useStore.getState().applyMetrics(e.payload.server_id, e.payload.metrics, e.payload.error);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
