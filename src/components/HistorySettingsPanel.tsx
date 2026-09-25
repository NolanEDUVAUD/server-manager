import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Database, Eraser, RefreshCw } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { HistoryInfo, HistorySettings, PruneReport } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import { formatBytes } from "../utils";

/** Bornes identiques à la validation côté Rust (models.rs, HistorySettings::validate) */
export const RETENTION_LIMITS = {
  raw_days: { min: 1, max: 31 },
  hourly_days: { min: 7, max: 730 },
  event_days: { min: 7, max: 3650 },
} as const;

/** Message d'erreur si la rétention est invalide, sinon null */
export function retentionError(h: HistorySettings): string | null {
  const out = (k: keyof HistorySettings) =>
    !Number.isInteger(h[k]) || h[k] < RETENTION_LIMITS[k].min || h[k] > RETENTION_LIMITS[k].max;
  if (out("raw_days")) return "Mesures détaillées : entre 1 et 31 jours";
  if (out("hourly_days")) return "Agrégats horaires : entre 7 et 730 jours";
  if (h.hourly_days < h.raw_days) return "Les agrégats horaires doivent être conservés au moins aussi longtemps que les mesures détaillées";
  if (out("event_days")) return "Événements : entre 7 et 3 650 jours";
  return null;
}

const FIELDS: { key: keyof HistorySettings; label: string; help: string }[] = [
  { key: "raw_days", label: "Mesures détaillées (jours)", help: "Chaque ping, contrôle de service et relevé CPU / RAM" },
  { key: "hourly_days", label: "Agrégats horaires (jours)", help: "Disponibilité, latence et ressources résumées heure par heure" },
  { key: "event_days", label: "Événements (jours)", help: "Coupures, retours en ligne, arrêts, échecs…" },
];

export function HistorySettingsPanel() {
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
      success("Rétention enregistrée : elle s'applique à la prochaine purge (toutes les heures)");
    } catch (e) {
      error(String(e));
    }
  };

  const prune = async () => {
    setConfirmPrune(false);
    try {
      const r = await invoke<PruneReport>("prune_history");
      success(`Purge effectuée : ${r.raw_rows} mesure(s), ${r.hourly_rows} agrégat(s), ${r.events} événement(s) supprimés`);
      await loadInfo();
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-text-primary font-medium text-base">Historique</h2>
        <p className="text-text-secondary text-xs mt-1">
          Les pings, contrôles de services, relevés de ressources et événements sont enregistrés dans une base locale.
          Ils survivent au redémarrage de l'application et ne contiennent aucun mot de passe ni jeton.
        </p>
      </div>

      {/* ── État de la base ─────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary border border-border-primary rounded-win p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm text-text-primary">
            <Database size={14} className="text-accent-primary" /> Base d'historique
          </p>
          <button
            onClick={loadInfo}
            disabled={loading}
            aria-label="Actualiser l'état de la base"
            className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
          </button>
        </div>
        {loading && !info ? (
          <p className="text-xs text-text-muted">Lecture de la base…</p>
        ) : infoError ? (
          <p className="text-xs text-accent-error">Impossible de lire l'état de la base : {infoError}</p>
        ) : info ? (
          <>
            {info.warning && (
              <p className="flex items-start gap-1.5 text-xs text-accent-warning">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {info.warning}
              </p>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-text-muted">Taille</dt>
              <dd className="text-text-primary tabular-nums">{info.persistent ? formatBytes(info.size_bytes) : "en mémoire"}</dd>
              <dt className="text-text-muted">Événements</dt>
              <dd className="text-text-primary tabular-nums">{info.events.toLocaleString("fr-FR")}</dd>
              <dt className="text-text-muted">Mesures détaillées</dt>
              <dd className="text-text-primary tabular-nums">
                {(info.ping_samples + info.probe_samples + info.metric_samples).toLocaleString("fr-FR")}
              </dd>
              <dt className="text-text-muted">Agrégats horaires</dt>
              <dd className="text-text-primary tabular-nums">{info.hourly_rows.toLocaleString("fr-FR")}</dd>
              <dt className="text-text-muted">Depuis le</dt>
              <dd className="text-text-primary">
                {info.oldest_ts ? new Date(info.oldest_ts).toLocaleDateString("fr-FR") : "aucune donnée pour l'instant"}
              </dd>
            </dl>
            {info.path && <p className="text-[11px] text-text-muted break-all select-text">{info.path}</p>}
          </>
        ) : null}
      </div>

      {/* ── Rétention ───────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {FIELDS.map(({ key, label, help }) => (
          <div key={key} className="form-row">
            <label htmlFor={`retention-${key}`} className="text-text-secondary text-xs block mb-1">{label}</label>
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
            <p className="text-[11px] text-text-muted mt-1">{help}</p>
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
          Sauvegarder
        </button>
        <button
          onClick={() => setConfirmPrune(true)}
          disabled={dirty}
          title={dirty ? "Sauvegarde d'abord la nouvelle rétention" : undefined}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50"
        >
          <Eraser size={14} /> Appliquer maintenant
        </button>
      </div>

      {confirmPrune && (
        <ConfirmDialog
          title="Appliquer la rétention maintenant"
          message={`Seront supprimés définitivement : les mesures détaillées de plus de ${saved.raw_days} jour(s), les agrégats horaires de plus de ${saved.hourly_days} jours et les événements de plus de ${saved.event_days} jours. Continuer ?`}
          confirmLabel="Supprimer"
          dangerous
          onConfirm={prune}
          onCancel={() => setConfirmPrune(false)}
        />
      )}
      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
