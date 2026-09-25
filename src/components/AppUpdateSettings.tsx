import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ArrowUpCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { NOT_CONFIGURED_MESSAGE, useAppUpdate } from "../stores/useAppUpdate";

/** Paramètres → Général : mises à jour de l'application */
export function AppUpdateSettings() {
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
      <h2 className="text-text-primary font-medium text-base">Mises à jour de l'application</h2>
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-text-secondary">Version installée</span>
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
            <span className="text-text-primary">Vérifier les mises à jour au démarrage</span>
            <span className="block text-text-muted text-xs mt-0.5">
              Rien n'est installé sans ta confirmation ; chaque version est signée et vérifiée avant installation.
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
            Rechercher maintenant
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
  if (notConfigured) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-secondary">
        <Info size={13} className="shrink-0" /> {NOT_CONFIGURED_MESSAGE}
      </span>
    );
  }
  switch (status) {
    case "checking":
      return (
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Loader2 size={13} className="animate-spin" /> Recherche en cours…
        </span>
      );
    case "up-to-date":
      return (
        <span className="flex items-center gap-1.5 text-xs text-green-400">
          <CheckCircle2 size={13} /> L'application est à jour{current ? ` (version ${current})` : ""}
        </span>
      );
    case "available":
    case "installing":
      return (
        <span className="flex items-center gap-1.5 text-xs text-accent-primary">
          <ArrowUpCircle size={13} /> Version {version} disponible
          {dismissed ? (
            <button onClick={() => useAppUpdate.setState({ dismissed: false })} className="underline hover:no-underline">
              Afficher la bannière
            </button>
          ) : (
            <span className="text-text-secondary">: voir la bannière en haut de la fenêtre</span>
          )}
        </span>
      );
    case "error":
      return (
        <span className="flex items-start gap-1.5 text-xs text-red-400 break-words">
          <AlertTriangle size={13} className="shrink-0 mt-px" /> {error ?? "Recherche impossible"}
        </span>
      );
    default:
      return null;
  }
}
