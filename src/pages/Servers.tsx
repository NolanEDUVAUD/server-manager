import { useState, useMemo, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Server, Pencil, Trash2, Zap, Power, RotateCcw, Loader2, ChevronDown, ChevronRight, Folder as FolderIcon, Inbox, KeyRound, Copy } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Server as ServerType, ServerPayload, OS_ICONS } from "../types";
import { ServerForm } from "../components/ServerForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { StatusBadge } from "../components/StatusBadge";
import { ToastContainer } from "../components/Toast";
import { FilterBar, NoFilterResults } from "../components/FilterBar";
import { FavoriteButton, TagList } from "../components/TagChip";
import { OrganisationManager } from "../components/OrganisationManager";
import { useToast } from "../hooks/useToast";
import { useShortcuts } from "../hooks/useShortcuts";
import { filterItems, groupByFolder, serverFilterable } from "../utils/filters";
import { cn, copyToClipboard } from "../utils";
import { DeployKeyDialog } from "../components/DeployKeyDialog";
import { ServerIconDisplay } from "../components/IconPicker";
import { useT } from "../i18n";

type PowerAction = "shutdown" | "reboot";

export function Servers() {
  const {
    servers, statuses, tags, folders, filters,
    addServer, updateServer, deleteServer, wakeServer, shutdownServer, rebootServer, toggleFavorite,
  } = useStore();
  const toast = useToast();
  const { t } = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServer, setEditingServer] = useState<ServerType | null>(null);
  const [deletingServer, setDeletingServer] = useState<ServerType | null>(null);
  const [confirmPower, setConfirmPower] = useState<{ server: ServerType; action: PowerAction } | null>(null);
  const [loadingAction, setLoadingAction] = useState<Record<string, string>>({});
  const [organising, setOrganising] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [deployingServer, setDeployingServer] = useState<ServerType | null>(null);

  // « / » : aller à la recherche
  useShortcuts({ search: () => searchRef.current?.focus() });

  // « Modifier … » depuis la palette de commandes
  useEffect(() => {
    const id = (location.state as { editServerId?: string } | null)?.editServerId;
    if (!id) return;
    const target = servers.find((s) => s.id === id);
    if (target) setEditingServer(target);
    if (target || servers.length > 0) navigate(location.pathname, { replace: true, state: null });
  }, [location.state, servers]);

  const f = filters.servers;
  const filtered = useMemo(
    () => filterItems(servers, f, (s) => serverFilterable(s, { tags, folders }, statuses[s.id])),
    [servers, f, tags, folders, statuses]
  );
  const sections = useMemo(() => groupByFolder(filtered, folders, (s) => s.folder_id), [filtered, folders]);

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
      toast.success(t("servers.added", { name: payload.name }));
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
      toast.success(t("servers.updated", { name: payload.name }));
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
      toast.success(t("servers.deleted", { name: deletingServer.name }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletingServer(null);
    }

    async function handleCopySshCommand(server: ServerType) {
      const command = `ssh ${server.ssh_user}@${server.ip} -p ${server.ssh_port}`;
      const ok = await copyToClipboard(command);
      if (ok) toast.success(t("servers.sshCommandCopied", { name: server.name }));
      else toast.error(t("servers.sshCommandCopyFailed"));
    }
  }

  function renderRow(server: ServerType) {
    const loading = loadingAction[server.id];
    const fields = server.custom_fields ?? [];
    return (
      <div
        key={server.id}
        className="bg-bg-tertiary border border-border-primary rounded-win shadow-win hover:border-accent-primary/30 transition-all duration-200 p-4"
      >
        <div className="flex items-center gap-4">
          {/* Favori + icône + nom */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FavoriteButton
              favorite={!!server.favorite}
              name={server.name}
              onToggle={() => toggleFavorite("server", server.id).catch((e) => toast.error(String(e)))}
            />
            <span className="shrink-0">
              {server.icon
                ? <ServerIconDisplay icon={server.icon} size={20} />
                : <span className="text-xl">{OS_ICONS[server.os_type]}</span>
              }
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-text-primary font-semibold text-sm truncate">{server.name}</h3>
                <span className="text-xs text-text-secondary/60 bg-bg-secondary px-1.5 py-0.5 rounded font-mono">
                  {server.os_type}
                </span>
                <TagList tagIds={server.tag_ids} tags={tags} />
              </div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs text-text-secondary font-mono">
                  {server.ssh_user}@{server.ip}:{server.ssh_port}
                </p>
                <button
                  type="button"
                  onClick={() => handleCopySshCommand(server)}
                  className="p-1 rounded text-text-muted hover:text-accent-primary hover:bg-accent-primary/10 transition-colors"
                  title={t("servers.copySshCommand")}
                  aria-label={t("servers.copySshCommandOf", { name: server.name })}
                >
                  <Copy size={11} />
                </button>
              </div>
            </div>
          </div>

          {/* Statut */}
          <StatusBadge status={statuses[server.id]} size="sm" />

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => runAction(server.id, "wol", () => wakeServer(server.id), t("servers.wolSent", { name: server.name }))}
              disabled={!!loading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-all disabled:opacity-50"
              title="Wake-on-LAN"
            >
              {loading === "wol" ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
              WoL
            </button>
            <button
              onClick={() => setConfirmPower({ server, action: "shutdown" })}
              disabled={!!loading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
              title={t("servers.shutdown")}
            >
              {loading === "shutdown" ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
              Off
            </button>
            <button
              onClick={() => setConfirmPower({ server, action: "reboot" })}
              disabled={!!loading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded text-xs border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all disabled:opacity-50"
              title={t("servers.reboot")}
            >
              {loading === "reboot" ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
              Reboot
            </button>
            <div className="w-px h-5 bg-border-primary mx-1" />
            <button
              onClick={() => setDeployingServer(server)}
              className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
              title={t("servers.deployKey")}
              aria-label={t("servers.deployKeyOn", { name: server.name })}
            >
              <KeyRound size={13} />
            </button>
            <button
              onClick={() => setEditingServer(server)}
              className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
              title={t("common.edit")}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => setDeletingServer(server)}
              className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all"
              title={t("common.delete")}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Champs personnalisés */}
        {fields.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 pl-[4.25rem]">
            {fields.slice(0, 4).map((cf) => (
              <span key={cf.key} className="text-[11px] text-text-secondary bg-bg-secondary rounded px-1.5 py-0.5 max-w-[16rem] truncate" title={t("servers.fieldTitle", { key: cf.key, value: cf.value })}>
                <span className="text-text-muted">{t("servers.fieldLabel", { key: cf.key })}</span> {cf.value}
              </span>
            ))}
            {fields.length > 4 && (
              <span className="text-[11px] text-text-muted" title={fields.slice(4).map((cf) => t("servers.fieldTitle", { key: cf.key, value: cf.value })).join("\n")}>+{fields.length - 4}</span>
            )}
          </div>
        )}

        {/* Notes */}
        {server.notes && (
          <p className="text-xs text-text-secondary/70 mt-2 pl-[4.25rem] leading-relaxed">{server.notes}</p>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("servers.title")}</h1>
          <p className="text-sm text-text-secondary mt-0.5">{t("servers.configured", { count: servers.length })}</p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
        >
          <Plus size={14} />
          {t("servers.add")}
        </button>
      </div>

      {/* Recherche et filtres */}
      {servers.length > 0 && (
        <FilterBar
          scope="servers"
          searchRef={searchRef}
          placeholder={t("servers.searchPlaceholder")}
          shown={filtered.length}
          total={servers.length}
          onOrganise={() => setOrganising(true)}
        />
      )}

      {/* Liste */}
      {servers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="p-4 rounded-full bg-bg-tertiary border border-border-primary mb-4">
            <Server size={32} className="text-text-secondary" />
          </div>
          <h3 className="text-text-primary font-semibold mb-2">{t("servers.emptyTitle")}</h3>
          <p className="text-text-secondary text-sm mb-4">{t("servers.emptyHint")}</p>
          <button
            onClick={() => setShowAddForm(true)}
            className="px-5 py-2.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all"
          >
            {t("servers.addFirst")}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <NoFilterResults scope="servers" />
      ) : (
        <div className="space-y-4">
          {sections.map(({ folder, items }) => {
            const key = folder?.id ?? "";
            const isCollapsed = !!collapsed[key];
            return (
              <section key={key || "sans-dossier"} className="space-y-2">
                {/* En-têtes de dossier seulement si des dossiers existent */}
                {folders.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
                  >
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    {folder ? <FolderIcon size={13} /> : <Inbox size={13} />}
                    {folder?.name ?? t("servers.noFolder")}
                    <span className="text-text-muted">({items.length})</span>
                  </button>
                )}
                {!isCollapsed && <div className={cn("space-y-2", folders.length > 0 && "pl-4")}>{items.map(renderRow)}</div>}
              </section>
            );
          })}
        </div>
      )}

      {showAddForm && <ServerForm onSubmit={handleAdd} onCancel={() => setShowAddForm(false)} />}
      {editingServer && <ServerForm initial={editingServer} onSubmit={handleEdit} onCancel={() => setEditingServer(null)} />}
      {deletingServer && (
        <ConfirmDialog
          title={t("servers.deleteTitle", { name: deletingServer.name })}
          message={t("servers.deleteMessage")}
          confirmLabel={t("common.delete")}
          dangerous
          onConfirm={handleDelete}
          onCancel={() => setDeletingServer(null)}
        />
      )}
      {confirmPower && (
        <ConfirmDialog
          title={t(confirmPower.action === "shutdown" ? "servers.shutdownTitle" : "servers.rebootTitle", { name: confirmPower.server.name })}
          message={
            confirmPower.action === "shutdown"
              ? t("servers.shutdownMessage", { name: confirmPower.server.name, ip: confirmPower.server.ip, command: confirmPower.server.shutdown_command })
              : t("servers.rebootMessage", { name: confirmPower.server.name, ip: confirmPower.server.ip, command: confirmPower.server.reboot_command })
          }
          confirmLabel={confirmPower.action === "shutdown" ? t("servers.shutdown") : t("servers.reboot")}
          dangerous
          onCancel={() => setConfirmPower(null)}
          onConfirm={() => {
            const { server, action } = confirmPower;
            setConfirmPower(null);
            if (action === "shutdown") runAction(server.id, "shutdown", () => shutdownServer(server.id), t("servers.shutdownSent", { name: server.name }));
            else runAction(server.id, "reboot", () => rebootServer(server.id), t("servers.rebootSent", { name: server.name }));
          }}
        />
      )}
      {organising && <OrganisationManager onClose={() => setOrganising(false)} />}

      {deployingServer && (
        <DeployKeyDialog
          server={deployingServer}
          onClose={() => setDeployingServer(null)}
          onMessage={(msg, type = "info") => toast.addToast(msg, type)}
        />
      )}

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
