import { useState } from "react";
import { Power, RotateCcw, Zap, Pencil, Trash2, Loader2, RefreshCw } from "lucide-react";
import { Server, OS_ICONS } from "../types";
import { StatusBadge } from "./StatusBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import { useStore } from "../stores/useStore";
import { cn } from "../utils";
import { ServerIconDisplay } from "./IconPicker";

interface ServerCardProps {
  server: Server;
  onEdit: (server: Server) => void;
  onDelete: (server: Server) => void;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function ServerCard({ server, onEdit, onDelete, onMessage }: ServerCardProps) {
  const { statuses, wakeServer, shutdownServer, rebootServer, pingServer } = useStore();
  const status = statuses[server.id];

  const [loading, setLoading] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"shutdown" | "reboot" | null>(null);

  async function runAction(
    key: string,
    action: () => Promise<unknown>,
    successMsg: string
  ) {
    setLoading(key);
    try {
      await action();
      onMessage(successMsg, "success");
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <>
      <div
        className={cn(
          "bg-bg-tertiary border border-border-primary rounded-win shadow-win",
          "hover:shadow-win-hover hover:border-accent-primary/30 transition-all duration-200",
          "flex flex-col gap-4 p-4"
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">
              {server.icon
                ? <ServerIconDisplay icon={server.icon} size={20} />
                : <span className="text-xl">{OS_ICONS[server.os_type]}</span>
              }
            </span>
            <div className="min-w-0">
              <h3 className="text-text-primary font-semibold text-sm truncate leading-tight">
                {server.name}
              </h3>
              <p className="text-text-secondary text-xs truncate font-mono">{server.ip}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => runAction("ping", () => pingServer(server.id), "Ping OK")}
              className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
              title="Rafraîchir le statut"
            >
              {loading === "ping" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
            </button>
            <button
              onClick={() => onEdit(server)}
              className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
              title="Modifier"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => onDelete(server)}
              className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10 transition-all"
              title="Supprimer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Statut */}
        <StatusBadge status={status} size="sm" />

        {/* Actions */}
        <div className="flex gap-2">
          {/* Wake-on-LAN */}
          <button
            onClick={() =>
              runAction(
                "wol",
                () => wakeServer(server.id),
                `Magic packet envoyé à ${server.name}`
              )
            }
            disabled={!!loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                       border border-yellow-500/30 bg-yellow-500/5 text-yellow-400
                       hover:bg-yellow-500/15 hover:border-yellow-500/50
                       text-xs font-medium transition-all disabled:opacity-50"
            title="Wake-on-LAN"
          >
            {loading === "wol" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Zap size={12} />
            )}
            WoL
          </button>

          {/* Shutdown */}
          <button
            onClick={() => setConfirmAction("shutdown")}
            disabled={!!loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                       border border-red-500/30 bg-red-500/5 text-red-400
                       hover:bg-red-500/15 hover:border-red-500/50
                       text-xs font-medium transition-all disabled:opacity-50"
            title="Éteindre"
          >
            {loading === "shutdown" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Power size={12} />
            )}
            Éteindre
          </button>

          {/* Reboot */}
          <button
            onClick={() => setConfirmAction("reboot")}
            disabled={!!loading}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-win
                       border border-border-primary bg-bg-secondary text-text-secondary
                       hover:bg-bg-hover hover:text-text-primary
                       text-xs font-medium transition-all disabled:opacity-50"
            title="Redémarrer"
          >
            {loading === "reboot" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            Reboot
          </button>
        </div>

        {/* Infos SSH */}
        <div className="text-xs text-text-secondary/60 font-mono">
          {server.ssh_user}@{server.ip}:{server.ssh_port}
        </div>
      </div>

      {/* Dialogs de confirmation */}
      {confirmAction === "shutdown" && (
        <ConfirmDialog
          title={`Éteindre ${server.name}`}
          message={`Cette action va éteindre le serveur via SSH.\nCommande : ${server.shutdown_command}`}
          confirmLabel="Éteindre"
          dangerous
          onConfirm={() => {
            setConfirmAction(null);
            runAction(
              "shutdown",
              () => shutdownServer(server.id),
              `Commande d'arrêt envoyée à ${server.name}`
            );
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === "reboot" && (
        <ConfirmDialog
          title={`Redémarrer ${server.name}`}
          message={`Cette action va redémarrer le serveur via SSH.\nCommande : ${server.reboot_command}`}
          confirmLabel="Redémarrer"
          onConfirm={() => {
            setConfirmAction(null);
            runAction(
              "reboot",
              () => rebootServer(server.id),
              `Commande de redémarrage envoyée à ${server.name}`
            );
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
