import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Folder as FolderIcon, Loader2, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Folder, Probe, Tag } from "../types";
import { FOLDER_NAME_MAX, isValidColor, nameError, plural, TAG_COLORS, TAG_NAME_MAX } from "../utils/organisation";
import { ConfirmDialog } from "./ConfirmDialog";
import { TagChip } from "./TagChip";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary";

interface OrganisationManagerProps {
  onClose: () => void;
  /** Services connus de la page appelante (sinon chargés ici, pour les compteurs) */
  probes?: Probe[];
  /** Appelé après une suppression (la page des services recharge ses sondes) */
  onChanged?: () => void;
}

/** Choix d'une couleur : palette + sélecteur libre */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("w-5 h-5 rounded-full border-2", value.toLowerCase() === c ? "border-text-primary" : "border-transparent")}
          style={{ backgroundColor: c }}
          aria-label={`Couleur ${c}`}
        />
      ))}
      <input type="color" value={isValidColor(value) ? value : "#64748b"} onChange={(e) => onChange(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" aria-label="Couleur personnalisée" />
    </div>
  );
}

/** Ligne éditable (création ou modification) d'un tag ou d'un dossier */
function NameEditor({ initialName, initialColor, max, existing, selfId, onSave, onCancel, submitLabel }: {
  initialName: string; initialColor?: string; max: number; existing: { id: string; name: string }[]; selfId?: string;
  onSave: (name: string, color?: string) => Promise<void>; onCancel?: () => void; submitLabel: string;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const localError = name.trim() ? nameError(name, max, existing, selfId) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = nameError(name, max, existing, selfId);
    if (err) { setError(err); return; }
    setSaving(true);
    try {
      await onSave(name.trim(), initialColor !== undefined ? color : undefined);
      if (!onCancel) { setName(""); }
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={max} placeholder="Nom" aria-label={submitLabel === "Ajouter" ? "Nom du nouvel élément" : "Nouveau nom"} autoFocus={!!onCancel} />
        <button type="submit" disabled={saving || !name.trim()} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-win bg-accent-primary hover:bg-accent-secondary text-white disabled:opacity-40">
          {saving ? <Loader2 size={12} className="animate-spin" /> : submitLabel === "Ajouter" ? <Plus size={12} /> : <Check size={12} />}
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 p-1.5 rounded text-text-secondary hover:text-text-primary" aria-label="Annuler">
            <X size={13} />
          </button>
        )}
      </div>
      {initialColor !== undefined && <ColorPicker value={color} onChange={setColor} />}
      {(error || localError) && <p className="text-xs text-red-400">{error || localError}</p>}
    </form>
  );
}

/**
 * Gestion des tags et des dossiers : création, renommage, suppression (avec une
 * confirmation qui dit exactement ce qui arrive aux serveurs et services concernés)
 */
