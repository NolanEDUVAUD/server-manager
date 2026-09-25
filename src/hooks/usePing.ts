import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../stores/useStore";
import { PingResult } from "../types";

/**
 * Statuts des serveurs : le ping périodique tourne côté Rust (monitor.rs) pour
 * rester fiable fenêtre masquée ; ce hook reçoit ses résultats (« ping-results »)
 * et déclenche un ping immédiat au démarrage pour un affichage sans attente.
 */
export function usePing() {
  useEffect(() => {
    const { pingAll, updateStatus } = useStore.getState();
    pingAll().catch(console.error);
    const unlisten = listen<PingResult[]>("ping-results", (e) => updateStatus(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
