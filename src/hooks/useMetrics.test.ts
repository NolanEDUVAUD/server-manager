import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMetrics } from "./useMetrics";
import { useStore } from "../stores/useStore";
import { Server } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function server(id: string, os_type: Server["os_type"]): Server {
  return {
    id, name: id, ip: "10.0.0.1", mac_address: "", ssh_user: "root", ssh_password: "",
    ssh_port: 22, shutdown_command: "", reboot_command: "", os_type,
  };
}

const online = { online: true, latency_ms: 1, last_checked: 0 };

function setNetwork(patch: Partial<ReturnType<typeof useStore.getState>["settings"]["network"]>) {
  const settings = useStore.getState().settings;
  useStore.setState({ settings: { ...settings, network: { ...settings.network, ...patch } } });
}

describe("useMetrics", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      servers: [server("lin", "Linux"), server("win", "Windows"), server("off", "TrueNAS")],
      statuses: { lin: online, win: online, off: { ...online, online: false } },
    });
    setNetwork({ metrics_enabled: true, metrics_interval_secs: 15 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ne collecte que les serveurs en ligne et compatibles", async () => {
    const fetchMetrics = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ fetchMetrics });

    renderHook(() => useMetrics());
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchMetrics).toHaveBeenCalledTimes(1);
    expect(fetchMetrics).toHaveBeenCalledWith("lin");
  });

  it("ne relance pas une collecte encore en cours", async () => {
    // Collecte qui ne se termine jamais : simule un serveur qui ne répond pas
    const fetchMetrics = vi.fn().mockReturnValue(new Promise(() => {}));
    useStore.setState({ fetchMetrics });

    renderHook(() => useMetrics());
    await vi.advanceTimersByTimeAsync(3000 + 15000 * 2);

    expect(fetchMetrics).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si le monitoring est désactivé", async () => {
    const fetchMetrics = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ fetchMetrics });
    setNetwork({ metrics_enabled: false });

    renderHook(() => useMetrics());
    await vi.advanceTimersByTimeAsync(60000);

    expect(fetchMetrics).not.toHaveBeenCalled();
  });
});
