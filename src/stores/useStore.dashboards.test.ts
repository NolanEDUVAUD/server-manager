import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./useStore";
import { DashboardTab } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const tabA: DashboardTab = { label: "conn-a", connectionId: "conn-a", url: "https://a:8006", title: "A" };
const tabB: DashboardTab = { label: "conn-b", connectionId: "conn-b", url: "https://b:8006", title: "B" };

describe("dashboard tabs store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    useStore.setState({ dashboardTabs: [], activeDashboardTabLabel: null });
  });

  it("openDashboardTab ajoute l'onglet et l'active", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);

    expect(useStore.getState().dashboardTabs).toEqual([tabA]);
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-a");
    expect(invoke).toHaveBeenCalledWith("open_dashboard_tab", {
      label: "conn-a",
      url: tabA.url,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
  });

  it("openDashboardTab cache l'onglet précédemment actif avant d'ouvrir le nouveau", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    vi.mocked(invoke).mockClear();

    await useStore.getState().openDashboardTab(tabB, 0, 0, 100, 100);

    expect(invoke).toHaveBeenCalledWith("set_dashboard_tab_visible", { label: "conn-a", visible: false });
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-b");
  });

  it("setActiveDashboardTab ne fait rien si l'onglet demandé est déjà actif", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    vi.mocked(invoke).mockClear();

    await useStore.getState().setActiveDashboardTab("conn-a");

    expect(invoke).not.toHaveBeenCalled();
  });

  it("closeDashboardTab retire l'onglet et active le suivant s'il était actif", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);
    await useStore.getState().openDashboardTab(tabB, 0, 0, 100, 100);

    await useStore.getState().closeDashboardTab("conn-b");

    expect(useStore.getState().dashboardTabs).toEqual([tabA]);
    expect(useStore.getState().activeDashboardTabLabel).toBe("conn-a");
  });

  it("closeDashboardTab passe à null si c'était le dernier onglet", async () => {
    await useStore.getState().openDashboardTab(tabA, 0, 0, 100, 100);

    await useStore.getState().closeDashboardTab("conn-a");

    expect(useStore.getState().dashboardTabs).toEqual([]);
    expect(useStore.getState().activeDashboardTabLabel).toBeNull();
  });
});
