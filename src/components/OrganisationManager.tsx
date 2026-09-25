import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Folder as FolderIcon, Loader2, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Folder, Probe, Tag } from "../types";
import { FOLDER_NAME_MAX, isValidColor, nameError, TAG_COLORS, TAG_NAME_MAX } from "../utils/organisation";
import { ConfirmDialog } from "./ConfirmDialog";
import { TagChip } from "./TagChip";
import { cn } from "../utils";
import { TKey, useT } from "../i18n";

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
  const { t } = useT();
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn("w-5 h-5 rounded-full border-2", value.toLowerCase() === c ? "border-text-primary" : "border-transparent")}
          style={{ backgroundColor: c }}
          aria-label={t("organisation.color", { color: c })}
        />
      ))}
      <input type="color" value={isValidColor(value) ? value : "#64748b"} onChange={(e) => onChange(e.target.value)} className="w-6 h-6 bg-transparent cursor-pointer" aria-label={t("organisation.customColor")} />
    </div>
  );
}

/** Bouton de validation d'un éditeur de nom : ajout, enregistrement ou renommage */
type SubmitKind = "add" | "save" | "rename";

const SUBMIT_LABELS: Record<SubmitKind, TKey> = {
  add: "common.add",
  save: "organisation.save",
  rename: "organisation.rename",
};

