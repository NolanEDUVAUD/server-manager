import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Services } from "./Services";
import { useStore } from "../stores/useStore";
import { setLanguage } from "../i18n";
import { Probe, ProbeResult, Server } from "../types";
import { EMPTY_FILTERS } from "../utils/filters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

const minipc = { id: "srv1", name: "minipc", ip: "192.168.1.20", os_type: "Linux" } as Server;
const probe: Probe = {
  id: "p1", name: "minipc cert", enabled: true, server_id: "srv1", interval_secs: 60, verify_tls: false, auth: { type: "None" },
  kind: { type: "TlsExpiry", host: "192.168.1.20", port: 8920, warn_days: 14 },
};
const result: ProbeResult = { probe_id: "p1", ok: true, latency_ms: 12, detail: "OK", checked_at: 0, cert_days_left: 80, uptime_percent: 100 };

function backend() {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "get_probes") return [probe];
    if (cmd === "get_probe_results") return [result];
    return undefined;
  });
}

async function renderServices() {
  await act(async () => { render(<Services />); });
}

describe("Services — langues", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    backend();
    useStore.setState({ servers: [minipc], tags: [], folders: [], filters: { servers: EMPTY_FILTERS, services: EMPTY_FILTERS } });
  });
  // Démonter avant de revenir au français : sinon le changement de langue re-rend hors act()
  afterEach(() => {
    cleanup();
    setLanguage("fr");
  });

  it("affiche la page en français par défaut", async () => {
    await renderServices();
    expect(screen.getByRole("button", { name: /Sonde manuelle/ })).toBeInTheDocument();
    expect(await screen.findByText("Certificat 192.168.1.20:8920 (alerte < 14 j)")).toBeInTheDocument();
    expect(screen.getByText(/dispo 24 h 100 %/)).toBeInTheDocument();
  });

  it("affiche la page, la sonde et le catalogue en anglais", async () => {
    setLanguage("en");
    await renderServices();
    expect(screen.getByRole("button", { name: /Manual probe/ })).toBeInTheDocument();
    expect(await screen.findByText("Certificate 192.168.1.20:8920 (alert < 14 d)")).toBeInTheDocument();
    expect(screen.getByText(/24 h uptime 100 %/)).toBeInTheDocument();
    expect(screen.getByTitle("Test now")).toBeInTheDocument();

    // Catalogue : catégories et conseils résolus à l'affichage, dans la langue active
    fireEvent.click(screen.getByRole("button", { name: /Add a service/ }));
    expect(screen.getByText("Home automation")).toBeInTheDocument();
    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search for a service"), { target: { value: "media" } });
    expect(screen.getByText("Jellyfin", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Home Assistant")).toBeNull();
    fireEvent.click(screen.getByText("Jellyfin", { selector: "span" }));
    expect(screen.getByText("No credentials required.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New probe" })).toBeInTheDocument();
  });

  it("suit un changement de langue sans être remonté", async () => {
    await renderServices();
    expect(screen.getByRole("button", { name: /Ajouter un service/ })).toBeInTheDocument();
    act(() => setLanguage("en"));
    expect(screen.getByRole("button", { name: /Add a service/ })).toBeInTheDocument();
    expect(screen.getByText("Certificate 192.168.1.20:8920 (alert < 14 d)")).toBeInTheDocument();
  });
});
