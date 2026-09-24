import { useEffect, useState } from "react";
import { Plus, Server as ServerIcon, AlertCircle } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useProxmoxStatus } from "../hooks/useProxmoxStatus";
import { useToast } from "../hooks/useToast";
import { VmCard } from "../components/VmCard";
import { ProxmoxConnectionForm } from "../components/ProxmoxConnectionForm";
import { ToastContainer } from "../components/Toast";
import { ProxmoxConnection } from "../types";

export function Proxmox() {
  const { proxmoxConnections, proxmoxVms, proxmoxErrors, loadProxmoxConnections } = useStore();
  const { toasts, removeToast, success, error, info } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProxmoxConnection | null>(null);

  useEffect(() => {
    loadProxmoxConnections().catch((e) => error(String(e)));
  }, []);

  useProxmoxStatus();

  function onMessage(msg: string, type: "success" | "error" | "info" = "info") {
    if (type === "success") success(msg);
    else if (type === "error") error(msg);
    else info(msg);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-text-primary font-semibold text-lg">Proxmox</h1>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors"
        >
          <Plus size={14} /> Nouvelle connexion
        </button>
      </div>

      {proxmoxConnections.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <ServerIcon size={32} className="mx-auto mb-3 opacity-40" />
          <p>Aucune connexion Proxmox configurée</p>
        </div>
      )}

      {proxmoxConnections.map((conn) => (
        <div key={conn.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-text-primary font-medium text-sm">{conn.name}</h2>
            <span className="text-text-secondary text-xs font-mono">{conn.api_url}</span>
            {proxmoxErrors[conn.id] && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <AlertCircle size={12} /> Hors ligne
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(proxmoxVms[conn.id] ?? []).map((vm) => (
              <VmCard key={`${conn.id}-${vm.node}-${vm.vm_type}-${vm.vmid}`} vm={vm} connectionId={conn.id} onMessage={onMessage} />
            ))}
          </div>
        </div>
      ))}

      {showForm && (
        <ProxmoxConnectionForm
          connection={editing}
          onClose={() => setShowForm(false)}
          onMessage={onMessage}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
