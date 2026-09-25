import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { CronEntry } from "../types";
import { supportsMetrics } from "../hooks/useMetrics";
import { cn } from "../utils";
import { useT } from "../i18n";

type HostCrons = { loading: boolean; entries?: CronEntry[]; error?: string };

/** Crons présents sur les serveurs, avec repérage des lignes gérées par l'app. */
export function ServerCrons({ onError, onSuccess }: { onError: (msg: string) => void; onSuccess: (msg: string) => void }) {
  const { t } = useT();
  const { servers, statuses, schedules } = useStore();
  const candidates = servers.filter(supportsMetrics);
  const [selected, setSelected] = useState<string | null>(null);
  const [crons, setCrons] = useState<Record<string, HostCrons>>({});

  function load(serverId: string) {
    setSelected(serverId);
    setCrons((c) => ({ ...c, [serverId]: { ...c[serverId], loading: true } }));
    invoke<CronEntry[]>("cron_list", { serverId })
      .then((entries) => setCrons((c) => ({ ...c, [serverId]: { loading: false, entries } })))
      .catch((e) => setCrons((c) => ({ ...c, [serverId]: { loading: false, error: String(e) } })));
  }

  async function removeOrphan(serverId: string, scheduleId: string) {
    try {
      await invoke("cron_remove_managed", { serverId, scheduleId });
      onSuccess(t("scheduler.crons.orphanRemoved"));
      load(serverId);
    } catch (e) {
      onError(String(e));
    }
  }

  const current = selected ? crons[selected] : undefined;
  // Regroupement par source (crontab utilisateur, puis fichiers système)
  const bySource = new Map<string, CronEntry[]>();
  for (const e of current?.entries ?? []) {
    bySource.set(e.source, [...(bySource.get(e.source) ?? []), e]);
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-text-primary font-medium text-sm">{t("scheduler.crons.title")}</h2>
        <p className="text-text-muted text-xs mt-0.5">{t("scheduler.crons.subtitle")}</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        {candidates.map((s) => (
          <button
            key={s.id}
            onClick={() => load(s.id)}
            disabled={!statuses[s.id]?.online}
            className={cn(
              "px-3 py-1.5 rounded-win border text-xs transition-all disabled:opacity-40",
              selected === s.id
                ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                : "border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary"
            )}
          >
            {s.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="bg-bg-tertiary border border-border-primary rounded-win overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-primary text-xs text-text-muted">
            <span>{current?.entries ? t("scheduler.crons.entries", { count: current.entries.length }) : t("scheduler.crons.reading")}</span>
            <button onClick={() => load(selected)} className="flex items-center gap-1 hover:text-accent-primary">
              <RefreshCw size={12} className={cn(current?.loading && "animate-spin")} /> {t("common.refresh")}
            </button>
          </div>
          {current?.error ? (
            <p className="flex items-start gap-2 p-4 text-sm text-accent-error">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {current.error}
            </p>
          ) : !current?.entries ? (
            <div className="p-4"><Loader2 size={16} className="animate-spin text-text-muted" /></div>
          ) : current.entries.length === 0 ? (
            <p className="p-4 text-sm text-text-muted">{t("scheduler.crons.empty")}</p>
          ) : (
            [...bySource].map(([source, entries]) => (
              <div key={source}>
                <p className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  {source === "crontab" ? t("scheduler.crons.userCrontab") : source}
                </p>
                <div className="divide-y divide-border-secondary">
                  {entries.map((e, i) => {
                    const owner = e.managed_id ? schedules.find((s) => s.id === e.managed_id) : undefined;
                    const orphan = e.managed_id && !owner;
                    return (
                      <div key={`${source}-${i}`} className="flex items-center gap-3 px-4 py-2">
                        <code className="text-xs text-accent-primary shrink-0 w-28 truncate" title={e.schedule}>{e.schedule}</code>
                        <code className="text-xs text-text-secondary flex-1 min-w-0 truncate" title={e.command}>
                          {e.user && <span className="text-text-muted">{e.user} · </span>}
                          {e.command}
                        </code>
                        {owner && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/15 text-accent-primary shrink-0">
                            {owner.name}
                          </span>
                        )}
                        {orphan && (
                          <>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-warning/15 text-accent-warning shrink-0" title={t("scheduler.crons.orphanHint")}>
                              {t("scheduler.crons.orphan")}
                            </span>
                            <button
                              onClick={() => removeOrphan(selected, e.managed_id!)}
                              className="p-1 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 shrink-0"
                              title={t("scheduler.crons.remove")}
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
