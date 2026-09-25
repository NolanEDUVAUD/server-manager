import { Info, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useStore } from "../stores/useStore";
import { CustomField } from "../types";
import { checkCustomFields, CUSTOM_KEY_MAX, CUSTOM_VALUE_MAX, looksSensitive, MAX_CUSTOM_FIELDS } from "../utils/organisation";
import { TagChip } from "./TagChip";
import { useT } from "../i18n";

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary transition-colors";
const labelClass = "block text-xs font-medium text-text-secondary mb-1";

/** Sélection des tags d'un élément (clic = ajouter / retirer) */
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useT();
  const tags = useStore((s) => s.tags);
  return (
    <div>
      <span className={labelClass}>{t("orgFields.tags")}</span>
      {tags.length === 0 ? (
        <p className="text-xs text-text-muted">{t("orgFields.noTags")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("orgFields.tags")}>
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              active={value.includes(tag.id)}
              onClick={() => onChange(value.includes(tag.id) ? value.filter((id) => id !== tag.id) : [...value, tag.id])}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Choix du dossier d'un élément ("" = sans dossier) */
export function FolderSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t, locale } = useT();
  const folders = useStore((s) => s.folders);
  const sorted = [...folders].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: "base" }));
  return (
    <label className="block">
      <span className={labelClass}>{t("orgFields.folder")}</span>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} aria-label={t("orgFields.folder")}>
        <option value="">{t("filters.noFolder")}</option>
        {sorted.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
    </label>
  );
}

/**
 * Champs personnalisés clé / valeur d'un serveur. Ce ne sont PAS des secrets : ils sont
 * stockés et exportés en clair, l'interface le rappelle et avertit si une clé y ressemble.
 */
export function CustomFieldsEditor({ value, onChange }: { value: CustomField[]; onChange: (fields: CustomField[]) => void }) {
  const { t } = useT();
  const check = checkCustomFields(value);
  const update = (i: number, patch: Partial<CustomField>) => onChange(value.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className={labelClass}>{t("orgFields.customFields")}</span>
        <span className="text-[11px] text-text-muted tabular-nums">{value.length} / {MAX_CUSTOM_FIELDS}</span>
      </div>
      <p className="flex items-start gap-1.5 text-[11px] text-text-muted">
        <Info size={12} className="shrink-0 mt-0.5" />
        {t("orgFields.customFieldsInfo")}
      </p>
      {value.map((f, i) => (
        <div key={i} className="space-y-1">
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
            <input
              className={inputClass}
              value={f.key}
              maxLength={CUSTOM_KEY_MAX}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder={t("orgFields.keyPlaceholder")}
              aria-label={t("orgFields.keyAria", { n: i + 1 })}
            />
            <input
              className={inputClass}
              value={f.value}
              maxLength={CUSTOM_VALUE_MAX}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={t("orgFields.valuePlaceholder")}
              aria-label={t("orgFields.valueAria", { n: i + 1 })}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="p-2 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10"
              aria-label={t("orgFields.removeAria", { n: i + 1 })}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {check.rows[i] && <p className="text-xs text-red-400">{check.rows[i]}</p>}
          {looksSensitive(f.key) && (
            <p className="flex items-start gap-1.5 text-xs text-accent-warning">
              <ShieldAlert size={13} className="shrink-0 mt-0.5" />
              {t("orgFields.sensitive", { key: f.key.trim() })}
            </p>
          )}
        </div>
      ))}
      {check.global && <p className="text-xs text-red-400">{check.global}</p>}
      <button
        type="button"
        onClick={() => onChange([...value, { key: "", value: "" }])}
        disabled={value.length >= MAX_CUSTOM_FIELDS}
        className="flex items-center gap-1.5 text-xs text-accent-primary hover:underline disabled:opacity-40 disabled:no-underline"
      >
        <Plus size={12} /> {t("orgFields.addField")}
      </button>
    </div>
  );
}

export interface ServerOrganisationValue {
  tag_ids: string[];
  folder_id: string;
  custom_fields: CustomField[];
}

/** Section « Organisation » du formulaire serveur : tags, dossier, champs personnalisés */
export function ServerOrganisationFields({ value, onChange }: { value: ServerOrganisationValue; onChange: (patch: Partial<ServerOrganisationValue>) => void }) {
  const { t } = useT();
  return (
    <fieldset className="space-y-4 border-t border-border-primary pt-4">
      <legend className="sr-only">{t("orgFields.legend")}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <TagPicker value={value.tag_ids} onChange={(tag_ids) => onChange({ tag_ids })} />
        <FolderSelect value={value.folder_id} onChange={(folder_id) => onChange({ folder_id })} />
      </div>
      <CustomFieldsEditor value={value.custom_fields} onChange={(custom_fields) => onChange({ custom_fields })} />
    </fieldset>
  );
}
