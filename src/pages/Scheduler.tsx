import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Zap, Power, RotateCcw, Play, Pencil, Trash2, CalendarClock, Info } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Schedule, ScheduleAction } from "../types";
import { ScheduleForm } from "../components/ScheduleForm";
import { ServerCrons } from "../components/ServerCrons";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { nextRun, formatSchedule } from "../utils/schedule";
import { cn } from "../utils";
import { useT, TKey } from "../i18n";

const ACTION_META: Record<ScheduleAction, { labelKey: TKey; icon: typeof Zap; color: string }> = {
  Wake: { labelKey: "scheduler.actions.wake", icon: Zap, color: "text-yellow-400" },
  Shutdown: { labelKey: "scheduler.actions.shutdown", icon: Power, color: "text-red-400" },
  Reboot: { labelKey: "scheduler.actions.reboot", icon: RotateCcw, color: "text-accent-info" },
};

function formatNext(date: Date | null, locale: string): string {
  if (!date) return "—";
  return date.toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Scheduler() {
  const { t, locale } = useT();
  const {
    schedules, servers, groups, loadSchedules, saveSchedule, deleteSchedule, runScheduleNow,
    settings,
  } = useStore();
  const { toasts, removeToast, success, error, warning } = useToast();
  const [editing, setEditing] = useState<Schedule | null | "new">(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const [running, setRunning] = useState<Schedule | null>(null);
  // Rafraîchit l'affichage des « prochaines exécutions » chaque minute
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    loadSchedules().catch((e) => error(String(e)));
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  function targetName(s: Schedule): string {
    if (s.target.kind === "Group") {
      const g = groups.find((x) => x.id === s.target.id);
      return g ? t("scheduler.group", { name: g.name }) : t("scheduler.deletedGroup");
    }
    return servers.find((x) => x.id === s.target.id)?.name ?? t("scheduler.deletedServer");
  }

  /** Signale les serveurs dont le crontab n'a pas pu être mis à jour */
  function reportCron(errors: string[]) {
    if (errors.length > 0) warning(t("scheduler.cronNotSynced", { errors: errors.join(" · ") }));
  }

  async function toggle(s: Schedule) {
    try {
      reportCron((await saveSchedule({ ...s, enabled: !s.enabled })).cron_errors);
    } catch (e) {
      error(String(e));
    }
  }

  async function runNow(s: Schedule) {
    setRunning(null);
    try {
      await runScheduleNow(s.id);
      success(t("scheduler.ranNow", { name: s.name }));
    } catch (e) {
      error(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("scheduler.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("scheduler.subtitle")}</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          disabled={servers.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win transition-colors disabled:opacity-50"
        >
          <Plus size={15} />
          {t("scheduler.newTask")}
        </button>
      </div>

      <div className="flex items-start gap-2 text-xs text-text-secondary bg-accent-info/5 border border-accent-info/20 rounded-win p-3">
        <Info size={14} className="text-accent-info shrink-0 mt-0.5" />
        <span>
          {t("scheduler.appNote")}
          {!settings.general.auto_start && (
            <> {t("scheduler.autoStartBefore")} <Link to="/settings" className="text-accent-primary hover:underline">{t("scheduler.autoStartLink")}</Link> {t("scheduler.autoStartAfter")}</>
          )}
        </span>
      </div>

      {schedules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <CalendarClock size={28} className="opacity-50" />
          {t("scheduler.empty")}
        </div>
      ) : (
        <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
          {schedules.map((s) => {
            const meta = ACTION_META[s.action];
            const Icon = meta.icon;
            return (
              <div key={s.id} className={cn("flex items-center gap-4 px-4 py-3", !s.enabled && "opacity-50")}>
                <Icon size={16} className={cn("shrink-0", meta.color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary truncate">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-text-secondary"> · {t(meta.labelKey)} {targetName(s)}</span>
                    {s.mode === "Cron" && (
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent-info/15 text-accent-info align-middle">cron</span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatSchedule(s.days, s.time)}
                    {s.enabled && <> · {t("scheduler.next", { date: formatNext(nextRun(s, now), locale) })}{s.mode === "Cron" && ` (${t("scheduler.serverTime")})`}</>}
                  </p>
                </div>
                <button
                  onClick={() => toggle(s)}
                  className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", s.enabled ? "bg-accent-primary" : "bg-bg-hover")}
                  title={s.enabled ? t("scheduler.disable") : t("scheduler.enable")}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", s.enabled ? "left-[18px]" : "left-0.5")} />
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setRunning(s)} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all" title={t("scheduler.runNow")}>
                    <Play size={13} />
                  </button>
                  <button onClick={() => setEditing(s)} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all" title={t("common.edit")}>
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => setDeleting(s)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all" title={t("common.delete")}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ServerCrons onError={error} onSuccess={success} />

      {editing && (
        <ScheduleForm
          initial={editing === "new" ? undefined : editing}
          servers={servers}
          groups={groups}
          onCancel={() => setEditing(null)}
          onSubmit={async (schedule) => {
            const report = await saveSchedule(schedule);
            setEditing(null);
            success(
              schedule.mode === "Cron" && report.cron_errors.length === 0
                ? t("scheduler.savedCron", { name: schedule.name })
                : t("scheduler.saved", { name: schedule.name })
            );
            reportCron(report.cron_errors);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("scheduler.deleteTitle")}
          message={t("scheduler.deleteMessage", { name: deleting.name })}
          confirmLabel={t("common.delete")}
          dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const s = deleting;
            setDeleting(null);
            deleteSchedule(s.id).then(reportCron).catch((e) => error(String(e)));
          }}
        />
      )}

      {running && (
        <ConfirmDialog
          title={t("scheduler.runNow")}
          message={t("scheduler.runMessage", { action: t(ACTION_META[running.action].labelKey), target: targetName(running) })}
          confirmLabel={t("scheduler.run")}
          dangerous={running.action !== "Wake"}
          onCancel={() => setRunning(null)}
          onConfirm={() => runNow(running)}
        />
      )}
    </div>
  );
}
