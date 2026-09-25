import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import { useAppUpdate } from "../stores/useAppUpdate";

/**
 * Vérification des mises à jour au démarrage, une seule fois, après le chargement
 * des réglages : lit d'abord la configuration (sans réseau) puis, si la clé de
 * signature est présente et le réglage actif, lance une recherche silencieuse.
 */
export function useAppUpdateCheck() {
  const initialized = useStore((s) => s.initialized);
  const done = useRef(false);

  useEffect(() => {
    if (!initialized || done.current) return;
    done.current = true;
    const { loadInfo, check } = useAppUpdate.getState();
    loadInfo().then((info) => {
      const enabled = useStore.getState().settings.general.check_updates !== false;
      if (info?.configured && enabled) check({ silent: true });
    });
  }, [initialized]);
}
