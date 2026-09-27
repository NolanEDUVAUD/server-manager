import { useState } from "react";
import { AlertTriangle, ArrowUpCircle, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { useAppUpdate } from "../stores/useAppUpdate";
import { ConfirmDialog } from "./ConfirmDialog";
import { cn } from "../utils";
import { formatReleaseDate, installConfirmMessage, progressLabel, progressPercent } from "../utils/appUpdate";
import { useT } from "../i18n";

/**
 * Bannière affichée en haut du contenu quand une nouvelle version signée est
 * disponible. Rien n'est installé sans passer par la confirmation.
 */
export function UpdateBanner() {
  const { info, status, github, error, progress, dismissed, install, dismiss } = useAppUpdate();
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const installing = status === "installing";
  if (!github?.available || !(installing || (status === "available" && !dismissed))) return null;

  const date = formatReleaseDate(github.published_at);
  const pct = progressPercent(progress);
  const signed = info?.configured ?? false;

  return (
    <div role="status" aria-label={t("appUpdate.banner.label")} className="shrink-0 border-b border-accent-primary/30 bg-accent-primary/10 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ArrowUpCircle size={16} className="text-accent-primary shrink-0" />
        <p className="text-text-primary">
          <span className="font-medium">{t("appUpdate.available", { version: github.latest_version })}</span>
          <span className="text-text-secondary">
            {" "}· {t("appUpdate.banner.installed", { version: github.current_version })}
            {date && ` · ${t("appUpdate.banner.published", { date })}`}
          </span>
        </p>

        <div className="ml-auto flex items-center gap-2">
          {github.notes && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              aria-expanded={showNotes}
              className="flex items-center gap-1 px-2 py-1 rounded-win text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              {t("appUpdate.banner.notes")} {showNotes ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
          {installing ? (
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <Loader2 size={13} className="animate-spin" /> {progressLabel(progress)}
            </span>
          ) : (
            <>
              <button
                onClick={() => setConfirming(true)}
                className="px-3 py-1.5 rounded-win text-xs font-medium bg-accent-primary hover:bg-accent-secondary text-white transition-colors"
              >
                {error ? t("appUpdate.banner.retry") : t(signed ? "appUpdate.install" : "appUpdate.openDownload")}
              </button>
              <button
                onClick={dismiss}
                title={t("appUpdate.banner.later")}
                aria-label={t("appUpdate.banner.later")}
                className="p-1 rounded-win text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {installing && (
        <div className="mt-2 h-1 rounded-full bg-bg-active overflow-hidden">
          <div
            className={cn("h-full bg-accent-primary transition-all duration-300", pct === null && "animate-pulse w-full")}
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
      )}

      {error && !installing && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-400 break-words">
          <AlertTriangle size={13} className="shrink-0 mt-px" /> {error}
        </p>
      )}

      {showNotes && github.notes && (
        // Notes affichées en texte brut : React échappe tout, aucun HTML n'est interprété
        <div className="mt-2 max-h-48 overflow-y-auto rounded-win bg-bg-secondary border border-border-primary p-3 text-xs text-text-secondary whitespace-pre-wrap break-words select-text">
          {github.notes}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("appUpdate.confirmTitle", { version: github.latest_version })}
          message={installConfirmMessage(github.latest_version, signed)}
          confirmLabel={t(signed ? "appUpdate.install" : "appUpdate.openDownload")}
          onConfirm={() => {
            setConfirming(false);
            install();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
