import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Archive, CalendarClock, CheckCircle2, Loader2, RefreshCw, Save, XCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { BackupReport } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { cn, formatBytes } from "../utils";
import { useT } from "../i18n";

type Translate = ReturnType<typeof useT>["t"];

const fmtDate = (secs: number, locale: string) => new Date(secs * 1000).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

/** Âge lisible d'une sauvegarde, en jours */
function age(secs: number, t: Translate): string {
  const days = Math.floor((Date.now() / 1000 - secs) / 86400);
  return days <= 0 ? t("backups.today") : days === 1 ? t("backups.yesterday") : t("backups.daysAgo", { count: days });
}

export function Backups() {
  const { t, locale } = useT();
  const { proxmoxConnections, loadProxmoxConnections } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [connId, setConnId] = useState<string | null>(null);
  const [report, setReport] = useState<BackupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [storageFor, setStorageFor] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<{ vmid: number; name: string; node: string; storage: string } | null>(null);

  useEffect(() => {
    if (proxmoxConnections.length === 0) loadProxmoxConnections().catch(() => {});
  }, []);
  useEffect(() => {
    if (!connId && proxmoxConnections[0]) setConnId(proxmoxConnections[0].id);
  }, [proxmoxConnections]);

  function load() {
    if (!connId) return;
    setLoading(true);
    invoke<BackupReport>("proxmox_backup_report", { connectionId: connId })
      .then((r) => { setReport(r); setLoadError(""); })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [connId]);

  async function run() {
    if (!confirm || !connId) return;
    const c = confirm;
    setConfirm(null);
    try {
      await invoke("proxmox_backup_now", { connectionId: connId, node: c.node, vmid: c.vmid, name: c.name, storage: c.storage });
      success(t("backups.started", { name: c.name, storage: c.storage }));
      setTimeout(load, 5000);
    } catch (e) {
      error(String(e));
    }
  }

  if (proxmoxConnections.length === 0) {
    return <div className="p-6 text-sm text-text-muted">{t("backups.noConnection")}</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("backups.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("backups.subtitle")}</p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover">
          <RefreshCw size={14} className={cn(loading && "animate-spin")} /> {t("common.refresh")}
        </button>
      </div>

      {loadError && <p className="text-sm text-accent-error">{loadError}</p>}
      {!report ? (
        loading && <Loader2 size={18} className="animate-spin text-text-muted" />
      ) : (
        <>
          {report.warnings.length > 0 ? (
            <div className="bg-bg-tertiary border border-accent-warning/30 rounded-win p-4 space-y-1.5">
              {report.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2 text-xs text-accent-warning"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-accent-success"><CheckCircle2 size={15} /> {t("backups.allGood")}</p>
          )}

          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-text-primary font-medium text-sm"><CalendarClock size={14} /> {t("backups.jobs")}</h2>
            {report.jobs.length === 0 ? <p className="text-xs text-text-muted">{t("backups.noJobs")}</p> : (
              <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary">
                {report.jobs.map((j) => (
                  <div key={j.id} className={cn("flex items-center gap-4 px-4 py-3 text-sm", !j.enabled && "opacity-50")}>
                    <span className={cn("w-2 h-2 rounded-full shrink-0", j.storage_available ? "bg-accent-success" : "bg-accent-error")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary">{j.schedule_text} <span className="text-text-muted">→ {j.storage}</span></p>
                      <p className="text-xs text-text-muted truncate">
                        {j.all_guests ? t("backups.allGuests") : t("backups.someGuests", { count: j.vmids.length, ids: j.vmids.join(", ") })}
                        {!j.storage_available && <span className="text-accent-error"> · {t("backups.storageUnavailable")}</span>}
                      </p>
                    </div>
                    {j.next_run && <span className="text-xs text-text-secondary shrink-0">{t("backups.nextRun", { date: fmtDate(j.next_run, locale) })}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="flex items-center gap-2 text-text-primary font-medium text-sm"><Archive size={14} /> {t("backups.guests")}</h2>
            {report.unreadable_storages.length > 0 && (
              <p className="text-xs text-text-muted">{t("backups.unreadable", { storages: report.unreadable_storages.join(", ") })}</p>
            )}
            <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary">
              {report.guests.map((g) => {
                const storages = report.backup_storages[g.node] ?? [];
                const chosen = storageFor[g.vmid] ?? storages[0];
                return (
                  <div key={g.vmid} className="flex items-center gap-4 px-4 py-2.5 text-sm">
                    {g.covered ? <CheckCircle2 size={14} className="text-accent-success shrink-0" /> : <XCircle size={14} className="text-accent-error shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary truncate"><span className="font-medium">{g.name}</span> <span className="text-text-muted">· {g.kind.toUpperCase()} {g.vmid} · {g.node}</span></p>
                      <p className="text-xs text-text-muted">
                        {g.covered ? t("backups.covered") : t("backups.notCovered")} ·{" "}
                        {g.last_backup ? `${t("backups.lastArchive", { age: age(g.last_backup, t) })}${g.last_backup_size ? ` (${formatBytes(g.last_backup_size)})` : ""}` : t("backups.noArchive")}
                      </p>
                    </div>
                    {storages.length > 0 ? (
                      <div className="flex items-center gap-1 shrink-0">
                        {storages.length > 1 && (
                          <select value={chosen} onChange={(e) => setStorageFor((p) => ({ ...p, [g.vmid]: e.target.value }))} className="bg-bg-input border border-border-primary rounded px-2 py-1 text-xs text-text-primary" aria-label={t("backups.storageFor", { name: g.name })}>
                            {storages.map((s) => <option key={s}>{s}</option>)}
                          </select>
                        )}
                        <button
                          onClick={() => setConfirm({ vmid: g.vmid, name: g.name, node: g.node, storage: chosen })}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-win border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/40"
                          title={t("backups.backupNowTo", { storage: chosen })}
                        >
                          <Save size={12} /> {t("backups.backup")}
                        </button>
                      </div>
                    ) : <span className="text-xs text-text-muted shrink-0">{t("backups.noStorage")}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {report.tasks.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-text-primary font-medium text-sm">{t("backups.recentTasks")}</h2>
              <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary">
                {report.tasks.slice(0, 10).map((task) => (
                  <div key={`${task.node}${task.start}${task.vmid}`} className="flex items-center gap-3 px-4 py-2 text-xs">
                    <span className={cn("w-1.5 h-1.5 rounded-full", task.ok ? "bg-accent-success" : task.status === "en cours" ? "bg-accent-warning" : "bg-accent-error")} />
                    <span className="text-text-primary w-32">{task.node}</span>
                    <span className="text-text-secondary w-20">{task.vmid ?? t("backups.job")}</span>
                    <span className="text-text-muted flex-1">{fmtDate(task.start, locale)}</span>
                    <span className={task.ok ? "text-accent-success" : "text-accent-error"}>{task.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={t("backups.confirmTitle")}
          message={t("backups.confirmMessage", { name: confirm.name, storage: confirm.storage })}
          confirmLabel={t("backups.backup")}
          onCancel={() => setConfirm(null)}
          onConfirm={run}
        />
      )}
    </div>
  );
}
