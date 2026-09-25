import { useEffect, useState } from "react";
import { Camera, Loader2, RotateCcw, Copy, X } from "lucide-react";
import { ProxmoxVm, ProxmoxSnapshot } from "../types";
import { useStore } from "../stores/useStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { useT } from "../i18n";

interface VmSnapshotModalProps {
  vm: ProxmoxVm;
  connectionId: string;
  onClose: () => void;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function VmSnapshotModal({ vm, connectionId, onClose, onMessage }: VmSnapshotModalProps) {
  const { t } = useT();
  const { proxmoxSnapshotList, proxmoxSnapshotCreate, proxmoxSnapshotRollback, proxmoxCloneVm } = useStore();
  const [snapshots, setSnapshots] = useState<ProxmoxSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [newSnapshotName, setNewSnapshotName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ProxmoxSnapshot | null>(null);
  const [cloneName, setCloneName] = useState(`${vm.name}-clone`);
  const [cloning, setCloning] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const list = await proxmoxSnapshotList(connectionId, vm.node, vm.vmid, vm.vm_type);
      setSnapshots(list);
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!newSnapshotName.trim()) return;
    setCreating(true);
    try {
      await proxmoxSnapshotCreate(connectionId, vm.node, vm.vmid, vm.vm_type, newSnapshotName.trim());
      onMessage(t("proxmox.snapshots.created", { name: newSnapshotName }), "success");
      setNewSnapshotName("");
      await refresh();
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleRollback() {
    if (!rollbackTarget) return;
    // On ferme immédiatement la ConfirmDialog (avant l'await) : ConfirmDialog
    // n'a pas de prop `disabled` sur son bouton de confirmation, donc c'est
    // la seule façon d'empêcher un double-clic de déclencher deux appels
    // concurrents de proxmox_vm_snapshot_rollback (qui verrouille la config
    // de la VM côté Proxmox) sur le même snapshot.
    const target = rollbackTarget;
    setRollbackTarget(null);
    try {
      await proxmoxSnapshotRollback(connectionId, vm.node, vm.vmid, vm.vm_type, target.name);
      onMessage(t("proxmox.snapshots.rollbackStarted", { name: target.name }), "success");
    } catch (e) {
      onMessage(String(e), "error");
    }
  }

  async function handleClone() {
    if (!cloneName.trim()) return;
    setCloning(true);
    try {
      await proxmoxCloneVm(connectionId, vm.node, vm.vmid, vm.vm_type, cloneName.trim());
      onMessage(t("proxmox.snapshots.cloneStarted", { vm: vm.name, name: cloneName }), "success");
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setCloning(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md animate-slide-in">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border-primary">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-win bg-accent-primary/10">
                <Camera size={16} className="text-accent-primary" />
              </div>
              <h2 className="text-text-primary font-medium text-base">{t("proxmox.snapshots.title", { name: vm.name })}</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="p-5 space-y-5 max-h-[60vh] overflow-y-auto">
            <div className="space-y-2">
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 size={18} className="animate-spin text-text-secondary" />
                </div>
              ) : snapshots.length === 0 ? (
                <p className="text-text-secondary text-sm text-center py-4">{t("proxmox.snapshots.empty")}</p>
              ) : (
                snapshots.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2 bg-bg-secondary border border-border-primary rounded-win px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-text-primary text-sm truncate">{s.name}</p>
                      {s.description && <p className="text-text-secondary text-xs truncate">{s.description}</p>}
                    </div>
                    <button
                      onClick={() => setRollbackTarget(s)}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs rounded-win border border-border-primary text-text-secondary hover:text-accent-primary hover:border-accent-primary/50 transition-colors"
                      title={t("proxmox.snapshots.restore")}
                    >
                      <RotateCcw size={12} /> {t("proxmox.snapshots.restore")}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <input
                value={newSnapshotName}
                onChange={(e) => setNewSnapshotName(e.target.value)}
                placeholder={t("proxmox.snapshots.namePlaceholder")}
                className="flex-1 bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent-primary transition-colors"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newSnapshotName.trim()}
                className="px-3 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors disabled:opacity-50"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : t("proxmox.snapshots.create")}
              </button>
            </div>

            <div className="pt-4 border-t border-border-primary space-y-2">
              <p className="text-text-secondary text-xs">{t("proxmox.snapshots.cloneLabel")}</p>
              <div className="flex gap-2">
                <input
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="flex-1 bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent-primary transition-colors"
                />
                <button
                  onClick={handleClone}
                  disabled={cloning || !cloneName.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm bg-bg-secondary border border-border-primary text-text-primary rounded-win hover:bg-bg-hover transition-colors disabled:opacity-50"
                >
                  {cloning ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                  {t("proxmox.snapshots.clone")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {rollbackTarget && (
        <ConfirmDialog
          title={t("proxmox.snapshots.restoreTitle", { name: rollbackTarget.name })}
          message={t("proxmox.snapshots.restoreMessage", { vm: vm.name, name: rollbackTarget.name })}
          confirmLabel={t("proxmox.snapshots.restore")}
          dangerous
          onConfirm={handleRollback}
          onCancel={() => setRollbackTarget(null)}
        />
      )}
    </>
  );
}
