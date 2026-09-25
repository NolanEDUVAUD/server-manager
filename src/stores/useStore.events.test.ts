import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./useStore";
import { AppEvent } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const ev = (id: string, ts: number): AppEvent => ({
  id, ts, kind: "Offline", server_id: "s", target: "minipc", message: "Ne répond plus au ping",
});

describe("events store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useStore.setState({ events: [] });
  });

  it("loadEvents charge l'historique (du plus récent au plus ancien)", async () => {
    vi.mocked(invoke).mockResolvedValue([ev("2", 2), ev("1", 1)]);

    await useStore.getState().loadEvents();

    expect(invoke).toHaveBeenCalledWith("get_events");
    expect(useStore.getState().events.map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("addEvent insère un événement reçu en direct en tête, sans doublon", () => {
    useStore.setState({ events: [ev("1", 1)] });

    useStore.getState().addEvent(ev("2", 2));
    useStore.getState().addEvent(ev("2", 2));

    expect(useStore.getState().events.map((e) => e.id)).toEqual(["2", "1"]);
  });

  it("clearEvents vide l'historique côté backend et frontend", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useStore.setState({ events: [ev("1", 1)] });

    await useStore.getState().clearEvents();

    expect(invoke).toHaveBeenCalledWith("clear_events");
    expect(useStore.getState().events).toEqual([]);
  });
});
