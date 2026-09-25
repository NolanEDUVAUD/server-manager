import { describe, it, expect, vi } from "vitest";
import {
  createActivityThrottle,
  formatIdle,
  formatWait,
  isLockShortcut,
  masterPasswordError,
  pinError,
  unlockMode,
} from "./lock";
import { LockStatus } from "../types";

const status = (patch: Partial<LockStatus>): LockStatus => ({
  enabled: true,
  locked: true,
  method: "Pin",
  has_pin: true,
  master_password: false,
  idle_minutes: 10,
  lock_on_session_lock: true,
  hello_available: false,
  session_detection: true,
  retry_after_ms: 0,
  ...patch,
});

describe("unlockMode", () => {
  it("le mot de passe maître l'emporte sur Hello et le PIN", () => {
    expect(unlockMode(status({ master_password: true, method: "Hello" }))).toBe("password");
    expect(unlockMode(status({ master_password: true, method: "None" }))).toBe("password");
  });

  it("Hello ou PIN selon la méthode", () => {
    expect(unlockMode(status({ method: "Hello" }))).toBe("hello");
    expect(unlockMode(status({ method: "Pin" }))).toBe("pin");
  });
});

describe("validation", () => {
  it("PIN de 4 à 12 chiffres, confirmation identique", () => {
    expect(pinError("4821")).toBeNull();
    expect(pinError("123456789012")).toBeNull();
    expect(pinError("123")).toMatch(/4 à 12/);
    expect(pinError("1234567890123")).not.toBeNull();
    expect(pinError("12a4")).not.toBeNull();
    expect(pinError("4821", "4822")).toMatch(/correspondent/);
    expect(pinError("4821", "4821")).toBeNull();
  });

  it("mot de passe maître : longueur et confirmation", () => {
    expect(masterPasswordError("court", "court")).toMatch(/8 caractères/);
    expect(masterPasswordError("          ", "          ")).not.toBeNull();
    expect(masterPasswordError("une phrase", "une phrasE")).toMatch(/correspondent/);
    expect(masterPasswordError("une phrase", "une phrase")).toBeNull();
    expect(masterPasswordError("x".repeat(257), "x".repeat(257))).toMatch(/256/);
  });
});

describe("formats", () => {
  it("attente et délai d'inactivité lisibles", () => {
    expect(formatWait(4_200)).toBe("5 s");
    expect(formatWait(125_000)).toBe("2 min 5 s");
    expect(formatWait(300_000)).toBe("5 min");
    expect(formatIdle(0)).toBe("Jamais");
    expect(formatIdle(15)).toBe("15 min");
    expect(formatIdle(120)).toBe("2 h");
    expect(formatIdle(90)).toBe("1 h 30 min");
  });
});

describe("createActivityThrottle", () => {
  it("n'envoie l'activité qu'une fois par intervalle (horloge injectée)", () => {
    let now = 1_000;
    const send = vi.fn();
    const report = createActivityThrottle(send, 20_000, () => now);
    report();
    report();
    now += 19_999;
    report();
    expect(send).toHaveBeenCalledTimes(1);
    now += 1;
    report();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("isLockShortcut", () => {
  it("Ctrl+Maj+L seulement (Ctrl+L reste au shell)", () => {
    const k = (p: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "l", ...p });
    expect(isLockShortcut(k({ ctrlKey: true, shiftKey: true, key: "L" }))).toBe(true);
    expect(isLockShortcut(k({ ctrlKey: true }))).toBe(false);
    expect(isLockShortcut(k({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isLockShortcut(k({ shiftKey: true }))).toBe(false);
  });
});
