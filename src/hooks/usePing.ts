import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";

/**
 * Hook qui lance le ping automatique de tous les serveurs
 * à l'intervalle défini dans les paramètres.
 */
export function usePing() {
  const { settings, pingAll, servers } = useStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (servers.length === 0) return;

    // Ping immédiat au montage
    pingAll().catch(console.error);

    // Puis à intervalle régulier
    const ms = (settings.ping_interval_secs ?? 30) * 1000;
    intervalRef.current = setInterval(() => {
      pingAll().catch(console.error);
    }, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // Réinitialiser si l'intervalle ou le nombre de serveurs change
  }, [settings.ping_interval_secs, servers.length]);
}
