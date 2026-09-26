import { useState } from "react";
import { X, CalendarClock } from "lucide-react";
import { Group, Schedule, ScheduleAction, ScheduleMode, Server } from "../types";
import { DAY_KEYS } from "../utils/schedule";
import { cn } from "../utils";
import { useT, TKey } from "../i18n";

interface ScheduleFormProps {
  initial?: Schedule;
  servers: Server[];
  groups: Group[];
  onSubmit: (schedule: Schedule) => Promise<void>;
  onCancel: () => void;
}

const ACTIONS: { value: ScheduleAction; labelKey: TKey }[] = [
  { value: "Wake", labelKey: "scheduler.form.wakeOnLan" },
  { value: "Shutdown", labelKey: "scheduler.actions.shutdown" },
  { value: "Reboot", labelKey: "scheduler.actions.reboot" },
];

/** Raccourcis de sélection des jours */
const PRESETS: { labelKey: TKey; days: number[] }[] = [
  { labelKey: "scheduler.form.presetWeek", days: [0, 1, 2, 3, 4] },
  { labelKey: "scheduler.form.presetWeekend", days: [5, 6] },
  { labelKey: "scheduler.form.presetAll", days: [0, 1, 2, 3, 4, 5, 6] },
];

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors";

export function ScheduleForm({ initial, servers, groups, onSubmit, onCancel }: ScheduleFormProps) {
  const { t } = useT();
  const firstTarget = servers[0]
    ? `Server:${servers[0].id}`
    : groups[0] ? `Group:${groups[0].id}` : "";
  const [name, setName] = useState(initial?.name ?? "");
  const [action, setAction] = useState<ScheduleAction>(initial?.action ?? "Shutdown");
  const [target, setTarget] = useState(initial ? `${initial.target.kind}:${initial.target.id}` : firstTarget);
  const [time, setTime] = useState(initial?.time ?? "23:00");
  const [days, setDays] = useState<number[]>(initial?.days ?? [0, 1, 2, 3, 4]);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [mode, setMode] = useState<ScheduleMode>(initial?.mode ?? "App");
  // Un Wake-on-LAN ne peut pas tourner en cron sur une machine éteinte
  const effectiveMode: ScheduleMode = action === "Wake" ? "App" : mode;
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError(t("scheduler.form.nameRequired"));
    if (!target) return setError(t("scheduler.form.targetRequired"));
    if (days.length === 0) return setError(t("scheduler.form.daysRequired"));
    const [kind, id] = target.split(":") as ["Server" | "Group", string];
    setSubmitting(true);
    try {
      await onSubmit({
        id: initial?.id ?? "",
        name: name.trim(),
        enabled,
        action,
        mode: effectiveMode,
        target: { kind, id },
        days,
        time,
        last_run: initial?.last_run ?? null,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-6 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-accent-primary/10">
              <CalendarClock size={18} className="text-accent-primary" />
            </div>
            <h2 className="text-text-primary font-semibold">{initial ? t("scheduler.form.editTitle") : t("scheduler.form.newTitle")}</h2>
          </div>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t("scheduler.form.name")}</label>
            <input aria-label={t("scheduler.form.nameLabel")} className={inputClass} value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder={t("scheduler.form.namePlaceholder")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">{t("scheduler.form.action")}</label>
              <select aria-label={t("scheduler.form.action")} className={inputClass} value={action} onChange={(e) => setAction(e.target.value as ScheduleAction)}>
                {ACTIONS.map((a) => <option key={a.value} value={a.value}>{t(a.labelKey)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">{t("scheduler.form.time")}</label>
              <input type="time" aria-label={t("scheduler.form.time")} className={inputClass} value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">{t("scheduler.form.target")}</label>
            <select aria-label={t("scheduler.form.target")} className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              {groups.length > 0 && (
                <optgroup label={t("scheduler.form.groups")}>
                  {groups.map((g) => {
                    const iconPrefix = g.icon && !g.icon.toLowerCase().startsWith('lucide:') && !g.icon.toLowerCase().startsWith('file:') ? `${g.icon} ` : "";
                    return <option key={g.id} value={`Group:${g.id}`}>{iconPrefix}{g.name}</option>;
                  })}
                </optgroup>
              )}
              <optgroup label={t("scheduler.form.servers")}>
                {servers.map((s) => <option key={s.id} value={`Server:${s.id}`}>{s.name}</option>)}
              </optgroup>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">{t("scheduler.form.days")}</label>
              <div className="flex gap-2">
                {PRESETS.map((p) => (
                  <button key={p.labelKey} type="button" onClick={() => setDays(p.days)} className="text-[11px] text-accent-primary hover:underline">
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {DAY_KEYS.map((dayKey, d) => (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "py-1.5 text-xs rounded-win border transition-all",
                    days.includes(d)
                      ? "bg-accent-primary/15 border-accent-primary/50 text-text-primary"
                      : "border-border-primary text-text-muted hover:bg-bg-hover"
                  )}
                >
                  {t(dayKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">{t("scheduler.form.execution")}</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                ["App", t("scheduler.form.modeApp"), t("scheduler.form.modeAppHint")],
                ["Cron", t("scheduler.form.modeCron"), t("scheduler.form.modeCronHint")],
              ] as const).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  disabled={value === "Cron" && action === "Wake"}
                  onClick={() => setMode(value)}
                  className={cn(
                    "text-left px-3 py-2 rounded-win border transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                    effectiveMode === value
                      ? "bg-accent-primary/15 border-accent-primary/50"
                      : "border-border-primary hover:bg-bg-hover"
                  )}
                >
                  <span className="block text-sm text-text-primary">{label}</span>
                  <span className="block text-[11px] text-text-muted">{hint}</span>
                </button>
              ))}
            </div>
            {action === "Wake" && (
              <p className="text-[11px] text-text-muted mt-1.5">{t("scheduler.form.wakeNote")}</p>
            )}
            {effectiveMode === "Cron" && (
              <p className="text-[11px] text-text-muted mt-1.5">
                {t("scheduler.form.cronNoteBefore")} <code>sudo</code>{t("scheduler.form.cronNoteAfter")}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-accent-primary" />
            {t("scheduler.form.active")}
          </label>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all">
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={submitting} className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50">
              {submitting ? t("common.saving") : initial ? t("scheduler.form.update") : t("scheduler.form.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
