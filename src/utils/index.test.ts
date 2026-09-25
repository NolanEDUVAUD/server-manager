import { describe, it, expect } from "vitest";
import { formatLatency, cn, formatBytes, formatUptime, appendSample, mergeSamples } from "./index";

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

describe("mergeSamples", () => {
  const sample = (t: number) => ({ t, cpu: t, mem: t });

  it("reprend les points de la base quand rien n'a encore été reçu", () => {
    expect(mergeSamples([sample(3000), sample(1000)], undefined, 10).map((s) => s.t)).toEqual([1000, 3000]);
  });

  it("ne duplique pas la collecte déjà reçue en direct", () => {
    // Le point 10 000 de la base correspond au point 10 500 reçu en direct (horloges décalées)
    const merged = mergeSamples([sample(5000), sample(10000)], [sample(10500), sample(25500)], 10);
    expect(merged.map((s) => s.t)).toEqual([5000, 10500, 25500]);
  });

  it("garde les points les plus récents au-delà de la limite", () => {
    const loaded = [1, 2, 3, 4].map((i) => sample(i * 10000));
    expect(mergeSamples(loaded, [sample(60000)], 3).map((s) => s.t)).toEqual([30000, 40000, 60000]);
  });

  it("accepte une réponse vide", () => {
    expect(mergeSamples(undefined, [sample(1)], 3)).toEqual([sample(1)]);
  });
});