export function OrganisationManager({ onClose, probes, onChanged }: OrganisationManagerProps) {
  const { tags, folders, servers, saveTag, deleteTag, saveFolder, deleteFolder } = useStore();
  const [loadedProbes, setLoadedProbes] = useState<Probe[] | null>(probes ?? null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "tag"; item: Tag } | { kind: "folder"; item: Folder } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (probes) { setLoadedProbes(probes); return; }
    // Page Serveurs : les services ne sont pas dans le store, on les lit pour les compteurs
    invoke<Probe[]>("get_probes").then(setLoadedProbes).catch(() => setLoadedProbes(null));
  }, [probes]);

  const count = (pred: (x: { tag_ids?: string[]; folder_id?: string | null }) => boolean) => ({
    servers: servers.filter(pred).length,
    services: loadedProbes ? loadedProbes.filter(pred).length : null,
  });
  const describe = (c: { servers: number; services: number | null }) =>
    c.services === null ? plural(c.servers, "serveur") : `${plural(c.servers, "serveur")} et ${plural(c.services, "service")}`;

  function deletionMessage(): string {
    if (!deleting) return "";
    if (deleting.kind === "tag") {
      const c = count((x) => !!x.tag_ids?.includes(deleting.item.id));
      return `Le tag « ${deleting.item.name} » sera supprimé et retiré de ${describe(c)}.\nCes serveurs et services ne sont pas supprimés.`;
    }
    const c = count((x) => x.folder_id === deleting.item.id);
    return `Le dossier « ${deleting.item.name} » sera supprimé : ${describe(c)} passeront « Sans dossier ».\nCes serveurs et services ne sont pas supprimés.`;
  }

  async function confirmDelete() {
    if (!deleting) return;
    const d = deleting;
    setDeleting(null);
    try {
      if (d.kind === "tag") await deleteTag(d.item.id);
      else await deleteFolder(d.item.id);
      setError("");
      onChanged?.();
    } catch (e) {
      setError(String(e));
    }
  }

  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label="Organiser les tags et les dossiers" className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <div>
            <h2 className="text-text-primary font-semibold">Organiser</h2>
            <p className="text-xs text-text-muted mt-0.5">Les tags et les dossiers servent aux serveurs comme aux services. Les groupes restent réservés aux actions en lot.</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label="Fermer"><X size={18} /></button>
        </div>
        {error && <p className="mx-5 mt-4 text-xs text-red-400">{error}</p>}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto">
          {/* ── Tags ── */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary"><Tags size={14} /> Tags <span className="text-xs text-text-muted">({tags.length})</span></h3>
            {tags.length === 0 && <p className="text-xs text-text-muted">Aucun tag. Exemple : « Production », « Média », « À surveiller ».</p>}
            <ul className="space-y-1.5">
              {tags.map((t) => (
                <li key={t.id} className="rounded-win border border-border-primary px-2.5 py-2">
                  {editingTag === t.id ? (
                    <NameEditor
                      initialName={t.name} initialColor={t.color} max={TAG_NAME_MAX} existing={tags} selfId={t.id} submitLabel="Enregistrer"
                      onSave={async (name, color) => { await saveTag({ id: t.id, name, color: color ?? t.color }); setEditingTag(null); }}
                      onCancel={() => setEditingTag(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <TagChip tag={t} />
                      <span className="flex-1 text-[11px] text-text-muted truncate">{describe(count((x) => !!x.tag_ids?.includes(t.id)))}</span>
                      <button onClick={() => setEditingTag(t.id)} className="p-1 rounded text-text-secondary hover:text-accent-primary" aria-label={`Modifier le tag ${t.name}`}><Pencil size={12} /></button>
                      <button onClick={() => setDeleting({ kind: "tag", item: t })} className="p-1 rounded text-text-secondary hover:text-red-400" aria-label={`Supprimer le tag ${t.name}`}><Trash2 size={12} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="rounded-win border border-dashed border-border-primary p-2.5">
              <p className="text-xs text-text-secondary mb-1.5">Nouveau tag</p>
              <NameEditor
                key={`new-tag-${tags.length}`}
                initialName="" initialColor={TAG_COLORS[tags.length % TAG_COLORS.length]} max={TAG_NAME_MAX} existing={tags} submitLabel="Ajouter"
                onSave={async (name, color) => { await saveTag({ id: "", name, color: color ?? TAG_COLORS[0] }); }}
              />
            </div>
          </section>

          {/* ── Dossiers ── */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary"><FolderIcon size={14} /> Dossiers <span className="text-xs text-text-muted">({folders.length})</span></h3>
            {folders.length === 0 && <p className="text-xs text-text-muted">Aucun dossier. Un serveur ou un service est rangé dans un seul dossier (exemple : « Maison », « Lab »).</p>}
            <ul className="space-y-1.5">
              {sortedFolders.map((f) => (
                <li key={f.id} className="rounded-win border border-border-primary px-2.5 py-2">
                  {editingFolder === f.id ? (
                    <NameEditor
                      initialName={f.name} max={FOLDER_NAME_MAX} existing={folders} selfId={f.id} submitLabel="Renommer"
                      onSave={async (name) => { await saveFolder({ id: f.id, name }); setEditingFolder(null); }}
                      onCancel={() => setEditingFolder(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <FolderIcon size={13} className="text-text-muted shrink-0" />
                      <span className="text-sm text-text-primary truncate">{f.name}</span>
                      <span className="flex-1 text-[11px] text-text-muted truncate">{describe(count((x) => x.folder_id === f.id))}</span>
                      <button onClick={() => setEditingFolder(f.id)} className="p-1 rounded text-text-secondary hover:text-accent-primary" aria-label={`Renommer le dossier ${f.name}`}><Pencil size={12} /></button>
                      <button onClick={() => setDeleting({ kind: "folder", item: f })} className="p-1 rounded text-text-secondary hover:text-red-400" aria-label={`Supprimer le dossier ${f.name}`}><Trash2 size={12} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="rounded-win border border-dashed border-border-primary p-2.5">
              <p className="text-xs text-text-secondary mb-1.5">Nouveau dossier</p>
              <NameEditor
                key={`new-folder-${folders.length}`}
                initialName="" max={FOLDER_NAME_MAX} existing={folders} submitLabel="Ajouter"
                onSave={async (name) => { await saveFolder({ id: "", name }); }}
              />
            </div>
          </section>
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title={deleting.kind === "tag" ? `Supprimer le tag « ${deleting.item.name} »` : `Supprimer le dossier « ${deleting.item.name} »`}
          message={deletionMessage()}
          confirmLabel="Supprimer"
          dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
