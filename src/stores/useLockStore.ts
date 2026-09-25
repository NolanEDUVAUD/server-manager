import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { LockConfigPayload, LockStatus } from "../types";

/**
 * État du verrouillage, à part du store principal : il conditionne l'affichage de
 * toute l'application (LockGate). Le backend reste seul juge : chaque action
 * renvoie la vue à jour, et l'événement « lock-state » signale les verrouillages
 * automatiques (inactivité, session Windows, zone de notification).
 */
interface LockStore {
  status: LockStatus | null;
  /** Erreur de lecture de l'état (l'app reste alors masquée) */
  error: string | null;
  load: () => Promise<void>;
  setStatus: (status: LockStatus) => void;
  lockNow: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  unlockWithHello: () => Promise<void>;
  configure: (config: LockConfigPayload, newPin: string | null, currentSecret: string | null) => Promise<void>;
  enableMasterPassword: (password: string, currentSecret: string | null) => Promise<void>;
  changeMasterPassword: (current: string, newPassword: string) => Promise<void>;
  removeMasterPassword: (current: string) => Promise<void>;
}

export const useLockStore = create<LockStore>((set) => {
  const apply = async (command: string, args?: Record<string, unknown>) => {
    set({ status: await invoke<LockStatus>(command, args) });
  };
  return {
    status: null,
    error: null,

    load: async () => {
      try {
        set({ status: await invoke<LockStatus>("lock_status"), error: null });
      } catch (e) {
        set({ error: String(e) });
      }
    },

    setStatus: (status) => set({ status }),

    lockNow: () => apply("lock_now"),
    unlockWithPin: (pin) => apply("unlock_with_pin", { pin }),
    unlockWithPassword: (password) => apply("unlock_with_password", { password }),
    unlockWithHello: () => apply("unlock_with_hello"),
    configure: (config, newPin, currentSecret) => apply("lock_configure", { config, newPin, currentSecret }),
    enableMasterPassword: (password, currentSecret) => apply("master_password_enable", { password, currentSecret }),
    changeMasterPassword: (current, newPassword) => apply("master_password_change", { current, newPassword }),
    removeMasterPassword: (current) => apply("master_password_remove", { current }),
  };
});
