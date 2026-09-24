import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProxmoxStatus } from "./useProxmoxStatus";
import { useStore } from "../stores/useStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("useProxmoxStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useStore.setState({
      proxmoxConnections: [
        { id: "conn-1", name: "PVE1", api_url: "https://pve1:8006", token_id: "t", token_secret: "", verify_tls: false },
      ],
      settings: {
        ...useStore.getState().settings,
        network: { ...useStore.getState().settings.network, proxmox_poll_interval_secs: 15 },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("charge les VMs de chaque connexion au montage", async () => {
    const loadProxmoxVms = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadProxmoxVms });

    renderHook(() => useProxmoxStatus());

    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledWith("conn-1"));
  });

  it("relance le chargement à l'intervalle configuré", async () => {
    const loadProxmoxVms = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ loadProxmoxVms });

    renderHook(() => useProxmoxStatus());
    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledTimes(1));

    vi.advanceTimersByTime(15000);
    await waitFor(() => expect(loadProxmoxVms).toHaveBeenCalledTimes(2));
  });
});
