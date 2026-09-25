import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { formatPercent } from "./History";

describe("formatPercent", () => {
  it("n'arrondit jamais une coupure à 100 %", () => {
    expect(formatPercent(100)).toBe("100 %");
    expect(formatPercent(99.999)).toBe("99,99 %");
    expect(formatPercent(99.5)).toBe("99,5 %");
    expect(formatPercent(87.46)).toBe("87,4 %");
    expect(formatPercent(0)).toBe("0 %");
  });
});
