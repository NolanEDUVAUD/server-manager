import { useState, useMemo } from "react";
import { Plus, Search, Server, Pencil, Trash2, Zap, Power, RotateCcw, Loader2 } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Server as ServerType, ServerPayload, OS_ICONS } from "../types";
import { ServerForm } from "../components/ServerForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";

export function Servers() {
  const { servers, statuses, addServer, updateServer, deleteServer, wakeServer, shutdownServer, rebootServer } = useStore();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerType | null>(null);
  const [deletingServer, setDeletingServer] = useState<ServerType | null>(null);
  const [loadingAction, setLoadingAction] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return servers;
    const q = search.toLowerCase();
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.ip.includes(q) ||
        s.os_type.toLowerCase().includes(q)
    );
  }, [servers, search]);

  async function runAction(serverId: string, key: string, action: () => Promise<unknown>, msg: string) {
    setLoadingAction((prev) => ({ ...prev, [serverId]: key }));
    try {
      await action();
      toast.success(msg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingAction((prev) => {
        const next = { ...prev };
        delete next[serverId];
        return next;
      });
    }
  }

  async function handleAdd(payload: ServerPayload) {
    try {
      await addServer(payload);
      toast.success(`Serveur "${payload.name}" ajouté`);
      setShowAddForm(false);
    } catch (e) {
      toast.error(String(e));
      throw e;
    }
  }

  async function handleEdit(payload: ServerPayload) {
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

  async function handleDelete() {
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
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Serveurs</h1>
          <p className="text-sm text-text-secondary mt-0.5">{servers.length} serveur{servers.length > 1 ? "s" : ""} configuré{servers.length > 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
        >
          <Plus size={14} />
          Ajouter
        </button>
      </div>

      {/* Barre de recherche */}
      {servers.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="w-full bg-bg-secondary border border-border-primary rounded-win pl-9 pr-4 py-2 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary transition-colors"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, IP ou OS…"
          />
        </div>
      )}

      {/* Liste */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-bg-tertiary border border-border-primary mb-4">
            <Server size={32} className="text-text-secondary" />
          </div>
          <h3 className="text-text-primary font-semibold mb-2">Aucun serveur</h3>
          <p className="text-text-secondary text-sm mb-4">Ajoutez votre premier serveur</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
          >
            Ajouter un serveur
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((server) => {
            const loading = loadingAction[server.id];
            return (
              <div
                key={server.id}
                className="bg-bg-tertiary border border-border-primary rounded-win shadow-win hover:border-accent-primary/30 transition-all duration-200 p-4"
              >
                <div className="flex items-center gap-4">
                  {/* Icône + nom */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-2xl shrink-0">{server.icon || OS_ICONS[server.os_type]}</span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-text-primary font-semibold text-sm truncate">{server.name}</h3>
                        <span className="text-xs text-text-secondary/60 bg-bg-secondary px-1.5 py-0.5 rounded font-mono">
                          {server.os_type}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary font-mono">
                        {server.ssh_user}@{server.ip}:{server.ssh_port}
                      </p>
                    </div>
                  </div>

                  {/* Statut */}
                  <StatusBadge status={statuses[server.id]} size="sm" />

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => runAction(server.id, "wol", () => wakeServer(server.id), `WoL envoyé à ${server.name}`)}
                      disabled={!!loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-all disabled:opacity-50"
                      title="Wake-on-LAN"
                    >
                      {loading === "wol" ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      WoL
                    </button>
                    <button
                      onClick={() => runAction(server.id, "shutdown", () => shutdownServer(server.id), `Arrêt envoyé à ${server.name}`)}
                      disabled={!!loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                      title="Éteindre"
                    >
                      {loading === "shutdown" ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                      Off
                    </button>
                    <button
                      onClick={() => runAction(server.id, "reboot", () => rebootServer(server.id), `Reboot envoyé à ${server.name}`)}
                      disabled={!!loading}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all disabled:opacity-50"
                      title="Redémarrer"
                    >
                      {loading === "reboot" ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
                      Reboot
                    </button>
                    <div className="w-px h-5 bg-border-primary mx-1" />
                    <button
                      onClick={() => setEditingServer(server)}
                      className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeletingServer(server)}
                      className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Notes */}
                {server.notes && (
                  <p className="text-xs text-text-secondary/70 mt-2 pl-11 leading-relaxed">{server.notes}</p>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-text-secondary text-sm">
              Aucun serveur ne correspond à "{search}"
            </div>
          )}
        </div>
      )}

      {showAddForm && <ServerForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />}
      {editingServer && <ServerForm initial={editingServer} onSubmit={handleEdit} onCancel={() => setEditingServer(null)} />}
      {deletingServer && (
        <ConfirmDialog
          title={`Supprimer ${deletingServer.name}`}
          message="Cette action est irréversible. Le serveur sera retiré de tous les groupes."
          confirmLabel="Supprimer"
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDeletingServer(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
