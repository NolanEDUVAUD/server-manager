import { LockStatus } from "../types";
import { createShortcutMatcher } from "./shortcuts";
import { t, TKey } from "../i18n";

/** Saisie proposée par l'écran de verrouillage */
export type UnlockMode = "password" | "hello" | "pin";

/**
 * Avec un mot de passe maître, lui seul déverrouille (Hello et le PIN ne dérivent
 * pas la clé) ; sinon Windows Hello avec PIN de secours, ou le PIN seul.
 */
export function unlockMode(status: LockStatus): UnlockMode {
  if (status.master_password) return "password";
  return status.method === "Hello" ? "hello" : "pin";
}

export const PIN_MIN = 4;
export const PIN_MAX = 12;
export const MASTER_MIN = 8;
export const MASTER_MAX = 256;

/** Remontée de l'activité au backend : au plus un appel toutes les 20 s */
export const ACTIVITY_INTERVAL_MS = 20_000;

/** Délais d'inactivité proposés (minutes, 0 = jamais) */
export const IDLE_CHOICES = [0, 1, 5, 10, 15, 30, 60, 120, 240];

/** Ce qui s'arrête pendant le verrouillage (clé du texte des réglages, traduit à l'affichage) */
export const SUSPENDED_WHILE_LOCKED_KEY: TKey = "lock.settings.suspended";

/** Message d'erreur du PIN, ou null s'il est valide (4 à 12 chiffres) */
export function pinError(pin: string, confirm?: string): string | null {
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin)) {
    return t("lock.errors.pinFormat", { min: PIN_MIN, max: PIN_MAX });
  }
  if (confirm !== undefined && pin !== confirm) return t("lock.errors.pinMismatch");
  return null;
}

/** Message d'erreur du mot de passe maître, ou null s'il est acceptable */
export function masterPasswordError(password: string, confirm: string): string | null {
  const length = [...password].length;
  if (length < MASTER_MIN || !password.trim()) return t("lock.errors.masterTooShort", { min: MASTER_MIN });
  if (length > MASTER_MAX) return t("lock.errors.masterTooLong", { max: MASTER_MAX });
  if (password !== confirm) return t("lock.errors.masterMismatch");
  return null;
}

/** « 5 s », « 2 min 5 s » (arrondi à la seconde supérieure) */
export function formatWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

export function formatIdle(minutes: number): string {
  if (minutes === 0) return t("lock.idleNever");
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Limite un envoi fréquent (activité clavier / souris) : au plus un appel par
 * intervalle. Le backend décide seul du verrouillage.
 */
export function createActivityThrottle(send: () => void, intervalMs: number, now: () => number = Date.now) {
  let last = -Infinity;
  return () => {
    const t = now();
    if (t - last >= intervalMs) {
      last = t;
      send();
    }
  };
}

/**
 * Raccourci « Verrouiller maintenant » : Ctrl+Maj+L (Ctrl+L efface l'écran d'un shell).
 * Défini dans la table des raccourcis (utils/shortcuts.ts), donc listé dans l'aide « ? ».
 */
export function isLockShortcut(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "shiftKey" | "altKey" | "key">): boolean {
  return createShortcutMatcher(["lock"])(e) === "lock";
}
