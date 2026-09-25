import { AlertCondition, AlertRule } from "../types";

export type ConditionType = AlertCondition["type"];

export const CONDITION_LABELS: Record<ConditionType, string> = {
  Offline: "Serveur hors ligne",
  CpuAbove: "CPU élevé",
  RamAbove: "RAM élevée",
  DiskAbove: "Disque presque plein",
  TempAbove: "Température CPU",
  ActionFailed: "Action échouée",
  ProbeDown: "Service injoignable (sonde)",
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
  const during = (m: number) => (m > 0 ? ` pendant ${m} min` : "");
  switch (c.type) {
    case "Offline": return `Hors ligne depuis ${c.minutes} min`;
    case "CpuAbove": return `CPU > ${c.percent} %${during(c.minutes)}`;
    case "RamAbove": return `RAM > ${c.percent} %${during(c.minutes)}`;
    case "DiskAbove": return `Un disque > ${c.percent} %`;
    case "TempAbove": return `CPU > ${c.celsius} °C${during(c.minutes)}`;
    case "ActionFailed": return "Dès qu'une action échoue";
    case "ProbeDown": return `Sonde en échec depuis ${c.minutes} min`;
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
