import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { HistorySettingsPanel, retentionError } from "./HistorySettingsPanel";
import { useStore } from "../stores/useStore";
import { HistoryInfo } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const info: HistoryInfo = {
  path: "/tmp/history.db",
  persistent: true,
  size_bytes: 3 * 1024 * 1024,
  schema_version: 1,
  events: 12,
  ping_samples: 100,
  probe_samples: 20,
  metric_samples: 30,
  hourly_rows: 8,
  oldest_ts: Date.UTC(2026, 8, 1),
  warning: null,
};

describe("retentionError", () => {
  it("applique les mêmes bornes que le backend", () => {
    expect(retentionError({ raw_days: 7, hourly_days: 90, event_days: 90 })).toBeNull();
    expect(retentionError({ raw_days: 0, hourly_days: 90, event_days: 90 })).toMatch(/Mesures/);
    expect(retentionError({ raw_days: 20, hourly_days: 10, event_days: 90 })).toMatch(/au moins aussi longtemps/);
    expect(retentionError({ raw_days: 7, hourly_days: 90, event_days: 5000 })).toMatch(/Événements/);
    expect(retentionError({ raw_days: 1.5, hourly_days: 90, event_days: 90 })).toMatch(/Mesures/);
  });
});

describe("HistorySettingsPanel", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useStore.setState((s) => ({ settings: { ...s.settings, history: { raw_days: 7, hourly_days: 90, event_days: 90 } } }));
  });

  it("affiche l'état de la base", async () => {
    vi.mocked(invoke).mockResolvedValue(info);
    render(<HistorySettingsPanel />);
    expect(await screen.findByText("3 Mo")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("get_history_info");
  });

  it("affiche une erreur lisible si la base est illisible", async () => {
    vi.mocked(invoke).mockRejectedValue("Base d'historique : disque plein");
    render(<HistorySettingsPanel />);
    expect(await screen.findByText(/disque plein/)).toBeInTheDocument();
  });

  it("refuse une rétention invalide et enregistre une rétention valide", async () => {
    vi.mocked(invoke).mockResolvedValue(info);
    render(<HistorySettingsPanel />);
    const save = screen.getByRole("button", { name: "Sauvegarder" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Mesures détaillées (jours)"), { target: { value: "40" } });
    expect(screen.getByRole("alert")).toHaveTextContent("entre 1 et 31");
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Mesures détaillées (jours)"), { target: { value: "14" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_settings", expect.objectContaining({
        settings: expect.objectContaining({ history: { raw_days: 14, hourly_days: 90, event_days: 90 } }),
      }))
    );
  });

  it("la purge immédiate passe par une confirmation explicite", async () => {
    vi.mocked(invoke).mockImplementation(async (cmd) =>
      cmd === "prune_history" ? { raw_rows: 5, hourly_rows: 0, events: 1 } : info
    );
    render(<HistorySettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Appliquer maintenant/ }));
    expect(invoke).not.toHaveBeenCalledWith("prune_history");
    expect(screen.getByText(/plus de 7 jour\(s\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("prune_history"));
    expect(await screen.findByText(/5 mesure\(s\)/)).toBeInTheDocument();
  });
});
