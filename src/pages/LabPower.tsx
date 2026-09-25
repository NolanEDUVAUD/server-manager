import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Play, Power, Sunrise, XCircle, FlaskConical } from "lucide-react";
import { useStore } from "../stores/useStore";
import { LabPlan, LabProgress } from "../types";
import { cn } from "../utils";
import { useT } from "../i18n";

// Phrases de confirmation vérifiées telles quelles par le backend (lab_power.rs) : jamais traduites
type Mode = "shutdown" | "startup";

export function LabPower() {
  const { t } = useT();
  const { servers } = useStore();
  const [mode, setMode] = useState<Mode>("shutdown");
  const [plan, setPlan] = useState<LabPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState("");
  const [progress, setProgress] = useState<Record<number, LabProgress>>({});
  const [running, setRunning] = useState(false);
  // Phrase à recopier, dans la langue de l'interface (le backend accepte chaque langue)
  const phrase = mode === "startup" ? t("labPower.phraseStartup") : t("labPower.phraseShutdown");

  useEffect(() => {
    const un = listen<LabProgress>("lab-power-progress", (e) => setProgress((p) => ({ ...p, [e.payload.step]: e.payload })));
    return () => { un.then((f) => f()); };
  }, []);

  function simulate() {
    setLoading(true);
    setError("");
    setProgress({});
    invoke<LabPlan>("lab_power_plan", { startup: mode === "startup" })
      .then(setPlan)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }
  useEffect(() => { setPlan(null); setConfirm(""); }, [mode]);

  async function execute() {
    setRunning(true);
    setProgress({});
    try {
      await invoke("lab_power_execute", { startup: mode === "startup", confirm });
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
      setConfirm("");
    }
  }

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? id;
  function describe(a: LabPlan["steps"][number]["actions"][number]): string {
    switch (a.type) {
      case "ShutdownServer": return t("labPower.actions.shutdownServer", { server: serverName(a.server_id) });
      case "WakeServer": return t("labPower.actions.wakeServer", { server: serverName(a.server_id) });
      case "ShutdownGuests": return t("labPower.actions.shutdownGuests", { guests: a.guests.map((g) => `${g.name} (${g.vmid})`).join(", ") });
      case "StartGuests": return t("labPower.actions.startGuests", { guests: a.guests.map((g) => `${g.name} (${g.vmid})`).join(", ") });
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-text-primary font-semibold text-lg">{t("labPower.title")}</h1>
        <p className="text-text-secondary text-xs mt-0.5">{t("labPower.subtitle")}</p>
      </div>

      <div className="flex gap-2">
        {([["shutdown", t("labPower.shutdownAll"), Power], ["startup", t("labPower.startupAll"), Sunrise]] as const).map(([m, label, Icon]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={running}
            className={cn("flex items-center gap-2 px-4 py-2 rounded-win border text-sm transition-all",
              mode === m ? "border-accent-primary bg-accent-primary/10 text-text-primary" : "border-border-primary text-text-secondary hover:bg-bg-hover")}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
        <button onClick={simulate} disabled={loading || running} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-win bg-accent-primary hover:bg-accent-secondary text-white text-sm disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />} {t("labPower.simulate")}
        </button>
      </div>

      <p className="text-xs text-text-muted">{t("labPower.simulateHint")}</p>
      {error && <p className="text-sm text-accent-error">{error}</p>}

      {plan && (
        <>
          {plan.warnings.length > 0 && (
            <div className="bg-bg-tertiary border border-accent-warning/30 rounded-win p-4 space-y-1.5">
              {plan.warnings.map((w) => <p key={w} className="flex items-start gap-2 text-xs text-accent-warning"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{w}</p>)}
            </div>
          )}
          <ol className="space-y-2">
            {plan.steps.map((s, i) => {
              const p = progress[i];
              return (
                <li key={i} className="flex gap-3 bg-bg-tertiary border border-border-primary rounded-win p-3">
                  <span className="mt-0.5">
                    {!p ? <Circle size={15} className="text-text-muted" />
                      : p.status === "running" ? <Loader2 size={15} className="animate-spin text-accent-primary" />
                      : p.status === "done" ? <CheckCircle2 size={15} className="text-accent-success" />
                      : <XCircle size={15} className="text-accent-error" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary"><span className="text-text-muted">{i + 1}.</span> {s.title} <span className="text-text-muted text-xs">· {s.detail}</span></p>
                    <ul className="mt-1 space-y-0.5">
                      {s.actions.map((a, j) => <li key={j} className="text-xs text-text-secondary">{describe(a)}</li>)}
                    </ul>
                    {p && p.status !== "running" && p.status !== "done" && <p className="text-xs text-accent-error mt-1">{p.message}</p>}
                  </div>
                </li>
              );
            })}
          </ol>

          {plan.steps.length > 0 && (
            <div className="bg-bg-tertiary border border-red-500/30 rounded-win p-4 space-y-3">
              <p className="text-sm text-text-primary">{t("labPower.executeTitle")}</p>
              <p className="text-xs text-text-secondary">
                {t("labPower.executeHint")} <code className="text-red-400">{phrase}</code>.
              </p>
              <div className="flex gap-2">
                <input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={running}
                  placeholder={phrase}
                  className="flex-1 bg-bg-input border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-red-400"
                  aria-label={t("labPower.confirmAria")}
                />
                {running ? (
                  <button onClick={() => invoke("lab_power_cancel")} className="px-4 py-2 rounded-win border border-border-primary text-sm text-text-secondary hover:bg-bg-hover">{t("labPower.cancelAfterStep")}</button>
                ) : (
                  <button onClick={execute} disabled={confirm.trim() !== phrase} className="flex items-center gap-2 px-4 py-2 rounded-win bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-40">
                    <Play size={14} /> {t("labPower.execute")}
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
