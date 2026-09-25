import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../stores/useStore";
import { AppEvent } from "../types";

/**
 * Charge l'historique au démarrage puis reçoit chaque nouvel événement en direct
 * (émis par le backend dès qu'il est enregistré), quelle que soit la page affichée.
 */
export function useEventFeed() {
  useEffect(() => {
    const { loadEvents, addEvent } = useStore.getState();
    loadEvents().catch(console.error);

    const unlisten = listen<AppEvent>("event-recorded", (e) => addEvent(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
