import { describe, it, expect } from "vitest";
import { formatLatency, cn, formatBytes, formatUptime, appendSample } from "./index";

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

  it("affiche les To au-dessus de 1024 Go", () => {
    expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 To");
  });
});

describe("formatUptime", () => {
  it("affiche jours et heures", () => {
    expect(formatUptime(93784)).toBe("1 j 2 h");
  });

  it("affiche heures et minutes sous 1 jour", () => {
    expect(formatUptime(3 * 3600 + 5 * 60)).toBe("3 h 5 min");
  });

  it("affiche les minutes sous 1 heure", () => {
    expect(formatUptime(59)).toBe("0 min");
  });
});

describe("appendSample", () => {
  const sample = (t: number) => ({ t, cpu: t, mem: t });

  it("ajoute le point à la fin sans modifier l'original", () => {
    const history = [sample(1)];
    const next = appendSample(history, sample(2), 5);
    expect(next.map((s) => s.t)).toEqual([1, 2]);
    expect(history).toHaveLength(1);
  });

  it("ne garde que les derniers points au-delà de la limite", () => {
    const history = [sample(1), sample(2), sample(3)];
    expect(appendSample(history, sample(4), 3).map((s) => s.t)).toEqual([2, 3, 4]);
  });

  it("accepte un historique absent", () => {
    expect(appendSample(undefined, sample(1), 3)).toEqual([sample(1)]);
  });
});
