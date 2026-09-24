import { describe, it, expect } from "vitest";
import { formatLatency, cn, formatBytes } from "./index";

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

describe("formatBytes", () => {
  it("affiche les Mo en dessous de 1 Go", () => {
    expect(formatBytes(536870912)).toBe("512 Mo");
  });

  it("affiche les Go au-dessus de 1 Go", () => {
    expect(formatBytes(1073741824)).toBe("1.0 Go");
  });
});
