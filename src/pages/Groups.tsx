import { useState } from "react";
import { Plus, Layers, Zap, Power, Wifi, Pencil, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Group } from "../types";
import { GroupForm } from "../components/GroupForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";

export function Groups() {
  const { servers, groups, statuses, addGroup, updateGroup, deleteGroup, wakeGroup, shutdownGroup, pingAll } = useStore();
  const toast = useToast();

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<Group | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingAction, setLoadingAction] = useState<Record<string, string>>({});

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function runGroupAction(
    groupId: string,
    key: string,
    action: () => Promise<unknown>,
    msg: string
  ) {
    setLoadingAction((prev) => ({ ...prev, [groupId]: key }));
    try {
      await action();
      toast.success(msg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoadingAction((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
  }

  async function handleAdd(name: string, icon: string | undefined, serverIds: string[]) {
    try {
      const group = await addGroup(name, icon);
      if (serverIds.length > 0) {
        await updateGroup(group.id, { server_ids: serverIds });
      }
      toast.success(`Groupe "${name}" créé`);
      setShowAddForm(false);
    } catch (e) {
      toast.error(String(e));
      throw e;
    }
  }

  async function handleEdit(name: string, icon: string | undefined, serverIds: string[]) {
    if (!editingGroup) return;
    try {
      await updateGroup(editingGroup.id, { name, icon, server_ids: serverIds });
      toast.success(`Groupe "${name}" mis à jour`);
      setEditingGroup(null);
    } catch (e) {
      toast.error(String(e));
      throw e;
    }
  }

  async function handleDelete() {
    if (!deletingGroup) return;
    try {
      await deleteGroup(deletingGroup.id);
      toast.success(`Groupe "${deletingGroup.name}" supprimé`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletingGroup(null);
    }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-win-text">Groupes</h1>
          <p className="text-sm text-win-muted mt-0.5">{groups.length} groupe{groups.length > 1 ? "s" : ""}</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-win bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all"
        >
          <Plus size={14} />
          Créer un groupe
        </button>
      </div>

      {/* Liste des groupes */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-win-card border border-win-border mb-4">
            <Layers size={32} className="text-win-muted" />
          </div>
          <h3 className="text-win-text font-semibold mb-2">Aucun groupe</h3>
          <p className="text-win-muted text-sm mb-4">
            Regroupez vos serveurs pour les contrôler en 1 clic
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all"
          >
            Créer un groupe
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupServers = servers.filter((s) => group.server_ids.includes(s.id));
            const onlineCount = groupServers.filter((s) => statuses[s.id]?.online).length;
            const loading = loadingAction[group.id];
            const isExpanded = expanded.has(group.id);

            return (
              <div key={group.id} className="bg-win-card border border-win-border rounded-win shadow-win">
                {/* Header du groupe */}
                <div className="flex items-center gap-4 p-4">
                  <button
                    onClick={() => toggleExpand(group.id)}
                    className="text-win-muted hover:text-win-text transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  <span className="text-xl">{group.icon ?? "🗂️"}</span>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-win-text font-semibold text-sm">{group.name}</h3>
                    <p className="text-xs text-win-muted">
                      {groupServers.length} serveur{groupServers.length > 1 ? "s" : ""}
                      {groupServers.length > 0 && (
                        <span className="ml-2 text-green-400">{onlineCount} en ligne</span>
                      )}
                    </p>
                  </div>

                  {/* Actions de groupe */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        runGroupAction(group.id, "ping", pingAll, `Ping du groupe "${group.name}" lancé`)
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-win-border text-win-muted hover:text-win-text hover:bg-win-hover transition-all disabled:opacity-50"
                    >
                      {loading === "ping" ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />}
                      Ping
                    </button>
                    <button
                      onClick={() =>
                        runGroupAction(
                          group.id,
                          "wol",
                          () => wakeGroup(group.id),
                          `WoL envoyé au groupe "${group.name}"`
                        )
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-all disabled:opacity-50"
                    >
                      {loading === "wol" ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      WoL tout
                    </button>
                    <button
                      onClick={() =>
                        runGroupAction(
                          group.id,
                          "shutdown",
                          () => shutdownGroup(group.id),
                          `Arrêt envoyé au groupe "${group.name}"`
                        )
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                    >
                      {loading === "shutdown" ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                      Tout éteindre
                    </button>
                    <div className="w-px h-5 bg-win-border mx-1" />
                    <button
                      onClick={() => setEditingGroup(group)}
                      className="p-1.5 rounded text-win-muted hover:text-win-accent hover:bg-win-accent/10 transition-all"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeletingGroup(group)}
                      className="p-1.5 rounded text-win-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Serveurs du groupe (expandable) */}
                {isExpanded && groupServers.length > 0 && (
                  <div className="border-t border-win-border px-4 py-3 space-y-2">
                    {groupServers.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-win bg-win-surface">
                        <span className="text-base">{s.icon ?? "🖥️"}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-win-text truncate">{s.name}</p>
                          <p className="text-xs text-win-muted font-mono">{s.ip}</p>
                        </div>
                        <StatusBadge status={statuses[s.id]} size="sm" />
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && groupServers.length === 0 && (
                  <div className="border-t border-win-border px-4 py-3 text-center text-win-muted text-xs italic">
                    Aucun serveur dans ce groupe
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <GroupForm servers={servers} onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />
      )}
      {editingGroup && (
        <GroupForm
          initial={editingGroup}
          servers={servers}
          onSubmit={handleEdit}
          onCancel={() => setEditingGroup(null)}
        />
      )}
      {deletingGroup && (
        <ConfirmDialog
          title={`Supprimer "${deletingGroup.name}"`}
          message="Le groupe sera supprimé. Les serveurs qu'il contient ne seront pas affectés."
          confirmLabel="Supprimer"
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDeletingGroup(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
