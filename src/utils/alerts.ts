import { AlertCondition, AlertRule } from "../types";
import { t, TKey } from "../i18n";

export type ConditionType = AlertCondition["type"];

/** Clé de traduction du libellé de chaque type de condition (résolue à l'affichage avec t()) */
export const CONDITION_LABELS: Record<ConditionType, TKey> = {
  Offline: "alerts.conditions.offline",
  CpuAbove: "alerts.conditions.cpuAbove",
  RamAbove: "alerts.conditions.ramAbove",
  DiskAbove: "alerts.conditions.diskAbove",
  TempAbove: "alerts.conditions.tempAbove",
  ActionFailed: "alerts.conditions.actionFailed",
  ProbeDown: "alerts.conditions.probeDown",
};

/** Condition par défaut quand on change de type dans le formulaire */
export function defaultCondition(type: ConditionType): AlertCondition {
  switch (type) {
    case "Offline": return { type, minutes: 3 };
    case "CpuAbove": return { type, percent: 90, minutes: 5 };
    case "RamAbove": return { type, percent: 90, minutes: 5 };
    case "DiskAbove": return { type, percent: 90 };
    case "TempAbove": return { type, celsius: 85, minutes: 2 };
    case "ActionFailed": return { type };
    case "ProbeDown": return { type, minutes: 2 };
  }
}

/** Résumé lisible d'une condition (« CPU > 90 % pendant 5 min ») */
export function describeCondition(c: AlertCondition): string {
  // Avec une durée : variante « … pendant N min »
  const timed = (instant: TKey, during: TKey, minutes: number, vars: Record<string, number>) =>
    minutes > 0 ? t(during, { ...vars, minutes }) : t(instant, vars);
  switch (c.type) {
    case "Offline": return t("alerts.describe.offline", { minutes: c.minutes });
    case "CpuAbove": return timed("alerts.describe.cpu", "alerts.describe.cpuDuring", c.minutes, { percent: c.percent });
    case "RamAbove": return timed("alerts.describe.ram", "alerts.describe.ramDuring", c.minutes, { percent: c.percent });
    case "DiskAbove": return t("alerts.describe.disk", { percent: c.percent });
    case "TempAbove": return timed("alerts.describe.temp", "alerts.describe.tempDuring", c.minutes, { celsius: c.celsius });
    case "ActionFailed": return t("alerts.describe.actionFailed");
    case "ProbeDown": return t("alerts.describe.probeDown", { minutes: c.minutes });
  }
}

export function newRule(): AlertRule {
  return {
    id: "",
    name: "",
    enabled: true,
    condition: defaultCondition("Offline"),
    target: { kind: "All" },
    notify_desktop: true,
    notify_push: true,
    cooldown_minutes: 30,
  };
}
