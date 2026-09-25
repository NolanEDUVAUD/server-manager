import { describe, it, expect } from "vitest";
import { nextRun, formatDays } from "./schedule";

// 2026-09-25 est un vendredi (jour 4, lundi = 0)
const friday = (h: number, m: number) => new Date(2026, 8, 25, h, m, 0);

describe("nextRun", () => {
  it("plus tard dans la journée", () => {
    expect(nextRun({ days: [4], time: "23:00" }, friday(10, 0))).toEqual(new Date(2026, 8, 25, 23, 0));
  });

  it("le lendemain si l'heure est passée", () => {
    expect(nextRun({ days: [4, 5], time: "07:30" }, friday(10, 0))).toEqual(new Date(2026, 8, 26, 7, 30));
  });

  it("la semaine suivante pour le même jour", () => {
    expect(nextRun({ days: [4], time: "07:30" }, friday(10, 0))).toEqual(new Date(2026, 9, 2, 7, 30));
  });

  it("null sans jour ou avec une heure invalide", () => {
    expect(nextRun({ days: [], time: "07:30" }, friday(10, 0))).toBeNull();
    expect(nextRun({ days: [1], time: "7h" }, friday(10, 0))).toBeNull();
  });
});

describe("formatDays", () => {
  it("résume les plages courantes", () => {
    expect(formatDays([0, 1, 2, 3, 4, 5, 6])).toBe("Tous les jours");
    expect(formatDays([0, 1, 2, 3, 4])).toBe("En semaine");
    expect(formatDays([5, 6])).toBe("Le week-end");
    expect(formatDays([0, 2, 4])).toBe("Lun, Mer, Ven");
  });
});