/** Ligne éditable (création ou modification) d'un tag ou d'un dossier */
function NameEditor({ initialName, initialColor, max, existing, selfId, onSave, onCancel, submit: submitKind }: {
  initialName: string; initialColor?: string; max: number; existing: { id: string; name: string }[]; selfId?: string;
  onSave: (name: string, color?: string) => Promise<void>; onCancel?: () => void; submit: SubmitKind;
}) {
  const { t } = useT();
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const localError = name.trim() ? nameError(name, max, existing, selfId) : null;
  const adding = submitKind === "add";

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
        <input className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} maxLength={max} placeholder={t("organisation.name")} aria-label={adding ? t("organisation.newItemName") : t("organisation.newName")} autoFocus={!!onCancel} />
        <button type="submit" disabled={saving || !name.trim()} className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-win bg-accent-primary hover:bg-accent-secondary text-white disabled:opacity-40">
          {saving ? <Loader2 size={12} className="animate-spin" /> : adding ? <Plus size={12} /> : <Check size={12} />}
          {t(SUBMIT_LABELS[submitKind])}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="shrink-0 p-1.5 rounded text-text-secondary hover:text-text-primary" aria-label={t("common.cancel")}>
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
  const { t, lang } = useT();
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
  const describe = (c: { servers: number; services: number | null }) => {
    const serverText = t("common.servers", { count: c.servers });
    return c.services === null
      ? serverText
      : t("organisation.serversAndServices", { servers: serverText, services: t("organisation.services", { count: c.services }) });
  };

  function deletionMessage(): string {
    if (!deleting) return "";
    if (deleting.kind === "tag") {
      const c = count((x) => !!x.tag_ids?.includes(deleting.item.id));
      return t("organisation.deleteTagMessage", { name: deleting.item.name, targets: describe(c) });
    }
    const c = count((x) => x.folder_id === deleting.item.id);
    return t("organisation.deleteFolderMessage", { name: deleting.item.name, targets: describe(c) });
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

  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, lang, { sensitivity: "base" }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-label={t("organisation.dialogLabel")} className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <div>
            <h2 className="text-text-primary font-semibold">{t("organisation.title")}</h2>
            <p className="text-xs text-text-muted mt-0.5">{t("organisation.intro")}</p>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary" aria-label={t("common.close")}><X size={18} /></button>
        </div>
        {error && <p className="mx-5 mt-4 text-xs text-red-400">{error}</p>}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto">
          {/* ── Tags ── */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary"><Tags size={14} /> {t("organisation.tags")} <span className="text-xs text-text-muted">({tags.length})</span></h3>
            {tags.length === 0 && <p className="text-xs text-text-muted">{t("organisation.noTags")}</p>}
            <ul className="space-y-1.5">
              {tags.map((tag) => (
                <li key={tag.id} className="rounded-win border border-border-primary px-2.5 py-2">
                  {editingTag === tag.id ? (
                    <NameEditor
                      initialName={tag.name} initialColor={tag.color} max={TAG_NAME_MAX} existing={tags} selfId={tag.id} submit="save"
                      onSave={async (name, color) => { await saveTag({ id: tag.id, name, color: color ?? tag.color }); setEditingTag(null); }}
                      onCancel={() => setEditingTag(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <TagChip tag={tag} />
                      <span className="flex-1 text-[11px] text-text-muted truncate">{describe(count((x) => !!x.tag_ids?.includes(tag.id)))}</span>
                      <button onClick={() => setEditingTag(tag.id)} className="p-1 rounded text-text-secondary hover:text-accent-primary" aria-label={t("organisation.editTag", { name: tag.name })}><Pencil size={12} /></button>
                      <button onClick={() => setDeleting({ kind: "tag", item: tag })} className="p-1 rounded text-text-secondary hover:text-red-400" aria-label={t("organisation.deleteTag", { name: tag.name })}><Trash2 size={12} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="rounded-win border border-dashed border-border-primary p-2.5">
              <p className="text-xs text-text-secondary mb-1.5">{t("organisation.newTag")}</p>
              <NameEditor
                key={`new-tag-${tags.length}`}
                initialName="" initialColor={TAG_COLORS[tags.length % TAG_COLORS.length]} max={TAG_NAME_MAX} existing={tags} submit="add"
                onSave={async (name, color) => { await saveTag({ id: "", name, color: color ?? TAG_COLORS[0] }); }}
              />
            </div>
          </section>

          {/* ── Dossiers ── */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary"><FolderIcon size={14} /> {t("organisation.folders")} <span className="text-xs text-text-muted">({folders.length})</span></h3>
            {folders.length === 0 && <p className="text-xs text-text-muted">{t("organisation.noFolders")}</p>}
            <ul className="space-y-1.5">
              {sortedFolders.map((f) => (
                <li key={f.id} className="rounded-win border border-border-primary px-2.5 py-2">
                  {editingFolder === f.id ? (
                    <NameEditor
                      initialName={f.name} max={FOLDER_NAME_MAX} existing={folders} selfId={f.id} submit="rename"
                      onSave={async (name) => { await saveFolder({ id: f.id, name }); setEditingFolder(null); }}
                      onCancel={() => setEditingFolder(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <FolderIcon size={13} className="text-text-muted shrink-0" />
                      <span className="text-sm text-text-primary truncate">{f.name}</span>
                      <span className="flex-1 text-[11px] text-text-muted truncate">{describe(count((x) => x.folder_id === f.id))}</span>
                      <button onClick={() => setEditingFolder(f.id)} className="p-1 rounded text-text-secondary hover:text-accent-primary" aria-label={t("organisation.renameFolder", { name: f.name })}><Pencil size={12} /></button>
                      <button onClick={() => setDeleting({ kind: "folder", item: f })} className="p-1 rounded text-text-secondary hover:text-red-400" aria-label={t("organisation.deleteFolder", { name: f.name })}><Trash2 size={12} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="rounded-win border border-dashed border-border-primary p-2.5">
              <p className="text-xs text-text-secondary mb-1.5">{t("organisation.newFolder")}</p>
              <NameEditor
                key={`new-folder-${folders.length}`}
                initialName="" max={FOLDER_NAME_MAX} existing={folders} submit="add"
                onSave={async (name) => { await saveFolder({ id: "", name }); }}
              />
            </div>
          </section>
        </div>
      </div>

      {deleting && (
        <ConfirmDialog
          title={deleting.kind === "tag" ? t("organisation.deleteTagTitle", { name: deleting.item.name }) : t("organisation.deleteFolderTitle", { name: deleting.item.name })}
          message={deletionMessage()}
          confirmLabel={t("common.delete")}
          dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
