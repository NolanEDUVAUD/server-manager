import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTERS, NO_FOLDER, ItemFilters, filterItems, groupByFolder, hasActiveFilters, matchesFilters,
  serverFilterable, sortFavoritesFirst, withoutFolder, withoutTag,
} from "./filters";
import { Folder, Server, ServerStatus, Tag } from "../types";

const tags: Tag[] = [
  { id: "t-prod", name: "Production", color: "#ef4444" },
  { id: "t-media", name: "Média", color: "#22c55e" },
];
const folders: Folder[] = [
  { id: "f-maison", name: "Maison" },
  { id: "f-lab", name: "Lab" },
];

function server(id: string, extra: Partial<Server> = {}): Server {
  return {
    id, name: id, ip: "192.168.1.10", mac_address: "02:00:00:00:00:01", ssh_user: "root", ssh_password: "",
    ssh_port: 22, shutdown_command: "", reboot_command: "", os_type: "Linux", ...extra,
  };
}

const servers: Server[] = [
  server("minipc", { ip: "192.168.1.10", tag_ids: ["t-prod"], folder_id: "f-lab", notes: "Hyperviseur principal" }),
  server("Workstation", { ip: "192.168.1.11", os_type: "Windows", favorite: true, custom_fields: [{ key: "Emplacement", value: "Bureau étage" }] }),
  server("DockerHost", { ip: "192.168.1.12", tag_ids: ["t-prod", "t-media"], folder_id: "f-maison", favorite: true }),
  server("FwNode", { ip: "192.168.1.1", folder_id: "dossier-supprime" }),
];
const statuses: Record<string, ServerStatus> = {
  minipc: { online: true, latency_ms: 2, last_checked: 0 },
  Workstation: { online: false, latency_ms: null, last_checked: 0 },
  DockerHost: { online: true, latency_ms: 3, last_checked: 0 },
  // FwNode : statut inconnu
};

const run = (patch: Partial<ItemFilters>) =>
  filterItems(servers, { ...EMPTY_FILTERS, ...patch }, (s) => serverFilterable(s, { tags, folders }, statuses[s.id])).map((s) => s.name);

describe("filtres combinés", () => {
  it("sans filtre : tout, favoris en tête dans l'ordre d'origine", () => {
    expect(run({})).toEqual(["Workstation", "DockerHost", "minipc", "FwNode"]);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("texte : nom, IP, OS, notes, valeurs des champs personnalisés et noms des tags", () => {
    expect(run({ text: "mini" })).toEqual(["minipc"]);
    expect(run({ text: "192.168.1.1" })).toEqual(["Workstation", "DockerHost", "minipc", "FwNode"]);
    expect(run({ text: "192.168.1.12" })).toEqual(["DockerHost"]);
    expect(run({ text: "windows" })).toEqual(["Workstation"]);
    expect(run({ text: "hyperviseur" })).toEqual(["minipc"]);
    expect(run({ text: "bureau" })).toEqual(["Workstation"]);
    expect(run({ text: "production" })).toEqual(["DockerHost", "minipc"]);
    // Clé d'un champ personnalisé : pas recherchée (seulement les valeurs)
    expect(run({ text: "emplacement" })).toEqual([]);
  });

  it("texte : insensible à la casse et aux accents, plusieurs mots = ET", () => {
    expect(run({ text: "MEDIA" })).toEqual(["DockerHost"]);
    expect(run({ text: "etage" })).toEqual(["Workstation"]);
    expect(run({ text: "ÉTAGE bureau" })).toEqual(["Workstation"]);
    expect(run({ text: "bureau hyperviseur" })).toEqual([]);
    expect(run({ text: "   " })).toHaveLength(4);
  });

  it("tags : plusieurs tags = ET logique", () => {
    expect(run({ tagIds: ["t-prod"] })).toEqual(["DockerHost", "minipc"]);
    expect(run({ tagIds: ["t-prod", "t-media"] })).toEqual(["DockerHost"]);
    expect(run({ tagIds: ["t-media", "inconnu"] })).toEqual([]);
  });

  it("dossier : un dossier précis ou « sans dossier » (dossier inconnu compris)", () => {
    expect(run({ folderId: "f-lab" })).toEqual(["minipc"]);
    expect(run({ folderId: NO_FOLDER })).toEqual(["Workstation", "FwNode"]);
  });

  it("favoris seulement", () => {
    expect(run({ favoritesOnly: true })).toEqual(["Workstation", "DockerHost"]);
  });

  it("statut : un statut inconnu n'est ni en ligne ni hors ligne", () => {
    expect(run({ status: "online" })).toEqual(["DockerHost", "minipc"]);
    expect(run({ status: "offline" })).toEqual(["Workstation"]);
  });

  it("critères combinés", () => {
    expect(run({ status: "online", favoritesOnly: true })).toEqual(["DockerHost"]);
    expect(run({ status: "online", tagIds: ["t-prod"], folderId: "f-lab", text: "HYPER" })).toEqual(["minipc"]);
    expect(run({ status: "offline", tagIds: ["t-prod"] })).toEqual([]);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, status: "offline" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, folderId: NO_FOLDER })).toBe(true);
  });

  it("un tag ou un dossier supprimé sort des filtres", () => {
    const f: ItemFilters = { ...EMPTY_FILTERS, tagIds: ["t-prod", "t-media"], folderId: "f-lab" };
    expect(withoutTag(f, "t-prod").tagIds).toEqual(["t-media"]);
    expect(withoutFolder(f, "f-lab").folderId).toBeNull();
    expect(withoutFolder(f, "f-maison")).toBe(f);
  });
});

describe("tri et regroupement", () => {
  it("tri favoris d'abord, stable", () => {
    const items = [{ n: "a" }, { n: "b", f: true }, { n: "c" }, { n: "d", f: true }];
    expect(sortFavoritesFirst(items, (i) => !!i.f).map((i) => i.n)).toEqual(["b", "d", "a", "c"]);
    expect(sortFavoritesFirst([], () => true)).toEqual([]);
  });

  it("regroupement par dossier : ordre alphabétique, « Sans dossier » à la fin, sections vides omises", () => {
    const sections = groupByFolder(run({}).map((n) => servers.find((s) => s.name === n)!), [...folders, { id: "f-vide", name: "Vide" }], (s) => s.folder_id);
    expect(sections.map((s) => s.folder?.name ?? "Sans dossier")).toEqual(["Lab", "Maison", "Sans dossier"]);
    expect(sections[2].items.map((s) => s.name)).toEqual(["Workstation", "FwNode"]);
  });
});
