import { useState } from "react";
import { RefreshCw, Wifi, WifiOff, Server } from "lucide-react";
import { useStore } from "../stores/useStore";
import { ServerCard } from "../components/ServerCard";
import { ServerForm } from "../components/ServerForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Server as ServerType, ServerPayload } from "../types";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/Toast";
import { sortFavoritesFirst } from "../utils/filters";
import { useT } from "../i18n";

export function Dashboard() {
  const { servers, statuses, pingAll, addServer, updateServer, deleteServer } = useStore();
  const toast = useToast();
  const { t } = useT();

  const [refreshing, setRefreshing] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerType | null>(null);
  const [deletingServer, setDeletingServer] = useState<ServerType | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const onlineCount = servers.filter((s) => statuses[s.id]?.online).length;

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await pingAll();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleAddServer(payload: ServerPayload) {
    try {
      await addServer(payload);
      toast.success(t("dashboard.added", { name: payload.name }));
      setShowAddForm(false);
    } catch (e) {
      toast.error(String(e));
      throw e;
    }
  }

  async function handleEditServer(payload: ServerPayload) {
    if (!editingServer) return;
    try {
      await updateServer(editingServer.id, payload);
      toast.success(t("dashboard.updated", { name: payload.name }));
      setEditingServer(null);
    } catch (e) {
      toast.error(String(e));
      throw e;
    }
  }

  async function handleDeleteServer() {
    if (!deletingServer) return;
    try {
      await deleteServer(deletingServer.id);
      toast.success(t("dashboard.deleted", { name: deletingServer.name }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletingServer(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("dashboard.title")}</h1>
          <p className="text-sm text-text-secondary mt-0.5">
            {servers.length === 0
              ? t("dashboard.noServers")
              : t("dashboard.onlineSummary", { online: onlineCount, count: servers.length })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-win
                       border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover
                       transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            {t("dashboard.refresh")}
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-win
                       bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
          >
            <Server size={14} />
            {t("common.add")}
          </button>
        </div>
      </div>

      {/* Stats rapides */}
      {servers.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-bg-tertiary border border-border-primary rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-accent-primary/10">
                <Server size={16} className="text-accent-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{servers.length}</p>
                <p className="text-xs text-text-secondary">{t("dashboard.statServers")}</p>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary border border-border-primary rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-green-500/10">
                <Wifi size={16} className="text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-400">{onlineCount}</p>
                <p className="text-xs text-text-secondary">{t("common.online")}</p>
              </div>
            </div>
          </div>
          <div className="bg-bg-tertiary border border-border-primary rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-red-500/10">
                <WifiOff size={16} className="text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">
                  {servers.length - onlineCount}
                </p>
                <p className="text-xs text-text-secondary">{t("common.offline")}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grille des serveurs */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-bg-tertiary border border-border-primary mb-4">
            <Server size={32} className="text-text-secondary" />
          </div>
          <h3 className="text-text-primary font-semibold mb-2">{t("dashboard.noServers")}</h3>
          <p className="text-text-secondary text-sm mb-4">
            {t("dashboard.emptyHint")}
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
          >
            {t("dashboard.addServer")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {sortFavoritesFirst(servers, (s) => !!s.favorite).map((server) => (
            <ServerCard
              key={server.id}
              server={server}
              onEdit={setEditingServer}
              onDelete={setDeletingServer}
              onMessage={(msg, type) =>
                type === "error" ? toast.error(msg) : toast.success(msg)
              }
            />
          ))}
        </div>
      )}

      {/* Formulaires */}
      {showAddForm && (
        <ServerForm onSubmit={handleAddServer} onCancel={() => setShowAddForm(false)} />
      )}
      {editingServer && (
        <ServerForm
          initial={editingServer}
          onSubmit={handleEditServer}
          onCancel={() => setEditingServer(null)}
        />
      )}
      {deletingServer && (
        <ConfirmDialog
          title={t("dashboard.deleteTitle", { name: deletingServer.name })}
          message={t("dashboard.deleteMessage")}
          confirmLabel={t("common.delete")}
          dangerous
          onConfirm={handleDeleteServer}
          onCancel={() => setDeletingServer(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
