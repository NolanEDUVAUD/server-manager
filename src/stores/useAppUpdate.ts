import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppUpdateCheck, AppUpdateInfo, AppUpdateProgress } from "../types";
import type { TKey } from "../i18n";

/** Clé du message affiché quand aucune clé publique de signature n'est embarquée (traduit à l'affichage) */
export const NOT_CONFIGURED_KEY: TKey = "appUpdate.notConfigured";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "not-configured"
  | "error"
  | "installing";

interface AppUpdateStore {
  /** Version installée et présence de la clé publique (null = pas encore lu) */
  info: AppUpdateInfo | null;
  status: AppUpdateStatus;
  /** Dernière réponse positive de `app_update_check` */
  update: AppUpdateCheck | null;
  error: string | null;
  progress: AppUpdateProgress | null;
  /** Bannière masquée par « Plus tard » (jusqu'au prochain lancement ou à la prochaine recherche manuelle) */
  dismissed: boolean;

  loadInfo: () => Promise<AppUpdateInfo | null>;
  /** `silent` : vérification de démarrage, un échec ne s'affiche pas (le backend le journalise) */
  check: (options?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

/** Mise à jour automatique de l'application (séparée du store principal) */
export const useAppUpdate = create<AppUpdateStore>((set, get) => ({
  info: null,
  status: "idle",
  update: null,
  error: null,
  progress: null,
  dismissed: false,

  loadInfo: async () => {
    try {
      const info = await invoke<AppUpdateInfo>("app_update_info");
      set((s) => ({
        info,
        status: !info.configured && s.status === "idle" ? "not-configured" : s.status,
      }));
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
      const r = await invoke<AppUpdateCheck>("app_update_check");
      const info = { configured: r.configured, current_version: r.current_version };
      if (!r.configured) {
        set({ info, status: "not-configured", update: null });
      } else if (r.available) {
        // Une recherche manuelle qui trouve une version réaffiche la bannière
        set({ info, status: "available", update: r, dismissed: silent ? get().dismissed : false });
      } else {
        set({ info, status: "up-to-date", update: null });
      }
    } catch (e) {
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
    const { update, status } = get();
    if (!update?.version || status === "installing") return;
    set({ status: "installing", error: null, progress: null });
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<AppUpdateProgress>("app-update-progress", (e) => set({ progress: e.payload }));
      // En cas de succès l'application se ferme (installateur) ou redémarre : on ne revient pas ici
      await invoke("app_update_install", { version: update.version });
    } catch (e) {
      set({ status: "available", error: String(e), progress: null });
    } finally {
      unlisten?.();
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
