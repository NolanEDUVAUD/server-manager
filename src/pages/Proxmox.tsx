import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Server as ServerIcon, AlertCircle, Pencil, Trash2, Globe } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useProxmoxStatus } from "../hooks/useProxmoxStatus";
import { useToast } from "../hooks/useToast";
import { ClusterHealthPanel } from "../components/ClusterHealthPanel";
import { VmCard } from "../components/VmCard";
import { ProxmoxConnectionForm } from "../components/ProxmoxConnectionForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { ProxmoxConnection } from "../types";
import { useT } from "../i18n";

export function Proxmox() {
  const { proxmoxConnections, proxmoxVms, proxmoxErrors, loadProxmoxConnections, deleteProxmoxConnection, openDashboardTab } = useStore();
  const navigate = useNavigate();
  const { t } = useT();
  const { toasts, removeToast, success, error, info } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProxmoxConnection | null>(null);
  const [deleting, setDeleting] = useState<ProxmoxConnection | null>(null);

  useEffect(() => {
    loadProxmoxConnections().catch((e) => error(String(e)));
  }, []);

  useProxmoxStatus();

  function onMessage(msg: string, type: "success" | "error" | "info" = "info") {
    if (type === "success") success(msg);
    else if (type === "error") error(msg);
    else info(msg);
  }

  function openWebGui(conn: (typeof proxmoxConnections)[number]) {
    navigate("/dashboards");
    // Géométrie provisoire (plein écran) : useDashboardTabSync corrige la
    // position/taille dès que le conteneur de la page Dashboards est monté.
    openDashboardTab(
      { label: conn.id, connectionId: conn.id, url: conn.api_url, title: conn.name },
      0,
      0,
      window.innerWidth,
      window.innerHeight
    ).catch((e) => onMessage(String(e), "error"));
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteProxmoxConnection(deleting.id);
      success(t("proxmox.page.deleted", { name: deleting.name }));
    } catch (e) {
      error(String(e));
    } finally {
      setDeleting(null);
    }
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
          <Plus size={14} /> {t("proxmox.page.newConnection")}
        </button>
      </div>

      {proxmoxConnections.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <ServerIcon size={32} className="mx-auto mb-3 opacity-40" />
          <p>{t("proxmox.page.empty")}</p>
        </div>
      )}

      {proxmoxConnections.map((conn) => (
        <div key={conn.id} className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-text-primary font-medium text-sm">{conn.name}</h2>
            <span className="text-text-secondary text-xs font-mono">{conn.api_url}</span>
            {proxmoxErrors[conn.id] && (
              <span
                className="flex items-center gap-1 text-xs text-red-400"
                title={proxmoxErrors[conn.id] ?? undefined}
              >
                <AlertCircle size={12} /> {t("common.offline")}
              </span>
            )}
            <div className="flex items-center gap-1 ml-auto">
              <button
                onClick={() => openWebGui(conn)}
                className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                title={t("proxmox.page.openWeb")}
              >
                <Globe size={13} />
              </button>
              <button
                onClick={() => {
                  setEditing(conn);
                  setShowForm(true);
                }}
                className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                title={t("common.edit")}
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => setDeleting(conn)}
                className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all"
                title={t("common.delete")}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <ClusterHealthPanel connectionId={conn.id} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(proxmoxVms[conn.id] ?? []).map((vm) => (
              <VmCard key={`${conn.id}-${vm.node}-${vm.vm_type}-${vm.vmid}`} vm={vm} connectionId={conn.id} onMessage={onMessage} />
            ))}
          </div>
          {/* Liste chargée sans erreur mais vide : cas typique d'un jeton API avec
              « séparation des privilèges » sans rôle, qui voit les nœuds mais aucun invité */}
          {proxmoxVms[conn.id]?.length === 0 && !proxmoxErrors[conn.id] && (
            <div className="text-xs text-text-secondary bg-bg-tertiary border border-border-primary rounded-win p-4 space-y-2">
              <p className="flex items-center gap-2 text-accent-warning">
                <AlertCircle size={13} /> {t("proxmox.page.noGuests")}
              </p>
              <p>
                {t("proxmox.page.tokenBefore")} <code className="text-text-primary">{conn.token_id}</code>{" "}
                {t("proxmox.page.tokenAfter")}
              </p>
              <pre className="bg-bg-primary rounded p-2 font-mono text-[11px] text-text-primary select-text overflow-x-auto">{`pveum acl modify / --tokens '${conn.token_id}' --roles PVEVMAdmin
pveum acl modify /storage --tokens '${conn.token_id}' --roles PVEDatastoreUser`}</pre>
              <p className="text-text-muted">{t("proxmox.page.rolesHelp")}</p>
            </div>
          )}
        </div>
      ))}

      {showForm && (
        <ProxmoxConnectionForm
          connection={editing}
          onClose={() => setShowForm(false)}
          onMessage={onMessage}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t("proxmox.page.deleteTitle", { name: deleting.name })}
          message={t("proxmox.page.deleteMessage")}
          confirmLabel={t("common.delete")}
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
