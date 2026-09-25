import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, Loader2, PackageSearch, RefreshCw, ShieldAlert, Container, ArrowRight } from "lucide-react";
import { ServerUpdates } from "../types";
import { cn } from "../utils";
import { BatchPrefill } from "./Batch";
import { useT } from "../i18n";

/** Versions de noyau différentes entre nœuds d'un même cluster : à harmoniser */
export function kernelMismatch(results: ServerUpdates[]): string | null {
  const pve = results.filter((r) => r.report?.kernel.endsWith("-pve"));
  const kernels = new Set(pve.map((r) => r.report!.kernel));
  if (kernels.size <= 1) return null;
  return pve.map((r) => `${r.name} ${r.report!.kernel}`).join(" · ");
}

export function Updates() {
  const { t } = useT();
  const navigate = useNavigate();
  const [results, setResults] = useState<ServerUpdates[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  async function scan() {
    setScanning(true);
    setError("");
    try {
      setResults(await invoke<ServerUpdates[]>("updates_scan"));
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }

  /** Ouvre les Tâches en lot pré-remplies ; l'exécution y reste soumise à confirmation */
  function prepare(prefill: BatchPrefill) {
    navigate("/batch", { state: prefill });
  }

  const mismatch = results ? kernelMismatch(results) : null;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("updates.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("updates.subtitle")}</p>
        </div>
        <button onClick={scan} disabled={scanning} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win disabled:opacity-50">
          {scanning ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {t("updates.scan")}
        </button>
      </div>
      {error && <p className="text-sm text-accent-error">{error}</p>}
      {mismatch && (
        <p className="flex items-start gap-2 text-xs text-accent-warning bg-bg-tertiary border border-accent-warning/30 rounded-win p-3">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {t("updates.kernelMismatch", { list: mismatch })}
        </p>
      )}

      {!results ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <PackageSearch size={28} className="opacity-50" />
          {t("updates.intro")}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-4">
          {results.map((r) => {
            const rep = r.report;
            const upToDate = rep && rep.packages.length === 0 && rep.stale_containers.length === 0 && !rep.reboot_required;
            return (
              <div key={r.server_id} className="bg-bg-tertiary border border-border-primary rounded-win p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {r.error ? <AlertTriangle size={15} className="text-accent-error" /> : upToDate ? <CheckCircle2 size={15} className="text-accent-success" /> : <ShieldAlert size={15} className="text-accent-warning" />}
                  <span className="text-sm font-medium text-text-primary flex-1">{r.name}</span>
                  {rep && <span className="text-[11px] text-text-muted font-mono">{rep.kernel}</span>}
                </div>
                {r.error && <p className="text-xs text-accent-error break-words">{r.error}</p>}
                {rep && (
                  <>
                    <div className="flex gap-3 text-xs flex-wrap">
                      <span className={cn(rep.packages.length ? "text-text-primary" : "text-text-muted")}>{t("updates.packages", { count: rep.packages.length })}</span>
                      {rep.security_count > 0 && <span className="text-accent-error">{t("updates.security", { count: rep.security_count })}</span>}
                      {rep.reboot_required && <span className="text-accent-warning">{t("updates.rebootRequired")}</span>}
                      {rep.lists_age_days !== null && rep.lists_age_days > 7 && <span className="text-accent-warning">{t("updates.listsAge", { days: rep.lists_age_days })}</span>}
                    </div>
                    {rep.packages.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-text-secondary">{t("updates.showPackages")}</summary>
                        <ul className="mt-1 max-h-48 overflow-y-auto font-mono text-[11px] space-y-0.5">
                          {rep.packages.map((p) => (
                            <li key={p.name} className={p.security ? "text-accent-error" : "text-text-secondary"}>{p.name} {p.old_version} → {p.new_version}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {rep.stale_containers.length > 0 && (
                      <div className="text-xs">
                        <p className="flex items-center gap-1.5 text-accent-warning"><Container size={12} /> {t("updates.staleContainers", { count: rep.stale_containers.length })}</p>
                        <p className="text-text-muted mt-0.5">{rep.stale_containers.map((c) => c.name).join(", ")}</p>
                        <p className="text-text-muted mt-1">{t("updates.staleHelpBefore")}<code>docker compose up -d</code> {t("updates.staleHelpAfter")}</p>
                      </div>
                    )}
                    {rep.packages.length > 0 && (
                      <button
                        onClick={() => prepare({ script: "export DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get -y full-upgrade", serverIds: [r.server_id] })}
                        className="flex items-center gap-1.5 text-xs text-accent-primary hover:underline"
                      >
                        {t("updates.prepare", { name: r.name })} <ArrowRight size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
