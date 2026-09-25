import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { MigrationPlan, ProxmoxVm } from "../types";
import { waitTask } from "./MigrateModal";
import { cn } from "../utils";
import { useT } from "../i18n";

type Row = { vm: ProxmoxVm; plan?: MigrationPlan; error?: string; target?: string; state: "check" | "ready" | "blocked" | "running" | "ok" | "failed"; message?: string };

/**
 * Vider un nœud : migre un à un ses invités démarrés vers la première cible possible.
 * Les invités impossibles à déplacer sont listés avec la raison, sans rien tenter.
 */
export function DrainNodeModal({ connectionId, node, onClose }: { connectionId: string; node: string; onClose: () => void }) {
  const { t } = useT();
  const { proxmoxVms, loadProxmoxVms } = useStore();
  const guests = (proxmoxVms[connectionId] ?? []).filter((v) => v.node === node && v.status === "running");
  const [rows, setRows] = useState<Row[]>(guests.map((vm) => ({ vm, state: "check" })));
  const [running, setRunning] = useState(false);

  const update = (vmid: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.vm.vmid === vmid ? { ...r, ...patch } : r)));

  useEffect(() => {
    for (const vm of guests) {
      invoke<MigrationPlan>("proxmox_migration_plan", { connectionId, node, vmid: vm.vmid, vmType: vm.vm_type })
        .then((plan) => {
          const target = plan.targets.find((x) => x.allowed)?.node;
          update(vm.vmid, target
            ? { plan, target, state: "ready" }
            : { plan, state: "blocked", message: plan.targets[0]?.reasons.join(" · ") || plan.notes.join(" · ") || t("proxmox.drain.noTarget") });
        })
        .catch((e) => update(vm.vmid, { state: "blocked", message: String(e) }));
    }
  }, []);

  async function drain() {
    setRunning(true);
    // Séquentiel : une migration à la fois pour ne pas saturer le réseau et les disques
    for (const r of rows.filter((x) => x.state === "ready")) {
      update(r.vm.vmid, { state: "running" });
      try {
        const upid = await invoke<string>("proxmox_migrate", {
          connectionId, node, vmid: r.vm.vmid, vmType: r.vm.vm_type, name: r.vm.name, target: r.target, running: true,
        });
        const exit = await waitTask(connectionId, node, upid);
        update(r.vm.vmid, exit === "OK" ? { state: "ok", message: `→ ${r.target}` } : { state: "failed", message: exit });
      } catch (e) {
        update(r.vm.vmid, { state: "failed", message: String(e) });
      }
    }
    setRunning(false);
    loadProxmoxVms(connectionId).catch(() => {});
  }

  const ready = rows.filter((r) => r.state === "ready").length;
  const checking = rows.some((r) => r.state === "check");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={running ? undefined : onClose} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-xl mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">{t("proxmox.drain.title", { node })}</h2>
          {!running && <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>}
        </div>
        <div className="p-5 space-y-3">
          {guests.length === 0 ? <p className="text-sm text-text-muted">{t("proxmox.drain.empty")}</p> : (
            <div className="divide-y divide-border-secondary max-h-80 overflow-y-auto">
              {rows.map((r) => (
                <div key={r.vm.vmid} className="flex items-start gap-3 py-2 text-sm">
                  {r.state === "check" || r.state === "running" ? <Loader2 size={14} className="animate-spin text-text-muted mt-0.5" />
                    : r.state === "ok" || r.state === "ready" ? <CheckCircle2 size={14} className="text-accent-success mt-0.5" />
                    : r.state === "blocked" ? <MinusCircle size={14} className="text-text-muted mt-0.5" />
                    : <XCircle size={14} className="text-accent-error mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary">{r.vm.name} <span className="text-text-muted">· {r.vm.vm_type.toUpperCase()} {r.vm.vmid}</span></p>
                    <p className={cn("text-xs", r.state === "failed" ? "text-accent-error" : "text-text-muted")}>
                      {r.state === "ready" ? t("proxmox.drain.ready", { target: r.target ?? "" }) : r.state === "blocked" ? t("proxmox.drain.blocked", { reason: r.message ?? "" }) : r.message ?? ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button onClick={onClose} disabled={running} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover disabled:opacity-50">{t("common.close")}</button>
            <button onClick={drain} disabled={running || checking || ready === 0} className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium disabled:opacity-50">
              {running ? t("proxmox.drain.running") : t("proxmox.drain.migrate", { count: ready })}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
