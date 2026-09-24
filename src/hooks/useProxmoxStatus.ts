import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";

/**
 * Hook qui lance le polling automatique des VM/LXC de toutes les
 * connexions Proxmox configurées, à l'intervalle défini dans les paramètres.
 */
export function useProxmoxStatus() {
  const { proxmoxConnections, loadProxmoxVms, settings } = useStore();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (proxmoxConnections.length === 0) return;

    const loadAll = () => {
      for (const conn of proxmoxConnections) {
        loadProxmoxVms(conn.id).catch(console.error);
      }
    };

    loadAll();

    const ms = (settings.network.proxmox_poll_interval_secs ?? 15) * 1000;
    intervalRef.current = setInterval(loadAll, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // Réinitialiser si l'intervalle ou le nombre de connexions change
  }, [settings.network.proxmox_poll_interval_secs, proxmoxConnections.length]);
}
