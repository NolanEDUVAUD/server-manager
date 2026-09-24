import { describe, it, expect } from "vitest";
import { formatLatency, cn } from "./index";

describe("formatLatency", () => {
  it("affiche les millisecondes en dessous de 1000ms", () => {
    expect(formatLatency(250)).toBe("250 ms");
  });

  it("affiche les secondes au-dessus de 1000ms", () => {
    expect(formatLatency(1500)).toBe("1.5 s");
  });

  it("affiche un tiret pour une valeur nulle", () => {
    expect(formatLatency(null)).toBe("—");
  });
});

describe("cn", () => {
  it("filtre les valeurs falsy et joint le reste", () => {
    expect(cn("a", false, "b", undefined, null, "c")).toBe("a b c");
  });
});
