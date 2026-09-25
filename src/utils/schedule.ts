import { t, TKey } from "../i18n";

/** Clés des libellés courts des jours, index 0 = lundi (comme côté Rust) */
export const DAY_KEYS: TKey[] = [
  "scheduler.days.mon",
  "scheduler.days.tue",
  "scheduler.days.wed",
  "scheduler.days.thu",
  "scheduler.days.fri",
  "scheduler.days.sat",
  "scheduler.days.sun",
];

/** Libellé court d'un jour dans la langue active (0 = lundi) */
export function dayLabel(day: number): string {
  return t(DAY_KEYS[day]);
}

/**
 * Prochaine exécution d'une tâche (heure locale), ou null si elle ne peut pas
 * s'exécuter. Le créneau de la minute en cours est considéré comme passé.
 */
export function nextRun(schedule: { days: number[]; time: string }, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time);
  if (!match || schedule.days.length === 0) return null;
  const [h, m] = [Number(match[1]), Number(match[2])];
  if (h > 23 || m > 59) return null;

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m, 0, 0);
    // getDay() : 0 = dimanche → converti en 0 = lundi
    const weekday = (candidate.getDay() + 6) % 7;
    if (schedule.days.includes(weekday) && candidate > now) return candidate;
  }
  return null;
}

export function formatDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b).join(",");
  if (sorted === "0,1,2,3,4,5,6") return t("scheduler.every.day");
  if (sorted === "0,1,2,3,4") return t("scheduler.every.weekday");
  if (sorted === "5,6") return t("scheduler.every.weekend");
  return [...days].sort((a, b) => a - b).map(dayLabel).join(", ");
}

/** Description lisible d'une planification : « Tous les jours à 07:00 », « Every day at 07:00 » */
export function formatSchedule(days: number[], time: string): string {
  return t("scheduler.at", { days: formatDays(days), time });
}
