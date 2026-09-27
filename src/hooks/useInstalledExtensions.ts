import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { extensionThemesOnly, InstalledExtension } from "../utils/extensions";
import { registerExtraThemes } from "../utils/theme";

/**
 * Extensions installées (manifeste + activée), pour fusionner leurs contributions
 * (snippets, thèmes, catalogue de services) avec les listes natives. Chargées une
 * fois au montage : l'installation/désinstallation se fait depuis Paramètres →
 * Extensions, qui recharge la page (pas besoin d'un store partagé pour si peu).
 */
export function useInstalledExtensions(): InstalledExtension[] {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);

  useEffect(() => {
    let cancelled = false;
    invoke<InstalledExtension[]>("get_extensions")
      .then((list) => {
        if (!cancelled) {
          setExtensions(list);
          registerExtraThemes(extensionThemesOnly(list));
        }
      })
      .catch(() => {
        if (!cancelled) setExtensions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return extensions;
}
