import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Database, Eraser, RefreshCw } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { HistoryInfo, HistorySettings, PruneReport } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import { formatBytes } from "../utils";
import { t as translate, TKey, useT } from "../i18n";

/** Bornes identiques à la validation côté Rust (models.rs, HistorySettings::validate) */
export const RETENTION_LIMITS = {
  raw_days: { min: 1, max: 31 },
  hourly_days: { min: 7, max: 730 },
  event_days: { min: 7, max: 3650 },
} as const;

/** Message d'erreur (dans la langue active) si la rétention est invalide, sinon null */
export function retentionError(h: HistorySettings): string | null {
  const out = (k: keyof HistorySettings) =>
    !Number.isInteger(h[k]) || h[k] < RETENTION_LIMITS[k].min || h[k] > RETENTION_LIMITS[k].max;
  if (out("raw_days")) return translate("retention.errors.raw");
  if (out("hourly_days")) return translate("retention.errors.hourly");
  if (h.hourly_days < h.raw_days) return translate("retention.errors.hourlyShorter");
  if (out("event_days")) return translate("retention.errors.events");
  return null;
}

const FIELDS: { key: keyof HistorySettings; labelKey: TKey; helpKey: TKey }[] = [
  { key: "raw_days", labelKey: "retention.fields.raw.label", helpKey: "retention.fields.raw.help" },
  { key: "hourly_days", labelKey: "retention.fields.hourly.label", helpKey: "retention.fields.hourly.help" },
  { key: "event_days", labelKey: "retention.fields.events.label", helpKey: "retention.fields.events.help" },
];

export function HistorySettingsPanel() {
  const { t, locale } = useT();
  const { settings, updateHistory } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [draft, setDraft] = useState<HistorySettings>(settings.history);
  const [info, setInfo] = useState<HistoryInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmPrune, setConfirmPrune] = useState(false);

  const loadInfo = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await invoke<HistoryInfo>("get_history_info"));
      setInfoError(null);
    } catch (e) {
      setInfoError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const invalid = retentionError(draft);
  const saved = settings.history;
  const dirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);

  const save = async () => {
    try {
      await updateHistory(draft);
      success(t("retention.saved"));
    } catch (e) {
      error(String(e));
    }
  };

  const prune = async () => {
    setConfirmPrune(false);
    try {
      const r = await invoke<PruneReport>("prune_history");
      success(t("retention.pruned", { raw: r.raw_rows, hourly: r.hourly_rows, events: r.events }));
      await loadInfo();
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-text-primary font-medium text-base">{t("retention.title")}</h2>
        <p className="text-text-secondary text-xs mt-1">
          {t("retention.intro")}
        </p>
      </div>

      {/* ── État de la base ─────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary border border-border-primary rounded-win p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <Database size={14} className="text-accent-primary" /> {t("retention.database")}
          </p>
          <button
            onClick={loadInfo}
            disabled={loading}
            aria-label={t("retention.refreshLabel")}
            className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
          </button>
        </div>
        {loading && !info ? (
          <p className="text-xs text-text-muted">{t("retention.reading")}</p>
        ) : infoError ? (
          <p className="text-xs text-accent-error">{t("retention.readError", { message: infoError })}</p>
        ) : info ? (
          <>
            {info.warning && (
              <p className="flex items-start gap-1.5 text-xs text-accent-warning">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {info.warning}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-text-muted">{t("retention.size")}</dt>
              <dd className="text-text-primary tabular-nums">{info.persistent ? formatBytes(info.size_bytes) : t("retention.inMemory")}</dd>
              <dt className="text-text-muted">{t("retention.events")}</dt>
              <dd className="text-text-primary tabular-nums">{info.events.toLocaleString(locale)}</dd>
              <dt className="text-text-muted">{t("retention.rawSamples")}</dt>
              <dd className="text-text-primary tabular-nums">
                {(info.ping_samples + info.probe_samples + info.metric_samples).toLocaleString(locale)}
              </dd>
              <dt className="text-text-muted">{t("retention.hourlyRows")}</dt>
              <dd className="text-text-primary tabular-nums">{info.hourly_rows.toLocaleString(locale)}</dd>
              <dt className="text-text-muted">{t("retention.since")}</dt>
              <dd className="text-text-primary">
                {info.oldest_ts ? new Date(info.oldest_ts).toLocaleDateString(locale) : t("retention.noData")}
              </dd>
            </dl>
            {info.path && <p className="text-[11px] text-text-muted break-all select-text">{info.path}</p>}
          </>
        ) : null}
      </div>

      {/* ── Rétention ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {FIELDS.map(({ key, labelKey, helpKey }) => (
          <div key={key} className="form-row">
            <label htmlFor={`retention-${key}`} className="text-text-secondary text-xs block mb-1">{t(labelKey)}</label>
            <input
              id={`retention-${key}`}
              type="number"
              min={RETENTION_LIMITS[key].min}
              max={RETENTION_LIMITS[key].max}
              value={draft[key]}
              onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2
                         text-text-primary text-sm focus:outline-none focus:border-accent-primary
                         transition-colors duration-150"
            />
            <p className="text-[11px] text-text-muted mt-1">{t(helpKey)}</p>
          </div>
        ))}
        {invalid && <p role="alert" className="text-xs text-accent-error">{invalid}</p>}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={!!invalid || !dirty}
          className="px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150 disabled:opacity-50"
        >
          {t("common.save")}
        </button>
        <button
          onClick={() => setConfirmPrune(true)}
          disabled={dirty}
          title={dirty ? t("retention.saveFirst") : undefined}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50"
        >
          <Eraser size={14} /> {t("retention.applyNow")}
        </button>
      </div>

      {confirmPrune && (
        <ConfirmDialog
          title={t("retention.confirmTitle")}
          message={t("retention.confirmMessage", { raw: saved.raw_days, hourly: saved.hourly_days, events: saved.event_days })}
          confirmLabel={t("common.delete")}
          dangerous
          onConfirm={prune}
          onCancel={() => setConfirmPrune(false)}
        />
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
