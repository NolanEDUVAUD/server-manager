import { useState } from "react";
import { Play, Square, RotateCcw, PauseCircle, Camera, Loader2, ArrowRightLeft } from "lucide-react";
import { ProxmoxVm } from "../types";
import { useStore } from "../stores/useStore";
import { cn, formatBytes } from "../utils";
import { VmSnapshotModal } from "./VmSnapshotModal";
import { MigrateModal } from "./MigrateModal";

interface VmCardProps {
  vm: ProxmoxVm;
  connectionId: string;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function VmCard({ vm, connectionId, onMessage }: VmCardProps) {
  const { proxmoxVmAction } = useStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [showMigrate, setShowMigrate] = useState(false);

  const isRunning = vm.status === "running";

  async function runAction(key: string, action: "start" | "stop" | "shutdown" | "reboot" | "suspend") {
    if (loading) return;
    setLoading(key);
    try {
      await proxmoxVmAction(connectionId, vm.node, vm.vmid, vm.vm_type, action);
      onMessage(`Action "${action}" envoyée à ${vm.name}`, "success");
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div
      className={cn(
        "bg-bg-tertiary border border-border-primary rounded-win shadow-win",
        "hover:shadow-win-hover hover:border-accent-primary/30 transition-all duration-200",
        "flex flex-col gap-3 p-4"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-text-primary font-semibold text-sm truncate leading-tight">{vm.name}</h3>
          <p className="text-text-secondary text-xs truncate font-mono">
            {vm.node} · {vm.vm_type.toUpperCase()} #{vm.vmid}
          </p>
        </div>
        <span
          className={cn(
            "text-xs px-2 py-0.5 rounded-full font-medium shrink-0",
            isRunning
              ? "bg-green-500/10 text-green-400 border border-green-500/20"
              : "bg-gray-500/10 text-gray-400 border border-gray-500/20"
          )}
        >
          {isRunning ? "En cours" : "Arrêtée"}
        </span>
      </div>

      <div className="grid grid-cols-[3rem_1fr_auto] gap-3 text-xs">
        <div>
          <p className="text-text-secondary">CPU</p>
          <p className="text-text-primary font-mono">{Math.round(vm.cpu * 100)}%</p>
        </div>
        <div>
          <p className="text-text-secondary">RAM</p>
          <p className="text-text-primary font-mono whitespace-nowrap">
            {formatBytes(vm.mem)} / {formatBytes(vm.maxmem)}
          </p>
        </div>
        <div>
          <p className="text-text-secondary">Disque</p>
          <p className="text-text-primary font-mono whitespace-nowrap">{formatBytes(vm.maxdisk)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {!isRunning ? (
          <button
            onClick={() => runAction("start", "start")}
            disabled={!!loading}
            title="Démarrer"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                       border border-green-500/30 bg-green-500/5 text-green-400
                       hover:bg-green-500/15 text-xs font-medium transition-all disabled:opacity-50"
          >
            {loading === "start" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Démarrer
          </button>
        ) : (
          <>
            <button
              onClick={() => runAction("stop", "stop")}
              disabled={!!loading}
              title="Arrêter"
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-red-500/30 bg-red-500/5 text-red-400
                         hover:bg-red-500/15 text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "stop" ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />}
              Arrêter
            </button>
            <button
              onClick={() => runAction("reboot", "reboot")}
              disabled={!!loading}
              title="Redémarrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-border-primary bg-bg-secondary text-text-secondary
                         hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "reboot" ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Reboot
            </button>
            <button
              onClick={() => runAction("suspend", "suspend")}
              disabled={!!loading}
              title="Suspendre"
              className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                         border border-border-primary bg-bg-secondary text-text-secondary
                         hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
            >
              {loading === "suspend" ? <Loader2 size={12} className="animate-spin" /> : <PauseCircle size={12} />}
            </button>
          </>
        )}
        <button
          onClick={() => setShowSnapshots(true)}
          disabled={!!loading}
          title="Snapshots"
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                     border border-border-primary bg-bg-secondary text-text-secondary
                     hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
        >
          <Camera size={12} />
        </button>
        <button
          onClick={() => setShowMigrate(true)}
          disabled={!!loading}
          title="Migrer vers un autre nœud"
          className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                     border border-border-primary bg-bg-secondary text-text-secondary
                     hover:bg-bg-hover text-xs font-medium transition-all disabled:opacity-50"
        >
          <ArrowRightLeft size={12} />
        </button>
      </div>

      {showMigrate && (
        <MigrateModal
          vm={vm}
          connectionId={connectionId}
          onClose={() => setShowMigrate(false)}
          onDone={() => useStore.getState().loadProxmoxVms(connectionId).catch(() => {})}
        />
      )}

      {showSnapshots && (
        <VmSnapshotModal
          vm={vm}
          connectionId={connectionId}
          onClose={() => setShowSnapshots(false)}
          onMessage={onMessage}
        />
      )}
    </div>
  );
}
