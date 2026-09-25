import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Zap, Power, RotateCcw, Play, Pencil, Trash2, CalendarClock, Info } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Schedule, ScheduleAction } from "../types";
import { ScheduleForm } from "../components/ScheduleForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { nextRun, formatDays } from "../utils/schedule";
import { cn } from "../utils";

const ACTION_META: Record<ScheduleAction, { label: string; icon: typeof Zap; color: string }> = {
  Wake: { label: "Allumer", icon: Zap, color: "text-yellow-400" },
  Shutdown: { label: "Éteindre", icon: Power, color: "text-red-400" },
  Reboot: { label: "Redémarrer", icon: RotateCcw, color: "text-accent-info" },
};

function formatNext(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Scheduler() {
  const {
    schedules, servers, groups, loadSchedules, saveSchedule, deleteSchedule, runScheduleNow,
    settings,
  } = useStore();
  const { toasts, removeToast, success, error } = useToast();
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
      return g ? `Groupe ${g.name}` : "Groupe supprimé";
    }
    return servers.find((x) => x.id === s.target.id)?.name ?? "Serveur supprimé";
  }

  async function toggle(s: Schedule) {
    try {
      await saveSchedule({ ...s, enabled: !s.enabled });
    } catch (e) {
      error(String(e));
    }
  }

  async function runNow(s: Schedule) {
    setRunning(null);
    try {
      await runScheduleNow(s.id);
      success(`« ${s.name} » exécutée — résultat dans l'Historique`);
    } catch (e) {
      error(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">Planificateur</h1>
          <p className="text-text-secondary text-xs mt-0.5">Allumages, extinctions et redémarrages programmés</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          disabled={servers.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win transition-colors disabled:opacity-50"
        >
          <Plus size={15} />
          Nouvelle tâche
        </button>
      </div>

      <div className="flex items-start gap-2 text-xs text-text-secondary bg-accent-info/5 border border-accent-info/20 rounded-win p-3">
        <Info size={14} className="text-accent-info shrink-0 mt-0.5" />
        <span>
          Les tâches s'exécutent tant que l'app est ouverte (même réduite).
          {!settings.general.auto_start && (
            <> Active le <Link to="/settings" className="text-accent-primary hover:underline">démarrage automatique</Link> pour ne pas en manquer.</>
          )}
        </span>
      </div>

      {schedules.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <CalendarClock size={28} className="opacity-50" />
          Aucune tâche planifiée.
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
                    <span className="text-text-secondary"> · {meta.label} {targetName(s)}</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {formatDays(s.days)} à {s.time}
                    {s.enabled && <> · prochaine : {formatNext(nextRun(s, now))}</>}
                  </p>
                </div>
                <button
                  onClick={() => toggle(s)}
                  className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", s.enabled ? "bg-accent-primary" : "bg-bg-hover")}
                  title={s.enabled ? "Désactiver" : "Activer"}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", s.enabled ? "left-[18px]" : "left-0.5")} />
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setRunning(s)} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all" title="Exécuter maintenant">
                    <Play size={13} />
                  </button>
                  <button onClick={() => setEditing(s)} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all" title="Modifier">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => setDeleting(s)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all" title="Supprimer">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ScheduleForm
          initial={editing === "new" ? undefined : editing}
          servers={servers}
          groups={groups}
          onCancel={() => setEditing(null)}
          onSubmit={async (schedule) => {
            await saveSchedule(schedule);
            setEditing(null);
            success(`Tâche « ${schedule.name} » enregistrée`);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Supprimer la tâche"
          message={`Supprimer « ${deleting.name} » ?`}
          confirmLabel="Supprimer"
          dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const s = deleting;
            setDeleting(null);
            deleteSchedule(s.id).catch((e) => error(String(e)));
          }}
        />
      )}

      {running && (
        <ConfirmDialog
          title="Exécuter maintenant"
          message={`${ACTION_META[running.action].label} ${targetName(running)} immédiatement ?`}
          confirmLabel="Exécuter"
          dangerous={running.action !== "Wake"}
          onCancel={() => setRunning(null)}
          onConfirm={() => runNow(running)}
        />
      )}
    </div>
  );
}
