import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, CheckCircle2, XCircle, Info, ArrowRightLeft } from "lucide-react";
import { MigrationPlan, ProxmoxVm } from "../types";
import { cn } from "../utils";
import { useT } from "../i18n";

/** Attend la fin d'une tâche Proxmox ; renvoie son statut de sortie (« OK » = succès) */
export async function waitTask(connectionId: string, node: string, upid: string, onTick?: () => void): Promise<string> {
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const [done, exit] = await invoke<[boolean, string]>("proxmox_task_status", { connectionId, node, upid });
    onTick?.();
    if (done) return exit;
  }
}

type Phase = { kind: "idle" } | { kind: "running"; seconds: number } | { kind: "done"; ok: boolean; message: string };

/** Migration d'un invité : faisabilité par nœud cible, lancement et suivi de la tâche */
export function MigrateModal({ vm, connectionId, onClose, onDone }: {
  vm: ProxmoxVm;
  connectionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [error, setError] = useState("");
  const [target, setTarget] = useState<string>("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    invoke<MigrationPlan>("proxmox_migration_plan", { connectionId, node: vm.node, vmid: vm.vmid, vmType: vm.vm_type })
      .then((p) => { setPlan(p); setTarget(p.targets.find((x) => x.allowed)?.node ?? ""); })
      .catch((e) => setError(String(e)));
  }, []);

  async function start() {
    if (!plan || !target) return;
    setPhase({ kind: "running", seconds: 0 });
    try {
      const upid = await invoke<string>("proxmox_migrate", {
        connectionId, node: vm.node, vmid: vm.vmid, vmType: vm.vm_type, name: vm.name, target, running: plan.running,
      });
      const exit = await waitTask(connectionId, vm.node, upid, () =>
        setPhase((p) => (p.kind === "running" ? { kind: "running", seconds: p.seconds + 3 } : p)));
      const ok = exit === "OK";
      setPhase({ kind: "done", ok, message: ok ? t("proxmox.migrate.done", { name: vm.name, target }) : t("proxmox.migrate.failed", { message: exit }) });
      if (ok) onDone();
    } catch (e) {
      setPhase({ kind: "done", ok: false, message: String(e) });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={phase.kind === "running" ? undefined : onClose} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-lg mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="flex items-center gap-2 text-text-primary font-semibold"><ArrowRightLeft size={16} /> {t("proxmox.migrate.title", { name: vm.name })}</h2>
          {phase.kind !== "running" && <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>}
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-sm text-accent-error">{error}</p>}
          {!plan && !error && <Loader2 size={18} className="animate-spin text-text-muted" />}
          {plan && (
            <>
              <p className="text-xs text-text-secondary">
                {t("proxmox.migrate.from")} <span className="text-text-primary">{vm.node}</span> · {plan.running ? (vm.vm_type === "qemu" ? t("proxmox.migrate.live") : t("proxmox.migrate.restart")) : t("proxmox.migrate.stopped")}
                {plan.local_disks.length > 0 && ` · ${t("proxmox.migrate.localDisks", { disks: plan.local_disks.join(", ") })}`}
              </p>
              {plan.notes.map((n) => (
                <p key={n} className="flex items-start gap-2 text-xs text-accent-warning"><Info size={13} className="shrink-0 mt-0.5" />{n}</p>
              ))}
              <div className="space-y-1.5">
                {plan.targets.map((tg) => (
                  <label
                    key={tg.node}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2 rounded-win border text-sm",
                      tg.allowed ? "cursor-pointer border-border-primary hover:bg-bg-hover" : "border-transparent opacity-70",
                      target === tg.node && "border-accent-primary/50 bg-accent-primary/10"
                    )}
                  >
                    <input type="radio" name="target" disabled={!tg.allowed || phase.kind === "running"} checked={target === tg.node} onChange={() => setTarget(tg.node)} className="mt-1 accent-accent-primary" />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-text-primary">
                        {tg.allowed ? <CheckCircle2 size={13} className="text-accent-success" /> : <XCircle size={13} className="text-accent-error" />}
                        {tg.node}
                      </span>
                      {tg.reasons.map((r) => <span key={r} className="block text-xs text-text-muted">{r}</span>)}
                    </span>
                  </label>
                ))}
              </div>
              {!plan.targets.some((x) => x.allowed) && (
                <p className="text-xs text-text-muted">
                  {t("proxmox.migrate.noTarget")}
                </p>
              )}
              {phase.kind === "running" && <p className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 size={14} className="animate-spin" /> {t("proxmox.migrate.running", { seconds: phase.seconds })}</p>}
              {phase.kind === "done" && <p className={cn("text-sm", phase.ok ? "text-accent-success" : "text-accent-error")}>{phase.message}</p>}
            </>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button onClick={onClose} disabled={phase.kind === "running"} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-50">
              {phase.kind === "done" ? t("common.close") : t("common.cancel")}
            </button>
            {phase.kind !== "done" && (
              <button onClick={start} disabled={!target || phase.kind === "running"} className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium disabled:opacity-50">
                {t("proxmox.migrate.submit", { target: target || "…" })}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
