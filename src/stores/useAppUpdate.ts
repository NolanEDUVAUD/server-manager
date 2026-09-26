import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppUpdateCheck, AppUpdateInfo, AppUpdateProgress, GithubUpdateCheck } from "../types";
import { openExternal } from "../utils";
import { t } from "../i18n";

export type AppUpdateStatus = "idle" | "checking" | "up-to-date" | "available" | "error" | "installing";

interface AppUpdateStore {
  /** Version installée et présence d'une clé publique de signature (null = pas encore lu) */
  info: AppUpdateInfo | null;
  status: AppUpdateStatus;
  /**
   * Dernière réponse positive de `check_github_release` : fonctionne toujours, que
   * l'updater signé (`info.configured`) soit prêt ou non — c'est elle qui pilote
   * l'affichage de la page Paramètres → Mise à jour et de la bannière.
   */
  github: GithubUpdateCheck | null;
  /** Horodatage (Date.now()) de la dernière recherche terminée, succès ou échec */
  lastCheckedAt: number | null;
  error: string | null;
  progress: AppUpdateProgress | null;
  /** Bannière masquée par « Plus tard » (jusqu'au prochain lancement ou à la prochaine recherche manuelle) */
  dismissed: boolean;

  loadInfo: () => Promise<AppUpdateInfo | null>;
  /** `silent` : vérification de démarrage, un échec ne s'affiche pas (le backend le journalise) */
  check: (options?: { silent?: boolean }) => Promise<void>;
  /**
   * Installe la mise à jour trouvée. Si l'updater signé est configuré et propose la
   * même version, elle est téléchargée, vérifiée puis installée automatiquement
   * (avec progression). Sinon, la page de la release s'ouvre dans le navigateur :
   * rien n'est jamais téléchargé ni installé sans que l'utilisateur ait confirmé.
   */
  install: () => Promise<void>;
  dismiss: () => void;
}

/** Mise à jour automatique de l'application (séparée du store principal) */
export const useAppUpdate = create<AppUpdateStore>((set, get) => ({
  info: null,
  status: "idle",
  github: null,
  lastCheckedAt: null,
  error: null,
  progress: null,
  dismissed: false,

  loadInfo: async () => {
    try {
      const info = await invoke<AppUpdateInfo>("app_update_info");
      set({ info });
      return info;
    } catch (e) {
      console.warn("Version de l'application illisible :", e);
      return null;
    }
  },

  check: async ({ silent = false } = {}) => {
    const previous = get().status;
    if (previous === "checking" || previous === "installing") return;
    set({ status: "checking", error: null });
    try {
      const r = await invoke<GithubUpdateCheck>("check_github_release");
      set({
        github: r,
        lastCheckedAt: Date.now(),
        status: r.available ? "available" : "up-to-date",
        // Une recherche manuelle qui trouve une version réaffiche la bannière
        dismissed: r.available && !silent ? false : get().dismissed,
      });
    } catch (e) {
      set({ lastCheckedAt: Date.now() });
      if (silent) {
        // Démarrage hors ligne, GitHub injoignable… : sans bruit, on réessaiera au prochain lancement
        console.warn("Vérification des mises à jour impossible :", e);
        set({ status: previous });
      } else {
        set({ status: "error", error: String(e) });
      }
    }
  },

  install: async () => {
    const { github, info, status } = get();
    if (!github?.available || status === "installing") return;

    const openInBrowser = async () => {
      const ok = await openExternal(github.html_url);
      set({ status: "available", error: ok ? null : t("appUpdate.settings.openFailed"), progress: null });
    };

    if (!info?.configured) {
      await openInBrowser();
      return;
    }

    set({ status: "installing", error: null, progress: null });
    let unlisten: (() => void) | null = null;
    try {
      // L'updater signé doit proposer exactement la même version que la release GitHub
      const signed = await invoke<AppUpdateCheck>("app_update_check");
      if (signed.available && signed.version === github.latest_version) {
        unlisten = await listen<AppUpdateProgress>("app-update-progress", (e) => set({ progress: e.payload }));
        // En cas de succès l'application se ferme (installateur) ou redémarre : on ne revient pas ici
        await invoke("app_update_install", { version: signed.version });
        return;
      }
      // Le canal signé n'a pas (encore) cette version : ouverture de la release dans le navigateur
      await openInBrowser();
    } catch (e) {
      set({ status: "available", error: String(e), progress: null });
    } finally {
      unlisten?.();
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
