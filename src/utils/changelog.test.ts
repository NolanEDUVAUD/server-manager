import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, getChangesBetween, getCurrentChangelogVersion } from "./changelog";

describe("changelog utilities", () => {
  describe("parseVersion", () => {
    it("parses valid semantic versions", () => {
      expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
      expect(parseVersion("0.0.0")).toEqual([0, 0, 0]);
      expect(parseVersion("10.20.30")).toEqual([10, 20, 30]);
    });

    it("returns null for invalid versions", () => {
      expect(parseVersion("1.2")).toBeNull();
      expect(parseVersion("1.2.3.4")).toBeNull();
      expect(parseVersion("a.b.c")).toBeNull();
      expect(parseVersion("")).toBeNull();
    });
  });

  describe("compareVersions", () => {
    it("returns -1 when a < b", () => {
      expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
      expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
    });

    it("returns 0 when a === b", () => {
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
      expect(compareVersions("0.0.0", "0.0.0")).toBe(0);
    });

    it("returns 1 when a > b", () => {
      expect(compareVersions("0.2.0", "0.1.0")).toBe(1);
      expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
      expect(compareVersions("1.2.1", "1.2.0")).toBe(1);
    });

    it("returns 0 for invalid versions", () => {
      expect(compareVersions("invalid", "1.2.3")).toBe(0);
      expect(compareVersions("1.2.3", "invalid")).toBe(0);
    });
  });

  describe("getChangesBetween", () => {
    it("returns empty array when fromVersion is undefined", () => {
      expect(getChangesBetween(undefined, "0.4.0")).toEqual([]);
    });

    it("returns changes between two versions", () => {
      const changes = getChangesBetween("0.3.0", "0.4.0");
      expect(changes.length).toBeGreaterThan(0);
      expect(changes[0]?.version).toBe("0.4.0");
    });

    it("excludes changes older than fromVersion", () => {
      const changes = getChangesBetween("0.4.0", "0.4.0");
      expect(changes).toEqual([]);
    });

    it("includes the toVersion entry", () => {
      const changes = getChangesBetween("0.2.0", "0.4.0");
      const versions = changes.map((c) => c.version);
      expect(versions).toContain("0.4.0");
    });
  });

  describe("getCurrentChangelogVersion", () => {
    it("returns the first version in changelog", () => {
      const version = getCurrentChangelogVersion();
      expect(version).toBe("0.4.0");
    });
  });
});
