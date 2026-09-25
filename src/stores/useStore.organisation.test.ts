import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "./useStore";
import { Server } from "../types";
import { EMPTY_FILTERS } from "../utils/filters";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const srv = (id: string, extra: Partial<Server> = {}) => ({ id, name: id, ip: "192.168.1.10", ...extra }) as Server;

describe("organisation store", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useStore.setState({
      tags: [{ id: "t1", name: "Prod", color: "#ef4444" }, { id: "t2", name: "Média", color: "#22c55e" }],
      folders: [{ id: "f1", name: "Lab" }],
      servers: [srv("minipc", { tag_ids: ["t1", "t2"], folder_id: "f1" }), srv("DockerHost", { tag_ids: ["t2"] })],
      filters: { servers: EMPTY_FILTERS, services: EMPTY_FILTERS },
    });
  });

  it("charge tags et dossiers", async () => {
    vi.mocked(invoke).mockResolvedValue({ tags: [], folders: [{ id: "f2", name: "Maison" }] });
    await useStore.getState().loadOrganisation();
    expect(invoke).toHaveBeenCalledWith("get_organisation");
    expect(useStore.getState().tags).toEqual([]);
    expect(useStore.getState().folders).toEqual([{ id: "f2", name: "Maison" }]);
  });

  it("supprimer un tag le retire des serveurs et des filtres", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useStore.getState().setFilters("servers", { tagIds: ["t1", "t2"] });
    useStore.getState().setFilters("services", { tagIds: ["t1"] });
    await useStore.getState().deleteTag("t1");
    expect(invoke).toHaveBeenCalledWith("delete_tag", { id: "t1" });
    const s = useStore.getState();
    expect(s.tags.map((t) => t.id)).toEqual(["t2"]);
    expect(s.servers.map((x) => x.tag_ids)).toEqual([["t2"], ["t2"]]);
    expect(s.filters.servers.tagIds).toEqual(["t2"]);
    expect(s.filters.services.tagIds).toEqual([]);
  });

  it("supprimer un dossier remet ses serveurs « sans dossier » et réinitialise le filtre", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    useStore.getState().setFilters("servers", { folderId: "f1" });
    await useStore.getState().deleteFolder("f1");
    const s = useStore.getState();
    expect(s.folders).toEqual([]);
    expect(s.servers[0].folder_id).toBeNull();
    expect(s.servers).toHaveLength(2);
    expect(s.filters.servers.folderId).toBeNull();
  });

  it("enregistrer un tag l'ajoute ou le remplace", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ id: "t3", name: "Lab", color: "#3b82f6" });
    await useStore.getState().saveTag({ id: "", name: "Lab", color: "#3b82f6" });
    vi.mocked(invoke).mockResolvedValueOnce({ id: "t1", name: "PROD", color: "#000000" });
    await useStore.getState().saveTag({ id: "t1", name: "PROD", color: "#000000" });
    expect(useStore.getState().tags.map((t) => t.name)).toEqual(["PROD", "Média", "Lab"]);
  });

  it("basculer un favori met à jour le serveur", async () => {
    vi.mocked(invoke).mockResolvedValue(true);
    expect(await useStore.getState().toggleFavorite("server", "DockerHost")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("toggle_favorite", { kind: "server", id: "DockerHost" });
    expect(useStore.getState().servers[1].favorite).toBe(true);
  });

  it("les filtres de chaque page sont indépendants et conservés jusqu'à « Effacer »", () => {
    const { setFilters, clearFilters } = useStore.getState();
    setFilters("servers", { text: "mini", favoritesOnly: true });
    setFilters("services", { status: "offline" });
    expect(useStore.getState().filters.servers).toEqual({ ...EMPTY_FILTERS, text: "mini", favoritesOnly: true });
    expect(useStore.getState().filters.services.status).toBe("offline");
    clearFilters("servers");
    expect(useStore.getState().filters.servers).toEqual(EMPTY_FILTERS);
    expect(useStore.getState().filters.services.status).toBe("offline");
  });
});
