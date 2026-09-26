import { useState } from "react";
import { Plus, Layers, Zap, Power, Wifi, Pencil, Trash2, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Group } from "../types";
import { GroupForm } from "../components/GroupForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { ToastContainer } from "../components/Toast";
import { ServerIconDisplay } from "../components/IconPicker";
import { useToast } from "../hooks/useToast";
import { useT } from "../i18n";

export function Groups() {
  const { t } = useT();
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
      toast.success(t("groups.created", { name }));
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
      toast.success(t("groups.updated", { name }));
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
      toast.success(t("groups.deleted", { name: deletingGroup.name }));
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
          <h1 className="text-xl font-bold text-text-primary">{t("groups.title")}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{t("groups.count", { count: groups.length })}</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
        >
          <Plus size={14} />
          {t("groups.create")}
        </button>
      </div>

      {/* Liste des groupes */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-bg-tertiary border border-border-primary mb-4">
            <Layers size={32} className="text-text-secondary" />
          </div>
          <h3 className="text-text-primary font-semibold mb-2">{t("groups.emptyTitle")}</h3>
          <p className="text-text-secondary text-sm mb-4">
            {t("groups.emptyHint")}
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
          >
            {t("groups.create")}
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
              <div key={group.id} className="bg-bg-tertiary border border-border-primary rounded-win shadow-win">
                {/* Header du groupe */}
                <div className="flex items-center gap-4 p-4">
                  <button
                    onClick={() => toggleExpand(group.id)}
                    className="text-text-secondary hover:text-text-primary transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>

                  <span className="shrink-0">
                    {group.icon
                      ? <ServerIconDisplay icon={group.icon} size={20} />
                      : <span className="text-xl">🗂️</span>
                    }
                  </span>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-text-primary font-semibold text-sm">{group.name}</h3>
                    <p className="text-xs text-text-secondary">
                      {t("common.servers", { count: groupServers.length })}
                      {groupServers.length > 0 && (
                        <span className="ml-2 text-green-400">{t("groups.online", { count: onlineCount })}</span>
                      )}
                    </p>
                  </div>

                  {/* Actions de groupe */}
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() =>
                        runGroupAction(group.id, "ping", pingAll, t("groups.pingStarted", { name: group.name }))
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all disabled:opacity-50"
                    >
                      {loading === "ping" ? <Loader2 size={11} className="animate-spin" /> : <Wifi size={11} />}
                      {t("groups.ping")}
                    </button>
                    <button
                      onClick={() =>
                        runGroupAction(
                          group.id,
                          "wol",
                          () => wakeGroup(group.id),
                          t("groups.wolSent", { name: group.name })
                        )
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-all disabled:opacity-50"
                    >
                      {loading === "wol" ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                      {t("groups.wolAll")}
                    </button>
                    <button
                      onClick={() =>
                        runGroupAction(
                          group.id,
                          "shutdown",
                          () => shutdownGroup(group.id),
                          t("groups.shutdownSent", { name: group.name })
                        )
                      }
                      disabled={!!loading || groupServers.length === 0}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                    >
                      {loading === "shutdown" ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                      {t("groups.shutdownAll")}
                    </button>
                    <div className="w-px h-5 bg-border-primary mx-1" />
                    <button
                      onClick={() => setEditingGroup(group)}
                      className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeletingGroup(group)}
                      className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Serveurs du groupe (expandable) */}
                {isExpanded && groupServers.length > 0 && (
                  <div className="border-t border-border-primary px-4 py-3 space-y-2">
                    {groupServers.map((s) => (
                      <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-win bg-bg-secondary">
                        <span className="shrink-0">
                          {s.icon
                            ? <ServerIconDisplay icon={s.icon} size={16} />
                            : <span className="text-base">🖥️</span>
                          }
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate">{s.name}</p>
                          <p className="text-xs text-text-secondary font-mono">{s.ip}</p>
                        </div>
                        <StatusBadge status={statuses[s.id]} size="sm" />
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && groupServers.length === 0 && (
                  <div className="border-t border-border-primary px-4 py-3 text-center text-text-secondary text-xs italic">
                    {t("groups.noServers")}
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
          title={t("groups.deleteTitle", { name: deletingGroup.name })}
          message={t("groups.deleteMessage")}
          confirmLabel={t("common.delete")}
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDeletingGroup(null)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
