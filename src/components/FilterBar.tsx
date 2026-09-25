import { RefObject } from "react";
import { FolderOpen, Search, SearchX, Star, Tags, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { FilterScope, hasActiveFilters, NO_FOLDER, StatusFilter } from "../utils/filters";
import { cn } from "../utils";
import { TagChip } from "./TagChip";

interface FilterBarProps {
  scope: FilterScope;
  searchRef: RefObject<HTMLInputElement>;
  placeholder: string;
  /** Éléments affichés / total, pour le compteur */
  shown: number;
  total: number;
  /** Ouvre la gestion des tags et dossiers */
  onOrganise: () => void;
}

const selectClass =
  "bg-bg-secondary border border-border-primary rounded-win px-2.5 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

/**
 * Recherche et filtres combinés (texte, statut, dossier, favoris, tags en ET logique).
 * L'état vit dans le store : il est conservé quand on change de page pendant la session.
 */
export function FilterBar({ scope, searchRef, placeholder, shown, total, onOrganise }: FilterBarProps) {
  const { filters, setFilters, clearFilters, tags, folders } = useStore();
  const f = filters[scope];
  const active = hasActiveFilters(f);
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
  const toggleTag = (id: string) =>
    setFilters(scope, { tagIds: f.tagIds.includes(id) ? f.tagIds.filter((t) => t !== id) : [...f.tagIds, id] });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            ref={searchRef}
            className="w-full bg-bg-secondary border border-border-primary rounded-win pl-9 pr-9 py-2 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary transition-colors"
            value={f.text}
            onChange={(e) => setFilters(scope, { text: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Escape" && f.text) { e.stopPropagation(); setFilters(scope, { text: "" }); } }}
            placeholder={placeholder}
            aria-label="Rechercher"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5" title="Raccourci : /">/</kbd>
        </div>
        <select className={selectClass} value={f.status} onChange={(e) => setFilters(scope, { status: e.target.value as StatusFilter })} aria-label="Filtrer par statut">
          <option value="all">Tous les statuts</option>
          <option value="online">En ligne</option>
          <option value="offline">Hors ligne</option>
        </select>
        <select className={selectClass} value={f.folderId ?? ""} onChange={(e) => setFilters(scope, { folderId: e.target.value || null })} aria-label="Filtrer par dossier">
          <option value="">Tous les dossiers</option>
          <option value={NO_FOLDER}>Sans dossier</option>
          {sortedFolders.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => setFilters(scope, { favoritesOnly: !f.favoritesOnly })}
          aria-pressed={f.favoritesOnly}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border transition-colors",
            f.favoritesOnly ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400" : "border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          )}
        >
          <Star size={13} className={f.favoritesOnly ? "fill-current" : ""} /> Favoris
        </button>
        <button
          type="button"
          onClick={onOrganise}
          className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          title="Créer, renommer ou supprimer les tags et les dossiers"
        >
          <FolderOpen size={13} /> Organiser
        </button>
      </div>

      {(tags.length > 0 || active) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.length > 0 && (
            <>
              <Tags size={13} className="text-text-muted" aria-hidden />
              {tags.map((t) => <TagChip key={t.id} tag={t} active={f.tagIds.includes(t.id)} onClick={() => toggleTag(t.id)} />)}
              {f.tagIds.length > 1 && <span className="text-[11px] text-text-muted">tous ces tags</span>}
            </>
          )}
          {active && (
            <span className="ml-auto flex items-center gap-3 text-xs text-text-secondary">
              <span className="tabular-nums">{shown} / {total}</span>
              <button type="button" onClick={() => clearFilters(scope)} className="flex items-center gap-1 text-accent-primary hover:underline">
                <X size={12} /> Effacer les filtres
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** État vide quand les filtres ne laissent rien passer */
export function NoFilterResults({ scope }: { scope: FilterScope }) {
  const clearFilters = useStore((s) => s.clearFilters);
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <SearchX size={28} className="text-text-muted" />
      <div>
        <p className="text-sm text-text-primary font-medium">Aucun résultat pour ces filtres</p>
        <p className="text-xs text-text-muted mt-0.5">Modifie la recherche ou retire un critère.</p>
      </div>
      <button
        type="button"
        onClick={() => clearFilters(scope)}
        className="px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
      >
        Effacer les filtres
      </button>
    </div>
  );
}
