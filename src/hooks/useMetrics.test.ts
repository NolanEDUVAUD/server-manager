import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMetrics, supportsMetrics } from "./useMetrics";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

// Capture du gestionnaire enregistré via listen() pour simuler les événements du backend
let handler: ((e: { payload: unknown }) => void) | null = null;
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_name: string, cb: (e: { payload: unknown }) => void) => {
    handler = cb;
    return Promise.resolve(() => {});
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const metrics = {
  cpu_percent: 12, mem_total_bytes: 100, mem_used_bytes: 25, uptime_secs: 1,
  load_avg: [0, 0, 0] as [number, number, number], disks: [], temperatures: [], cpu_temp_celsius: null,
};

describe("useMetrics", () => {
  beforeEach(() => {
    handler = null;
    useStore.setState({ metrics: {}, metricsErrors: {}, metricsHistory: {} });
  });

  it("range les métriques reçues du backend", () => {
    renderHook(() => useMetrics());
    handler!({ payload: { server_id: "s", metrics, error: null } });

    expect(useStore.getState().metrics.s).toEqual(metrics);
    expect(useStore.getState().metricsHistory.s[0].mem).toBe(25);
  });

  it("mémorise l'erreur d'une collecte en échec", () => {
    renderHook(() => useMetrics());
    handler!({ payload: { server_id: "s", metrics: null, error: "Timeout" } });

    expect(useStore.getState().metricsErrors.s).toBe("Timeout");
  });

  it("exclut Windows et ESXi", () => {
    const srv = (os_type: Server["os_type"]) => ({ os_type } as Server);
    expect(supportsMetrics(srv("Linux"))).toBe(true);
    expect(supportsMetrics(srv("Windows"))).toBe(false);
    expect(supportsMetrics(srv("ESXi"))).toBe(false);
  });
});
