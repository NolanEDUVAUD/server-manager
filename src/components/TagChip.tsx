import { Star, X } from "lucide-react";
import { Tag } from "../types";
import { readableTextColor } from "../utils/organisation";
import { cn } from "../utils";

interface TagChipProps {
  tag: Tag;
  /** Puce cliquable (filtre, sélection) : `active` = sélectionnée */
  onClick?: () => void;
  active?: boolean;
  onRemove?: () => void;
}

/** Tag coloré ; le texte est noir ou blanc selon la couleur de fond */
export function TagChip({ tag, onClick, active, onRemove }: TagChipProps) {
  const selectable = onClick !== undefined;
  const style = !selectable || active
    ? { backgroundColor: tag.color, color: readableTextColor(tag.color), borderColor: tag.color }
    : { borderColor: tag.color, color: "var(--text-secondary)" };
  const content = (
    <>
      {selectable && !active && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />}
      <span className="truncate">{tag.name}</span>
    </>
  );
  const base = "inline-flex items-center gap-1 max-w-[12rem] rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight";
  if (selectable) {
    return (
      <button type="button" onClick={onClick} aria-pressed={!!active} className={cn(base, "transition-opacity hover:opacity-80")} style={style}>
        {content}
      </button>
    );
  }
  return (
    <span className={base} style={style}>
      {content}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Retirer le tag ${tag.name}`} className="opacity-70 hover:opacity-100">
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/** Tags d'un élément (les identifiants inconnus sont ignorés) */
export function TagList({ tagIds, tags, max = 4, className }: { tagIds?: string[]; tags: Tag[]; max?: number; className?: string }) {
  const known = (tagIds ?? []).map((id) => tags.find((t) => t.id === id)).filter((t): t is Tag => !!t);
  if (known.length === 0) return null;
  const hidden = known.slice(max);
  return (
    <div className={cn("flex flex-wrap items-center gap-1 min-w-0", className)}>
      {known.slice(0, max).map((t) => <TagChip key={t.id} tag={t} />)}
      {hidden.length > 0 && (
        <span className="text-[11px] text-text-muted" title={hidden.map((t) => t.name).join(", ")}>+{hidden.length}</span>
      )}
    </div>
  );
}

/** Étoile de favori d'une carte serveur ou service */
export function FavoriteButton({ favorite, name, onToggle }: { favorite: boolean; name: string; onToggle: () => void }) {
  const label = favorite ? `Retirer ${name} des favoris` : `Ajouter ${name} aux favoris`;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={favorite}
      aria-label={label}
      title={label}
      className={cn(
        "p-1 rounded transition-colors shrink-0",
        favorite ? "text-yellow-400 hover:text-yellow-300" : "text-text-muted hover:text-yellow-400"
      )}
    >
      <Star size={14} className={favorite ? "fill-current" : ""} />
    </button>
  );
}
