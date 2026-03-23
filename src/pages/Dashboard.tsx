import { useState } from "react";
import { RefreshCw, Wifi, WifiOff, Server } from "lucide-react";
import { useStore } from "../stores/useStore";
import { ServerCard } from "../components/ServerCard";
import { ServerForm } from "../components/ServerForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Server as ServerType, ServerPayload } from "../types";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/Toast";

export function Dashboard() {
  const { servers, statuses, pingAll, addServer, updateServer, deleteServer } = useStore();
  const toast = useToast();

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
      toast.success(`Serveur "${payload.name}" ajouté`);
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
      toast.success(`Serveur "${payload.name}" mis à jour`);
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
      toast.success(`Serveur "${deletingServer.name}" supprimé`);
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
          <h1 className="text-xl font-bold text-win-text">Dashboard</h1>
          <p className="text-sm text-win-muted mt-0.5">
            {servers.length === 0
              ? "Aucun serveur configuré"
              : `${onlineCount} / ${servers.length} serveur${servers.length > 1 ? "s" : ""} en ligne`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-win
                       border border-win-border text-win-muted hover:text-win-text hover:bg-win-hover
                       transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Rafraîchir
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-win
                       bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all"
          >
            <Server size={14} />
            Ajouter
          </button>
        </div>
      </div>

      {/* Stats rapides */}
      {servers.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-win-card border border-win-border rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-win-accent/10">
                <Server size={16} className="text-win-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold text-win-text">{servers.length}</p>
                <p className="text-xs text-win-muted">Serveurs</p>
              </div>
            </div>
          </div>
          <div className="bg-win-card border border-win-border rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-green-500/10">
                <Wifi size={16} className="text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-green-400">{onlineCount}</p>
                <p className="text-xs text-win-muted">En ligne</p>
              </div>
            </div>
          </div>
          <div className="bg-win-card border border-win-border rounded-win p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-win bg-red-500/10">
                <WifiOff size={16} className="text-red-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">
                  {servers.length - onlineCount}
                </p>
                <p className="text-xs text-win-muted">Hors ligne</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grille des serveurs */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-win-card border border-win-border mb-4">
            <Server size={32} className="text-win-muted" />
          </div>
          <h3 className="text-win-text font-semibold mb-2">Aucun serveur configuré</h3>
          <p className="text-win-muted text-sm mb-4">
            Ajoutez votre premier serveur pour commencer à le gérer
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all"
          >
            Ajouter un serveur
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {servers.map((server) => (
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
          title={`Supprimer ${deletingServer.name}`}
          message="Cette action est irréversible. Le serveur sera retiré de tous les groupes."
          confirmLabel="Supprimer"
          dangerous
          onConfirm={handleDeleteServer}
          onCancel={() => setDeletingServer(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
