import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDashboardTabSync } from "./useDashboardTabSync";
import { useStore } from "../stores/useStore";

describe("useDashboardTabSync", () => {
  let observeCallback: (() => void) | null = null;

  beforeEach(() => {
    observeCallback = null;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      constructor(cb: () => void) {
        observeCallback = cb;
      }
      observe() {}
      disconnect() {}
    };
  });

  it("appelle resizeDashboardTab avec les coordonnées mesurées au montage", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: "conn-1", resizeDashboardTab });

    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 300,
      height: 400,
    } as DOMRect);
    const ref = { current: el };

    renderHook(() => useDashboardTabSync(ref));

    expect(resizeDashboardTab).toHaveBeenCalledWith("conn-1", 10, 20, 300, 400);
  });

  it("re-synchronise quand ResizeObserver se déclenche", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: "conn-1", resizeDashboardTab });

    const el = document.createElement("div");
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
    } as DOMRect);
    const ref = { current: el };

    renderHook(() => useDashboardTabSync(ref));
    resizeDashboardTab.mockClear();

    observeCallback?.();

    expect(resizeDashboardTab).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si aucun onglet n'est actif", () => {
    const resizeDashboardTab = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ activeDashboardTabLabel: null, resizeDashboardTab });

    const ref = { current: document.createElement("div") };

    renderHook(() => useDashboardTabSync(ref));

    expect(resizeDashboardTab).not.toHaveBeenCalled();
  });
});
