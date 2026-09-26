import { useEffect, useRef } from "react";
import { useStore } from "../stores/useStore";
import { useAppUpdate } from "../stores/useAppUpdate";

/**
 * Vérification des mises à jour au démarrage, une seule fois, après le chargement des
 * réglages : lit d'abord la version installée (sans réseau) puis, si le réglage est
 * actif, lance une recherche silencieuse via l'API GitHub (`check_github_release`).
 * Elle fonctionne que l'updater signé soit configuré ou non pour cette version.
 */
export function useAppUpdateCheck() {
  const initialized = useStore((s) => s.initialized);
  const done = useRef(false);

  useEffect(() => {
    if (!initialized || done.current) return;
    done.current = true;
    const { loadInfo, check } = useAppUpdate.getState();
    loadInfo().then(() => {
      const enabled = useStore.getState().settings.general.check_updates !== false;
      if (enabled) check({ silent: true });
    });
  }, [initialized]);
}
