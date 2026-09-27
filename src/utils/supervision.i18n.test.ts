import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { setLanguage, t } from "../i18n";
import { CONDITION_LABELS, describeCondition } from "./alerts";
import { checkCustomFields, nameError } from "./organisation";
import { formatPercent } from "../pages/History";

describe("textes de supervision (utilitaires) en anglais", () => {
  afterEach(() => setLanguage("fr"));

  it("conditions d'alerte", () => {
    setLanguage("en");
    expect(t(CONDITION_LABELS.ProbeDown)).toBe("Service unreachable (probe)");
    expect(describeCondition({ type: "CpuAbove", percent: 90, minutes: 5 })).toBe("CPU > 90 % for 5 min");
    expect(describeCondition({ type: "TempAbove", celsius: 80, minutes: 0 })).toBe("CPU > 80 °C");
    expect(describeCondition({ type: "ActionFailed" })).toBe("As soon as an action fails");
  });

  it("validation de l'organisation et pourcentages", () => {
    setLanguage("en");
    expect(nameError("  ", 32, [])).toBe("Name required");
    expect(checkCustomFields([{ key: "", value: "x" }]).rows).toEqual(["Key required"]);
    expect(formatPercent(99.999)).toBe("99.99 %");
    setLanguage("fr");
    expect(formatPercent(99.999)).toBe("99,99 %");
  });
});
