import { useRef, useState } from "react";
import { Plus, X, TerminalSquare, RotateCw, FolderOpen } from "lucide-react";
import { useStore } from "../stores/useStore";
import { TerminalView } from "../components/TerminalView";
import { SnippetMenu } from "../components/SnippetMenu";
import { Dropdown } from "../components/Dropdown";
import { FileExplorerPanel } from "../components/FileExplorerPanel";
import { OS_ICONS, TerminalStatus } from "../types";
import { cn } from "../utils";
import { useT } from "../i18n";
import { ServerIconDisplay } from "../components/IconPicker";
import { useFileExplorerStore } from "../stores/useFileExplorerStore";

const STATUS_DOT: Record<TerminalStatus, string> = {
  connecting: "bg-accent-warning animate-pulse-soft",
  open: "bg-accent-success",
  closed: "bg-text-muted",
};

/** Liste des serveurs pour ouvrir une nouvelle session (ou juste parcourir ses fichiers). */
function ServerPicker({ onPick, onOpenFiles, compact }: { onPick: (id: string) => void; onOpenFiles?: (id: string) => void; compact?: boolean }) {
  const { t } = useT();
  const { servers, statuses } = useStore();
  if (servers.length === 0) {
    return <p className="text-text-muted text-sm p-3">{t("console.noServers")}</p>;
  }
  return (
    <div className={cn(compact ? "flex flex-col py-1" : "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3")}>
      {servers.map((s) => {
        const online = statuses[s.id]?.online;
        return (
          <div
            key={s.id}
            className={cn(
              "group flex items-center gap-2.5 text-left transition-all duration-150",
              compact
                ? "px-3 py-2 text-sm hover:bg-bg-hover"
                : "p-3 rounded-win bg-bg-tertiary border border-border-primary hover:border-accent-primary/40 hover:shadow-win-hover"
            )}
          >
            <button onClick={() => onPick(s.id)} className="flex items-center gap-2.5 min-w-0 flex-1 text-left">
              <span className="text-lg shrink-0">{s.icon ? <ServerIconDisplay icon={s.icon} size={18} /> : OS_ICONS[s.os_type]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-text-primary text-sm truncate">{s.name}</span>
                <span className="block text-text-muted text-xs truncate">{s.ssh_user}@{s.ip}</span>
              </span>
            </button>
            {onOpenFiles && (
              <button
                onClick={() => onOpenFiles(s.id)}
                className="p-1.5 rounded text-text-secondary opacity-0 group-hover:opacity-100 hover:text-accent-primary hover:bg-accent-primary/10 shrink-0"
                title={t("console.files.openStandalone")}
              >
                <FolderOpen size={15} />
              </button>
            )}
            <span className={cn("w-2 h-2 rounded-full shrink-0", online ? "bg-accent-success" : "bg-text-muted")} />
          </div>
        );
      })}
    </div>
  );
}

export function Console() {
  const { t } = useT();
  const {
    terminalSessions, activeTerminalKey, openTerminal, closeTerminal, setActiveTerminal, reconnectTerminal,
  } = useStore();
  const { panelOpen, togglePanel, width, setWidth } = useFileExplorerStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filesOnlyServerId, setFilesOnlyServerId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLButtonElement>(null);
  const resizing = useRef(false);
  const active = terminalSessions.find((x) => x.key === activeTerminalKey);

  function pick(serverId: string) {
    setPickerOpen(false);
    openTerminal(serverId);
  }

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizing.current = true;
    function onMove(ev: MouseEvent) {
      if (!resizing.current) return;
      setWidth(window.innerWidth - ev.clientX);
    }
    function onUp() {
      resizing.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (terminalSessions.length === 0) {
    if (filesOnlyServerId) {
      return (
        <div className="flex flex-col h-full">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border-primary bg-bg-secondary shrink-0">
            <FolderOpen size={14} className="text-text-secondary" />
            <span className="text-sm text-text-primary">{t("console.files.button")}</span>
          </div>
          <FileExplorerPanel serverId={filesOnlyServerId} onClose={() => setFilesOnlyServerId(null)} />
        </div>
      );
    }
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("console.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">
            {t("console.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-text-secondary text-sm">
          <TerminalSquare size={16} className="opacity-60" />
          {t("console.pickServer")}
        </div>
        <ServerPicker onPick={pick} onOpenFiles={setFilesOnlyServerId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Onglets des sessions ─────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-border-primary bg-bg-secondary px-2 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto min-w-0">
          {terminalSessions.map((session) => (
            <div
              key={session.key}
              onClick={() => setActiveTerminal(session.key)}
              className={cn(
                "flex items-center gap-2 px-3 py-2.5 text-sm cursor-pointer border-b-2 transition-colors shrink-0",
                session.key === activeTerminalKey
                  ? "border-accent-primary text-text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", STATUS_DOT[session.status])} />
              <span className="truncate max-w-[160px]">{session.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(session.key);
                }}
                className="hover:text-red-400 transition-colors"
                title={t("console.closeSession")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="relative shrink-0">
          <button
            ref={pickerRef}
            onClick={() => setPickerOpen((o) => !o)}
            className="p-1.5 ml-1 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 transition-all"
            title={t("console.newSession")}
          >
            <Plus size={14} />
          </button>
          <Dropdown open={pickerOpen} onClose={() => setPickerOpen(false)} anchorRef={pickerRef} align="right" className="w-64 max-h-80 overflow-y-auto bg-bg-tertiary border border-border-primary rounded-win shadow-win-hover animate-fade-in">
            <ServerPicker onPick={pick} compact />
          </Dropdown>
        </div>

        <div className="ml-auto" />
        <button
          onClick={togglePanel}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded shrink-0",
            panelOpen ? "text-accent-primary bg-accent-primary/10" : "text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10"
          )}
          title={t("console.files.toggleHint")}
        >
          <FolderOpen size={13} /> {t("console.files.button")}
        </button>
        <SnippetMenu sessionId={active?.status === "open" ? active.sessionId : undefined} />
        {active?.status === "closed" && (
          <button
            onClick={() => reconnectTerminal(active.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win bg-accent-primary text-white hover:bg-accent-secondary transition-colors shrink-0"
          >
            <RotateCw size={12} />
            {t("console.reconnect")}
          </button>
        )}
      </div>

      {/* ── Terminaux (tous montés, seul l'actif est visible) + explorateur ─── */}
      <div className="flex flex-1 min-h-0">
        <div className="relative flex-1 min-h-0">
          {terminalSessions.map((session) => (
            <TerminalView key={session.key} session={session} active={session.key === activeTerminalKey} />
          ))}
        </div>
        {panelOpen && active && (
          <>
            <div onMouseDown={startResize} className="w-1 shrink-0 cursor-col-resize hover:bg-accent-primary/40 transition-colors" />
            <div style={{ width }} className="shrink-0 h-full">
              <FileExplorerPanel serverId={active.serverId} terminalSessionId={active.status === "open" ? active.sessionId : undefined} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
