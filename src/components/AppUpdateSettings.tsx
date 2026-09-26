import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, RefreshCw, ArrowUpCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { NOT_CONFIGURED_KEY, useAppUpdate } from "../stores/useAppUpdate";
import { useT } from "../i18n";
import { openExternal } from "../utils";
import { formatReleaseDate } from "../utils/appUpdate";
import { REPO_URL } from "../utils/support";

/** Paramètres → Général : mises à jour de l'application */
export function AppUpdateSettings() {
  const { t } = useT();
  const checkOnStartup = useStore((s) => s.settings.general.check_updates !== false);
  const updateGeneral = useStore((s) => s.updateGeneral);
  const { info, status, update, error, dismissed, loadInfo, check } = useAppUpdate();
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!info) loadInfo();
  }, [info, loadInfo]);

  const notConfigured = status === "not-configured" || info?.configured === false;
  const busy = status === "checking" || status === "installing";

  const toggle = async (value: boolean) => {
    setSaveError(null);
    try {
      await updateGeneral({ check_updates: value });
    } catch (e) {
      setSaveError(String(e));
    }
  };

  return (
    <>
      <h2 className="text-text-primary font-medium text-base">{t("appUpdate.settings.title")}</h2>
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-text-secondary">{t("appUpdate.settings.installedVersion")}</span>
          <span className="text-text-primary font-mono">{info?.current_version ?? "…"}</span>
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={checkOnStartup}
            onChange={(e) => toggle(e.target.checked)}
            className="accent-accent-primary mt-0.5"
          />
          <span>
            <span className="text-text-primary">{t("appUpdate.settings.checkOnStartup")}</span>
            <span className="block text-text-muted text-xs mt-0.5">
              {t("appUpdate.settings.checkOnStartupHelp")}
            </span>
          </span>
        </label>
        {saveError && <p className="text-xs text-red-400">{saveError}</p>}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            onClick={() => check()}
            disabled={busy || notConfigured}
            className="flex items-center gap-2 px-3 py-1.5 rounded-win border border-border-primary text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={status === "checking" ? "animate-spin" : undefined} />
            {t("appUpdate.settings.checkNow")}
          </button>
          <UpdateStatusLine
            status={status}
            notConfigured={notConfigured}
            version={update?.version ?? null}
            current={info?.current_version ?? null}
            error={error}
            dismissed={dismissed}
          />
        </div>

        {status === "available" && update?.notes && (
          <div className="pt-2 border-t border-border-secondary space-y-1.5">
            <p className="text-text-primary text-xs font-medium">
              {t("appUpdate.settings.releaseNotes")}
              {update.date ? ` · ${formatReleaseDate(update.date)}` : ""}
            </p>
            <pre className="whitespace-pre-wrap break-words text-text-secondary text-xs font-sans bg-bg-secondary rounded-win p-2 max-h-40 overflow-y-auto">
              {update.notes}
            </pre>
          </div>
        )}

        <div className="pt-1">
          <button
            onClick={() => openExternal(`${REPO_URL}/releases`)}
            className="flex items-center gap-1.5 text-xs text-accent-primary hover:underline"
          >
            <ExternalLink size={12} />
            {t("appUpdate.settings.viewReleases")}
          </button>
        </div>
      </div>
    </>
  );
}

function UpdateStatusLine({ status, notConfigured, version, current, error, dismissed }: {
  status: string;
  notConfigured: boolean;
  version: string | null;
  current: string | null;
  error: string | null;
  dismissed: boolean;
}) {
  const { t } = useT();
  if (notConfigured) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Info size={13} className="shrink-0" /> {t(NOT_CONFIGURED_KEY)}
      </span>
    );
  }
  switch (status) {
    case "checking":
      return (
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Loader2 size={13} className="animate-spin" /> {t("appUpdate.settings.checking")}
        </span>
      );
    case "up-to-date":
      return (
        <span className="flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle2 size={13} /> {current ? t("appUpdate.settings.upToDateVersion", { version: current }) : t("appUpdate.settings.upToDate")}
        </span>
      );
    case "available":
    case "installing":
      return (
        <span className="flex items-center gap-1.5 text-xs text-accent-primary">
          <ArrowUpCircle size={13} /> {t("appUpdate.available", { version: version ?? "" })}
          {dismissed ? (
            <button onClick={() => useAppUpdate.setState({ dismissed: false })} className="underline hover:no-underline">
              {t("appUpdate.settings.showBanner")}
            </button>
          ) : (
            <span className="text-text-secondary">{t("appUpdate.settings.seeBanner")}</span>
          )}
        </span>
      );
    case "error":
      return (
        <span className="flex items-start gap-1.5 text-xs text-red-400 break-words">
          <AlertTriangle size={13} className="shrink-0 mt-px" /> {error ?? t("appUpdate.settings.checkFailed")}
        </span>
      );
    default:
      return null;
  }
}
