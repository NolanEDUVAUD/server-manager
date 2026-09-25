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
  temperatures: [],
  cpu_temp_celsius: null,
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

  it("loadRecentMetrics recharge les courbes enregistrées en base", async () => {
    useStore.setState({ metricsHistory: { live: [{ t: 100_000, cpu: 9, mem: 9 }] } });
    vi.mocked(invoke).mockResolvedValue({
      srv: [{ t: 1000, cpu: 10, mem: 20 }, { t: 2000, cpu: 30, mem: 40 }],
      live: [{ t: 50_000, cpu: 1, mem: 1 }, { t: 99_500, cpu: 2, mem: 2 }],
    });

    await useStore.getState().loadRecentMetrics();

    expect(invoke).toHaveBeenCalledWith("get_recent_metrics", { limit: METRICS_HISTORY_MAX });
    const h = useStore.getState().metricsHistory;
    expect(h.srv.map((s) => s.cpu)).toEqual([10, 30]);
    // Le point 99 500 de la base est la collecte déjà reçue en direct (100 000)
    expect(h.live.map((s) => s.t)).toEqual([50_000, 100_000]);
  });

  it("loadRecentMetrics sans réponse ne change rien", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await useStore.getState().loadRecentMetrics();
    expect(useStore.getState().metricsHistory).toEqual({});
  });
});
