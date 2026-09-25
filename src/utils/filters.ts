/**
 * Recherche et filtres combinés des pages Serveurs et Services : fonctions pures,
 * sans état ni accès au store (testées dans filters.test.ts).
 */
import { Folder, Probe, ProbeResult, Server, ServerStatus, Tag } from "../types";
import { fold } from "./fuzzy";
import { describeProbe } from "./probes";

export type StatusFilter = "all" | "online" | "offline";
export type FilterScope = "servers" | "services";

/** Valeur du filtre de dossier qui désigne les éléments « sans dossier » */
export const NO_FOLDER = "__none__";

export interface ItemFilters {
  /** Texte libre : plusieurs mots = tous doivent apparaître */
  text: string;
  /** Tags exigés (ET logique) */
  tagIds: string[];
  /** null = tous les dossiers, NO_FOLDER = sans dossier, sinon identifiant du dossier */
  folderId: string | null;
  favoritesOnly: boolean;
  status: StatusFilter;
}

export const EMPTY_FILTERS: ItemFilters = { text: "", tagIds: [], folderId: null, favoritesOnly: false, status: "all" };

export function hasActiveFilters(f: ItemFilters): boolean {
  return f.text.trim() !== "" || f.tagIds.length > 0 || f.folderId !== null || f.favoritesOnly || f.status !== "all";
}

/** Vue commune d'un serveur ou d'un service, sur laquelle s'appliquent les filtres */
export interface Filterable {
  /** Textes recherchables (nom, IP, notes, valeurs des champs personnalisés, noms des tags…) */
  text: string[];
  tagIds: string[];
  folderId: string | null;
  favorite: boolean;
  /** undefined = statut inconnu (pas encore vérifié, sonde désactivée) */
  online?: boolean;
}

export function matchesFilters(item: Filterable, f: ItemFilters): boolean {
  if (f.favoritesOnly && !item.favorite) return false;
  // Un statut inconnu ne correspond ni à « en ligne » ni à « hors ligne »
  if (f.status === "online" && item.online !== true) return false;
  if (f.status === "offline" && item.online !== false) return false;
  if (f.folderId === NO_FOLDER && item.folderId) return false;
  if (f.folderId !== null && f.folderId !== NO_FOLDER && item.folderId !== f.folderId) return false;
  if (!f.tagIds.every((t) => item.tagIds.includes(t))) return false;
  const words = fold(f.text).split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    // Séparateur avec espace : un mot ne peut pas chevaucher deux champs
    const haystack = fold(item.text.filter(Boolean).join(" \n "));
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

/** Tri stable : favoris d'abord, l'ordre d'origine est conservé à l'intérieur de chaque partie */
export function sortFavoritesFirst<T>(items: T[], isFavorite: (item: T) => boolean): T[] {
  return items
    .map((item, index) => ({ item, index, fav: isFavorite(item) }))
    .sort((a, b) => Number(b.fav) - Number(a.fav) || a.index - b.index)
    .map((x) => x.item);
}

/** Filtre puis place les favoris en tête */
export function filterItems<T>(items: T[], f: ItemFilters, toFilterable: (item: T) => Filterable): T[] {
  const kept = items.map((item) => ({ item, view: toFilterable(item) })).filter((x) => matchesFilters(x.view, f));
  return sortFavoritesFirst(kept, (x) => x.view.favorite).map((x) => x.item);
}

export interface FolderSection<T> {
  /** null = « Sans dossier » */
  folder: Folder | null;
  items: T[];
}

/**
 * Regroupement à un niveau : dossiers par ordre alphabétique, puis « Sans dossier »
 * (qui reçoit aussi les éléments d'un dossier inconnu). Les sections vides sont omises ;
 * l'ordre des éléments (favoris d'abord) est conservé dans chaque section.
 */
export function groupByFolder<T>(items: T[], folders: Folder[], folderOf: (item: T) => string | null | undefined): FolderSection<T>[] {
  const known = new Set(folders.map((f) => f.id));
  const sections: FolderSection<T>[] = [...folders]
    .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }))
    .map((folder) => ({ folder, items: items.filter((i) => folderOf(i) === folder.id) }));
  sections.push({ folder: null, items: items.filter((i) => !known.has(folderOf(i) ?? "")) });
  return sections.filter((s) => s.items.length > 0);
}

/** Tags et dossiers connus : les références orphelines sont ignorées */
export interface OrganisationContext {
  tags: Tag[];
  folders: Folder[];
}

function tagNames(tags: Tag[], ids: string[]): string[] {
  return ids.map((id) => tags.find((t) => t.id === id)?.name ?? "");
}

function knownFolder(folders: Folder[], id: string | null | undefined): string | null {
  return id && folders.some((f) => f.id === id) ? id : null;
}

export function serverFilterable(s: Server, org: OrganisationContext, status?: ServerStatus): Filterable {
  const tagIds = s.tag_ids ?? [];
  return {
    text: [s.name, s.ip, s.os_type, s.notes ?? "", ...(s.custom_fields ?? []).map((f) => f.value), ...tagNames(org.tags, tagIds)],
    tagIds,
    folderId: knownFolder(org.folders, s.folder_id),
    favorite: !!s.favorite,
    online: status?.online,
  };
}

export function probeFilterable(p: Probe, org: OrganisationContext, result?: ProbeResult, serverName?: string): Filterable {
  const tagIds = p.tag_ids ?? [];
  return {
    text: [p.name, describeProbe(p.kind), serverName ?? "", ...tagNames(org.tags, tagIds)],
    tagIds,
    folderId: knownFolder(org.folders, p.folder_id),
    favorite: !!p.favorite,
    online: p.enabled && result ? result.ok : undefined,
  };
}

/** Retire des filtres un tag ou un dossier qui vient d'être supprimé */
export function withoutTag(f: ItemFilters, tagId: string): ItemFilters {
  return f.tagIds.includes(tagId) ? { ...f, tagIds: f.tagIds.filter((t) => t !== tagId) } : f;
}

export function withoutFolder(f: ItemFilters, folderId: string): ItemFilters {
  return f.folderId === folderId ? { ...f, folderId: null } : f;
}
