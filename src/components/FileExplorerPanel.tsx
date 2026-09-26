import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Home, FolderPlus, Upload, Eye, EyeOff, MoreVertical,
  Folder, File as FileIcon, Link2, Download, Pencil, Trash2, Copy, TerminalSquare, X, Loader2,
} from "lucide-react";
import { SftpEntry, SftpEntryKind, SftpProgress } from "../types";
import { useT } from "../i18n";
import { cn } from "../utils";
import { breadcrumbs, cdCommand, formatModified, formatSize, isHiddenName, parentRemotePath } from "../utils/sftpPath";
import { useFileExplorerStore } from "../stores/useFileExplorerStore";
import { Dropdown } from "./Dropdown";
import { ConfirmDialog } from "./ConfirmDialog";

/** Nombre maximum d'entrées effectivement rendues (dossier immense : on prévient plutôt que de figer l'UI) */
const MAX_RENDERED_ENTRIES = 2000;

function iconFor(entry: SftpEntry) {
  const kind: SftpEntryKind = entry.kind === "symlink" ? entry.linkTargetKind ?? "symlink" : entry.kind;
  if (kind === "dir") return <Folder size={15} className="text-accent-primary shrink-0" />;
  if (entry.kind === "symlink") return <Link2 size={15} className="text-text-muted shrink-0" />;
  return <FileIcon size={15} className="text-text-muted shrink-0" />;
}

function isDirLike(entry: SftpEntry): boolean {
  return entry.kind === "dir" || entry.linkTargetKind === "dir";
}

interface FileExplorerPanelProps {
  serverId: string;
  /** Session de terminal active pour ce serveur (pour « Ouvrir ici dans le terminal ») */
  terminalSessionId?: string;
  /** Le panneau est affiché en plein écran (pas de terminal ouvert) : bouton de fermeture */
  onClose?: () => void;
}

/**
 * Explorateur de fichiers SFTP : arborescence distante navigable, aperçu/édition de
 * texte, transferts avec progression, et actions de fichier courantes. Toute
 * l'authentification est déjà gérée côté Rust (même connexion que la console) — ce
 * composant ne fait qu'appeler les commandes `sftp_*`.
 */
