import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

/** Windows et ESXi n'exposent pas /proc : pas de collecte possible par SSH. */
export function supportsMetrics(server: Server): boolean {
  return server.os_type !== "Windows" && server.os_type !== "ESXi";
}

/**
 * Collecte périodique des ressources de tous les serveurs en ligne, montée une
 * seule fois au niveau de l'app pour que l'historique continue de se remplir
 * quelle que soit la page affichée.
 */
export function useMetrics() {
  const enabled = useStore((s) => s.settings.network.metrics_enabled);
  const intervalSecs = useStore((s) => s.settings.network.metrics_interval_secs);
  // Serveurs dont une collecte est déjà en cours : un serveur lent (timeout 10 s)
  // ne doit pas accumuler des connexions SSH parallèles d'un tick à l'autre.
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;

    function tick() {
      const { servers, statuses, fetchMetrics } = useStore.getState();
      for (const server of servers) {
        if (!supportsMetrics(server) || !statuses[server.id]?.online) continue;
        if (inFlight.current.has(server.id)) continue;
        inFlight.current.add(server.id);
        fetchMetrics(server.id).finally(() => inFlight.current.delete(server.id));
      }
    }

    // Premier tick après un court délai : laisse le premier ping établir les statuts
    const first = setTimeout(tick, 3000);
    const timer = setInterval(tick, Math.max(5, intervalSecs) * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, intervalSecs]);
}
