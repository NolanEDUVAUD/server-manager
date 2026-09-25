import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore, METRICS_HISTORY_MAX } from "./useStore";
import { ServerMetrics } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const metrics: ServerMetrics = {
  cpu_percent: 25,
  mem_total_bytes: 1000,
  mem_used_bytes: 400,
  uptime_secs: 60,
  load_avg: [0.1, 0.2, 0.3],
  disks: [],
};

describe("metrics store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useStore.setState({ metrics: {}, metricsErrors: {}, metricsHistory: {} });
  });

  it("fetchMetrics enregistre les métriques et un point d'historique en %", async () => {
    vi.mocked(invoke).mockResolvedValue(metrics);

    await useStore.getState().fetchMetrics("srv");

    expect(invoke).toHaveBeenCalledWith("get_server_metrics", { serverId: "srv" });
    expect(useStore.getState().metrics.srv).toEqual(metrics);
    const history = useStore.getState().metricsHistory.srv;
    expect(history).toHaveLength(1);
    expect(history[0].cpu).toBe(25);
    expect(history[0].mem).toBe(40);
  });

  it("fetchMetrics en échec mémorise l'erreur et retire les valeurs périmées", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(metrics).mockRejectedValueOnce("Mot de passe incorrect");

    await useStore.getState().fetchMetrics("srv");
    await useStore.getState().fetchMetrics("srv");

    expect(useStore.getState().metricsErrors.srv).toBe("Mot de passe incorrect");
    expect(useStore.getState().metrics.srv).toBeUndefined();
    // L'historique déjà collecté reste affichable
    expect(useStore.getState().metricsHistory.srv).toHaveLength(1);
  });

  it("un succès efface l'erreur précédente", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("timeout").mockResolvedValueOnce(metrics);

    await useStore.getState().fetchMetrics("srv");
    await useStore.getState().fetchMetrics("srv");

    expect(useStore.getState().metricsErrors.srv).toBeUndefined();
  });

  it("l'historique est borné", async () => {
    vi.mocked(invoke).mockResolvedValue(metrics);
    for (let i = 0; i < METRICS_HISTORY_MAX + 5; i++) {
      await useStore.getState().fetchMetrics("srv");
    }
    expect(useStore.getState().metricsHistory.srv).toHaveLength(METRICS_HISTORY_MAX);
  });
});