export function FileExplorerPanel({ serverId, terminalSessionId, onClose }: FileExplorerPanelProps) {
  const { t } = useT();
  const { showHidden, setShowHidden } = useFileExplorerStore();

  const [path, setPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Largeur réelle du panneau (et non de la fenêtre) : les colonnes secondaires ne
  // s'affichent que s'il reste de la place, le nom du fichier passant toujours en premier
  const [listWidth, setListWidth] = useState(0);
  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>({ back: [], forward: [] });
  const [menuFor, setMenuFor] = useState<SftpEntry | null>(null);
  const [renaming, setRenaming] = useState<SftpEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<SftpEntry | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [preview, setPreview] = useState<{ entry: SftpEntry; content: string; error: string | null; loading: boolean; dirty: boolean } | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [transfer, setTransfer] = useState<{ label: string; progress: SftpProgress } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  function setListEl(el: HTMLDivElement | null) {
    resizeObserver.current?.disconnect();
    listRef.current = el;
    if (!el) return;
    setListWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    resizeObserver.current = new ResizeObserver((entries) => setListWidth(entries[0]?.contentRect.width ?? 0));
    resizeObserver.current.observe(el);
  }
  const menuAnchorRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Chargement initial : dossier personnel du serveur ───────────────────
  useEffect(() => {
    let cancelled = false;
    setPath(null);
    setEntries([]);
    setHistory({ back: [], forward: [] });
    invoke<string>("sftp_home", { serverId })
      .then((home) => {
        if (!cancelled) setPath(home);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId]);

  async function load(target: string) {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const list = await invoke<SftpEntry[]>("sftp_list", { serverId, path: target });
      setEntries(list);
    } catch (e) {
      setError(String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (path != null) {
      setPathInput(path);
      load(path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  function navigate(target: string, opts?: { replace?: boolean }) {
    if (target === path) return;
    if (!opts?.replace && path != null) {
      setHistory((h) => ({ back: [...h.back, path], forward: [] }));
    }
    setPath(target);
  }

  function goBack() {
    setHistory((h) => {
      if (h.back.length === 0) return h;
      const prev = h.back[h.back.length - 1];
      if (path != null) setPath(prev);
      return { back: h.back.slice(0, -1), forward: path != null ? [path, ...h.forward] : h.forward };
    });
  }

  function goForward() {
    setHistory((h) => {
      if (h.forward.length === 0) return h;
      const next = h.forward[0];
      setPath(next);
      return { back: path != null ? [...h.back, path] : h.back, forward: h.forward.slice(1) };
    });
  }

  function goUp() {
    if (!path) return;
    const parent = parentRemotePath(path);
    if (parent) navigate(parent);
  }

  function goHome() {
    invoke<string>("sftp_home", { serverId }).then((home) => navigate(home)).catch((e) => setError(String(e)));
  }

  function refresh() {
    if (path != null) load(path);
  }

  // ── Filtrage + fichiers cachés + tri déjà fait côté backend ─────────────
  const visibleEntries = useMemo(() => {
    let list = entries;
    if (!showHidden) list = list.filter((e) => !isHiddenName(e.name));
    if (filter.trim()) {
      const needle = filter.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(needle));
    }
    return list;
  }, [entries, showHidden, filter]);
  const rendered = visibleEntries.slice(0, MAX_RENDERED_ENTRIES);
  const truncated = visibleEntries.length > MAX_RENDERED_ENTRIES;

  function open(entry: SftpEntry) {
    if (isDirLike(entry)) {
      navigate(entry.path);
    } else {
      openPreview(entry);
    }
  }

  async function openPreview(entry: SftpEntry) {
    setPreview({ entry, content: "", error: null, loading: true, dirty: false });
    try {
      const content = await invoke<string>("sftp_read_text", { serverId, path: entry.path });
      setPreview({ entry, content, error: null, loading: false, dirty: false });
    } catch (e) {
      const message = String(e);
      setPreview({ entry, content: "", error: message.includes("binaire") ? t("console.files.preview.binary") : message, loading: false, dirty: false });
    }
  }

  async function saveText(force = false) {
    if (!preview) return;
    if (!force) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    try {
      await invoke("sftp_write_text", { serverId, path: preview.entry.path, content: preview.content });
      setPreview((p) => (p ? { ...p, dirty: false } : p));
      setToast(t("console.files.preview.save"));
    } catch (e) {
      setPreview((p) => (p ? { ...p, error: String(e) } : p));
    }
  }

  function copyPath(entry: SftpEntry) {
    navigator.clipboard?.writeText(entry.path).catch(() => {});
    setToast(t("console.files.pathCopied"));
    setMenuFor(null);
  }

  function openInTerminal(entry: SftpEntry) {
    setMenuFor(null);
    if (!terminalSessionId) return;
    const dir = isDirLike(entry) ? entry.path : parentRemotePath(entry.path) ?? "/";
    invoke("terminal_write", { sessionId: terminalSessionId, data: cdCommand(dir) }).catch(() => {});
  }

  function startRename(entry: SftpEntry) {
    setMenuFor(null);
    setRenaming(entry);
    setRenameValue(entry.name);
  }

  async function confirmRename() {
    if (!renaming || !path) return;
    const from = renaming.path;
    const parent = parentRemotePath(from) ?? "/";
    const to = parent === "/" ? `/${renameValue}` : `${parent}/${renameValue}`;
    try {
      await invoke("sftp_rename", { serverId, from, to });
      setRenaming(null);
      refresh();
    } catch (e) {
      setError(String(e));
      setRenaming(null);
    }
  }

  function startDelete(entry: SftpEntry) {
    setMenuFor(null);
    setDeleting(entry);
    setDeleteConfirmName("");
  }

  async function confirmDelete() {
    if (!deleting) return;
    const recursive = isDirLike(deleting);
    try {
      await invoke("sftp_delete", { serverId, path: deleting.path, recursive });
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(String(e));
      setDeleting(null);
    }
  }

  async function downloadEntry(entry: SftpEntry) {
    setMenuFor(null);
    const target = await saveDialog({ defaultPath: entry.name, title: t("console.files.downloadChooseTitle") }).catch(() => null);
    if (!target) return;
    setTransfer({ label: t("console.files.downloading", { name: entry.name }), progress: { transferred: 0, total: entry.size } });
    const onProgress = new Channel<SftpProgress>();
    onProgress.onmessage = (p) => setTransfer({ label: t("console.files.downloading", { name: entry.name }), progress: p });
    try {
      await invoke("sftp_download", { serverId, remotePath: entry.path, localPath: target, onProgress });
    } catch (e) {
      setError(String(e));
    } finally {
      setTransfer(null);
    }
  }

  async function uploadFile() {
    const target = await openDialog({ multiple: false, directory: false }).catch(() => null);
    if (!target || Array.isArray(target) || !path) return;
    const name = target.split(/[/\\]/).pop() ?? target;
    setTransfer({ label: t("console.files.uploading", { name }), progress: { transferred: 0, total: 0 } });
    const onProgress = new Channel<SftpProgress>();
    onProgress.onmessage = (p) => setTransfer({ label: t("console.files.uploading", { name }), progress: p });
    try {
      await invoke("sftp_upload", { serverId, localPath: target, remoteDir: path, onProgress });
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setTransfer(null);
    }
  }

  async function createFolder() {
    if (!path || !newFolderName.trim()) return;
    const target = path === "/" ? `/${newFolderName.trim()}` : `${path}/${newFolderName.trim()}`;
    try {
      await invoke("sftp_mkdir", { serverId, path: target });
      setNewFolderOpen(false);
      setNewFolderName("");
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (renaming || deleting || preview || newFolderOpen) return;
    const current = rendered.find((x) => x.path === selected);
    if (e.key === "Enter" && current) {
      e.preventDefault();
      open(current);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      goUp();
    } else if (e.key === "F2" && current) {
      e.preventDefault();
      startRename(current);
    } else if (e.key === "Delete" && current) {
      e.preventDefault();
      startDelete(current);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-bg-secondary border-l border-border-primary" onKeyDown={onKeyDown} tabIndex={-1}>
      {/* ── Barre d'outils ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-primary shrink-0">
        <button onClick={goBack} disabled={history.back.length === 0} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover disabled:opacity-30" title={t("console.files.back")}>
          <ArrowLeft size={14} />
        </button>
        <button onClick={goForward} disabled={history.forward.length === 0} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover disabled:opacity-30" title={t("console.files.forward")}>
          <ArrowRight size={14} />
        </button>
        <button onClick={goUp} disabled={!path || path === "/"} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover disabled:opacity-30" title={t("console.files.up")}>
          <ArrowUp size={14} />
        </button>
        <button onClick={refresh} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover" title={t("console.files.refresh")}>
          <RefreshCw size={14} className={cn(loading && "animate-spin")} />
        </button>
        <button onClick={goHome} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover" title={t("console.files.home")}>
          <Home size={14} />
        </button>
        <button onClick={() => setNewFolderOpen(true)} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover" title={t("console.files.newFolder")}>
          <FolderPlus size={14} />
        </button>
        <button onClick={uploadFile} className="p-1.5 rounded text-text-secondary hover:bg-bg-hover" title={t("console.files.upload")}>
          <Upload size={14} />
        </button>
        <button onClick={() => setShowHidden(!showHidden)} className={cn("p-1.5 rounded hover:bg-bg-hover", showHidden ? "text-accent-primary" : "text-text-secondary")} title={t("console.files.showHidden")}>
          {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        {onClose && (
          <button onClick={onClose} className="p-1.5 ml-auto rounded text-text-secondary hover:bg-bg-hover" title={t("common.close")}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Fil d'Ariane (clic = navigation directe) ─────────────────────── */}
      {path != null && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-primary shrink-0 overflow-x-auto text-xs">
          {breadcrumbs(path).map((crumb, i, arr) => (
            <span key={crumb.path} className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => navigate(crumb.path)} className="text-text-secondary hover:text-accent-primary truncate max-w-[120px]">
                {crumb.name}
              </button>
              {/* Pas de séparateur après la racine « / » (sinon « / / home ») */}
              {i > 0 && i < arr.length - 1 && <span className="text-text-muted">/</span>}
            </span>
          ))}
        </div>
      )}
      {/* ── Chemin éditable : un champ texte, Entrée pour y aller ────────── */}
      <div className="px-2 py-1 border-b border-border-primary shrink-0">
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pathInput.trim()) navigate(pathInput.trim());
          }}
          aria-label={t("console.files.pathPlaceholder")}
          placeholder={t("console.files.pathPlaceholder")}
          className="w-full bg-bg-input border border-border-primary rounded px-2 py-1 text-xs font-mono text-text-primary"
        />
      </div>

      {/* ── Filtre ───────────────────────────────────────────────────────── */}
      <div className="px-2 py-1.5 border-b border-border-primary shrink-0">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("console.files.filterPlaceholder")}
          aria-label={t("console.files.filterPlaceholder")}
          className="w-full bg-bg-input border border-border-primary rounded px-2 py-1 text-xs text-text-primary"
        />
      </div>

      {/* ── Liste ────────────────────────────────────────────────────────── */}
      <div ref={setListEl} className="flex-1 min-h-0 overflow-y-auto">
        {loading && <div className="flex items-center justify-center gap-2 py-6 text-text-muted text-xs"><Loader2 size={14} className="animate-spin" /> {t("console.files.loading")}</div>}
        {!loading && error && <p className="p-3 text-xs text-red-400 break-words">{t("console.files.errorPrefix", { message: error })}</p>}
        {!loading && !error && rendered.length === 0 && <p className="p-3 text-xs text-text-muted">{t("console.files.empty")}</p>}
        {!loading && !error && rendered.map((entry) => (
          <div
            key={entry.path}
            onClick={() => setSelected(entry.path)}
            onDoubleClick={() => open(entry)}
            className={cn(
              "group flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer border-l-2",
              selected === entry.path ? "bg-accent-primary/10 border-accent-primary" : "border-transparent hover:bg-bg-hover"
            )}
          >
            {iconFor(entry)}
            <span
              className="flex-1 min-w-[6rem] truncate text-text-primary"
              title={`${entry.name}\n${formatModified(entry.modified)} · ${entry.permissions}`}
            >
              {entry.name}
            </span>
            <span className="w-16 text-right text-text-muted font-mono shrink-0">{isDirLike(entry) ? "" : formatSize(entry.size)}</span>
            {listWidth >= 480 && <span className="w-36 text-text-muted shrink-0 truncate">{formatModified(entry.modified)}</span>}
            {listWidth >= 620 && <span className="w-24 text-text-muted font-mono shrink-0">{entry.permissions}</span>}
            <button
              ref={menuFor?.path === entry.path ? menuAnchorRef : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setMenuFor(entry);
              }}
              className="p-1 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary shrink-0"
            >
              <MoreVertical size={13} />
            </button>
          </div>
        ))}
        {!loading && !error && truncated && (
          <p className="p-2 text-[11px] text-text-muted">{t("console.files.tooMany", { count: MAX_RENDERED_ENTRIES, total: visibleEntries.length })}</p>
        )}
      </div>

      {/* ── Menu contextuel ("…") ────────────────────────────────────────── */}
      {menuFor && (
        <Dropdown open onClose={() => setMenuFor(null)} anchorRef={menuAnchorRef} align="right" className="w-52 bg-bg-tertiary border border-border-primary rounded-win shadow-win-hover py-1">
          {!isDirLike(menuFor) && (
            <button onClick={() => downloadEntry(menuFor)} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover">
              <Download size={13} /> {t("console.files.menu.download")}
            </button>
          )}
          <button onClick={() => startRename(menuFor)} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover">
            <Pencil size={13} /> {t("console.files.menu.rename")}
          </button>
          <button onClick={() => startDelete(menuFor)} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-400 hover:bg-bg-hover">
            <Trash2 size={13} /> {t("console.files.menu.delete")}
          </button>
          <button onClick={() => copyPath(menuFor)} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover">
            <Copy size={13} /> {t("console.files.menu.copyPath")}
          </button>
          {terminalSessionId && (
            <button onClick={() => openInTerminal(menuFor)} className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover">
              <TerminalSquare size={13} /> {t("console.files.menu.openInTerminal")}
            </button>
          )}
        </Dropdown>
      )}

      {/* ── Nouveau dossier ──────────────────────────────────────────────── */}
      {newFolderOpen && (
        <ConfirmDialog
          title={t("console.files.newFolder")}
          message={t("console.files.newFolderPrompt")}
          confirmDisabled={!newFolderName.trim()}
          onConfirm={createFolder}
          onCancel={() => {
            setNewFolderOpen(false);
            setNewFolderName("");
          }}
        >
          <input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            className="w-full bg-bg-input border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
          />
        </ConfirmDialog>
      )}

      {/* ── Renommer ─────────────────────────────────────────────────────── */}
      {renaming && (
        <ConfirmDialog
          title={t("console.files.rename.title", { name: renaming.name })}
          message={t("console.files.rename.label")}
          confirmLabel={t("console.files.rename.confirm")}
          confirmDisabled={!renameValue.trim()}
          onConfirm={confirmRename}
          onCancel={() => setRenaming(null)}
        >
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmRename()}
            className="w-full bg-bg-input border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
          />
        </ConfirmDialog>
      )}

      {/* ── Supprimer ────────────────────────────────────────────────────── */}
      {deleting && (
        <ConfirmDialog
          title={t("console.files.delete.title", { name: deleting.name })}
          message={isDirLike(deleting) ? t("console.files.delete.dirMessage") : t("console.files.delete.fileMessage")}
          confirmLabel={t("console.files.delete.confirm")}
          dangerous
          confirmDisabled={isDirLike(deleting) && deleteConfirmName !== deleting.name}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        >
          {isDirLike(deleting) && (
            <div className="space-y-1">
              <p className="text-xs text-text-muted">{t("console.files.delete.typeToConfirm", { name: deleting.name })}</p>
              <input
                autoFocus
                value={deleteConfirmName}
                onChange={(e) => setDeleteConfirmName(e.target.value)}
                placeholder={t("console.files.delete.confirmPlaceholder")}
                className="w-full bg-bg-input border border-border-primary rounded px-2 py-1.5 text-sm text-text-primary"
              />
            </div>
          )}
        </ConfirmDialog>
      )}

      {/* ── Aperçu / édition de texte ────────────────────────────────────── */}
      {preview && (
        <div className="fixed inset-0 z-modal flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setPreview(null)} />
          <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover p-4 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-text-primary font-semibold text-sm truncate">{t("console.files.preview.title", { name: preview.entry.name })}</h3>
              <button onClick={() => setPreview(null)} className="text-text-secondary hover:text-text-primary"><X size={16} /></button>
            </div>
            {preview.loading && <div className="flex items-center gap-2 py-6 text-text-muted text-xs justify-center"><Loader2 size={14} className="animate-spin" /> {t("console.files.loading")}</div>}
            {!preview.loading && preview.error && <p className="text-xs text-red-400 py-4">{preview.error}</p>}
            {!preview.loading && !preview.error && (
              <>
                <textarea
                  value={preview.content}
                  onChange={(e) => setPreview((p) => (p ? { ...p, content: e.target.value, dirty: true } : p))}
                  className="flex-1 min-h-[300px] bg-bg-input border border-border-primary rounded p-2 text-xs font-mono text-text-primary resize-none"
                  spellCheck={false}
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button onClick={() => setPreview(null)} className="px-3 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={() => saveText(false)}
                    disabled={!preview.dirty}
                    className="px-3 py-1.5 text-xs rounded-win bg-accent-primary text-white disabled:opacity-40"
                  >
                    {t("console.files.preview.save")}
                  </button>
                </div>
              </>
            )}
          </div>
          {confirmOverwrite && (
            <ConfirmDialog
              title={t("console.files.preview.saveConfirmTitle", { name: preview.entry.name })}
              message={t("console.files.preview.saveConfirmMessage")}
              onConfirm={() => saveText(true)}
              onCancel={() => setConfirmOverwrite(false)}
            />
          )}
        </div>
      )}

      {/* ── Transfert en cours ───────────────────────────────────────────── */}
      {transfer && (
        <div className="px-3 py-2 border-t border-border-primary text-[11px] text-text-secondary shrink-0">
          <p className="truncate">{transfer.label}</p>
          <div className="h-1 mt-1 bg-bg-input rounded overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-all"
              style={{ width: transfer.progress.total > 0 ? `${Math.min(100, (transfer.progress.transferred / transfer.progress.total) * 100)}%` : "40%" }}
            />
          </div>
        </div>
      )}

      {/* ── Toast bref (chemin copié, enregistré…) ──────────────────────── */}
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-win bg-bg-primary border border-border-primary text-xs text-text-primary shadow-win-hover">
          {toast}
        </div>
      )}
    </div>
  );
}
