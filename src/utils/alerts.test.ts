import { describe, it, expect } from "vitest";
import { describeCondition, defaultCondition, CONDITION_LABELS } from "./alerts";

describe("alertes", () => {
  it("décrit chaque type de condition", () => {
    expect(describeCondition({ type: "CpuAbove", percent: 90, minutes: 5 })).toBe("CPU > 90 % pendant 5 min");
    expect(describeCondition({ type: "DiskAbove", percent: 85 })).toBe("Un disque > 85 %");
    expect(describeCondition({ type: "TempAbove", celsius: 80, minutes: 0 })).toBe("CPU > 80 °C");
    expect(describeCondition({ type: "ActionFailed" })).toBe("Dès qu'une action échoue");
  });

  it("fournit une condition par défaut valide pour chaque type", () => {
    for (const type of Object.keys(CONDITION_LABELS) as (keyof typeof CONDITION_LABELS)[]) {
      expect(defaultCondition(type).type).toBe(type);
      expect(describeCondition(defaultCondition(type))).not.toBe("");
    }
  });
});
