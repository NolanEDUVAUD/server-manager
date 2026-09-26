import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database as DatabaseIcon, RefreshCw, Loader2, AlertTriangle, Play, Square, RotateCw, Settings2,
  Plus, Trash2, Table2, Users, Terminal, Save,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { ToastContainer } from "../components/Toast";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { cn, formatBytes } from "../utils";
import { useT } from "../i18n";
import { ServerIconDisplay } from "../components/IconPicker";
import { OS_ICONS } from "../types";
import type {
  DbEngine, DetectedEngine, DbInfo, TableInfo, DbUser, QueryResult, RedisInfo, DbConnectionView, DbConnectionPayload,
} from "../types";

const ENGINE_LABEL: Record<DbEngine, string> = { Mysql: "MySQL/MariaDB", Postgres: "PostgreSQL", Redis: "Redis" };

/** Clé unique d'un moteur détecté (plusieurs instances possibles : hôte + conteneurs) */
function engineKey(e: DetectedEngine): string {
  return `${e.engine}:${e.container ?? "host"}`;
}

type Tab = "databases" | "users" | "query" | "backups";

export function Databases() {
  const { t } = useT();
  const { servers, statuses } = useStore();
  const { toasts, removeToast, success, error } = useToast();

  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [engines, setEngines] = useState<Record<string, { loading: boolean; list?: DetectedEngine[]; error?: string }>>({});
  const [selectedEngineKey, setSelectedEngineKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("databases");
  const [connOpen, setConnOpen] = useState(false);

  const detect = useCallback((serverId: string) => {
    setEngines((s) => ({ ...s, [serverId]: { ...s[serverId], loading: true } }));
    invoke<DetectedEngine[]>("db_detect_engines", { serverId })
      .then((list) => setEngines((s) => ({ ...s, [serverId]: { loading: false, list } })))
      .catch((e) => setEngines((s) => ({ ...s, [serverId]: { loading: false, error: String(e) } })));
  }, []);

  useEffect(() => {
    if (selectedServer && statuses[selectedServer]?.online && !engines[selectedServer]) detect(selectedServer);
  }, [selectedServer]);

  const serverState = selectedServer ? engines[selectedServer] : undefined;
  const engineList = serverState?.list ?? [];
  const selectedEngine = engineList.find((e) => engineKey(e) === selectedEngineKey) ?? null;

  useEffect(() => {
    if (!selectedEngineKey && engineList.length > 0) setSelectedEngineKey(engineKey(engineList[0]));
  }, [engineList]);

  return (
    <div className="p-6 space-y-5">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div>
        <h1 className="text-text-primary font-semibold text-lg">{t("layout.nav.databases")}</h1>
        <p className="text-text-secondary text-xs mt-0.5">{t("databases.subtitle")}</p>
      </div>

      {/* ── Serveurs ──────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {servers.map((s) => (
          <button
            key={s.id}
            onClick={() => { setSelectedServer(s.id); setSelectedEngineKey(null); if (statuses[s.id]?.online) detect(s.id); }}
            disabled={!statuses[s.id]?.online}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-win border text-sm transition-all disabled:opacity-40",
              selectedServer === s.id
                ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                : "border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary"
            )}
          >
            <span>{s.icon ? <ServerIconDisplay icon={s.icon} size={14} /> : OS_ICONS[s.os_type]}</span>
            {s.name}
          </button>
        ))}
      </div>

      {!selectedServer ? (
        <EmptyState icon={<DatabaseIcon size={28} className="opacity-50" />} text={t("databases.pickServer")} />
      ) : serverState?.loading && !serverState.list ? (
        <div className="flex items-center gap-2 text-text-muted text-sm py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> {t("databases.detecting")}
        </div>
      ) : serverState?.error ? (
        <ErrorBox message={serverState.error} />
      ) : engineList.length === 0 ? (
        <EmptyState icon={<DatabaseIcon size={28} className="opacity-50" />} text={t("databases.noEngine")} />
      ) : (
        <>
          {/* ── Moteurs détectés ──────────────────────────────────────── */}
          <div className="flex gap-2 flex-wrap">
            {engineList.map((e) => (
              <button
                key={engineKey(e)}
                onClick={() => { setSelectedEngineKey(engineKey(e)); setTab("databases"); }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-win border text-sm transition-all",
                  selectedEngineKey === engineKey(e)
                    ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                    : "border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary"
                )}
              >
                <DatabaseIcon size={14} />
                {ENGINE_LABEL[e.engine]}
                {e.container && <span className="text-text-muted text-[11px]">· {t("databases.container", { name: e.container })}</span>}
                <StatusDot status={e.status} />
              </button>
            ))}
            <button
              onClick={() => selectedServer && detect(selectedServer)}
              className="flex items-center gap-1 px-2 text-text-muted hover:text-accent-primary text-xs"
              title={t("common.refresh")}
            >
              <RefreshCw size={12} className={cn(serverState?.loading && "animate-spin")} />
            </button>
          </div>

          {selectedEngine && selectedServer && (
            <EnginePanel
              serverId={selectedServer}
              engine={selectedEngine}
              tab={tab}
              setTab={setTab}
              onOpenConnection={() => setConnOpen(true)}
              toast={{ success, error }}
            />
          )}

          {connOpen && selectedEngine && selectedServer && (
            <ConnectionModal
              serverId={selectedServer}
              engine={selectedEngine.engine}
              onClose={() => setConnOpen(false)}
              onSaved={() => { success(t("databases.connection.saved")); setConnOpen(false); }}
              onError={(e) => error(e)}
            />
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">{icon}{text}</div>;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-accent-error bg-bg-tertiary border border-border-primary rounded-win p-4">
      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
      <span className="break-words min-w-0">{message}</span>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls = s === "active" || s === "running" ? "bg-accent-success" : s === "inactive" || s === "stopped" ? "bg-text-muted" : "bg-accent-warning";
  return <span className={cn("w-2 h-2 rounded-full", cls)} title={status} />;
}

// ── Panneau d'un moteur : onglets Bases / Utilisateurs / Requête SQL / Sauvegardes ───────
function EnginePanel({
  serverId, engine, tab, setTab, onOpenConnection, toast,
}: {
  serverId: string;
  engine: DetectedEngine;
  tab: Tab;
  setTab: (t: Tab) => void;
  onOpenConnection: () => void;
  toast: { success: (m: string) => void; error: (m: string) => void };
}) {
  const { t } = useT();
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const doServiceAction = async (action: "start" | "stop" | "restart") => {
    setBusyAction(action);
    try {
      await invoke("db_service_action", { serverId, engine: engine.engine, action });
      toast.success(t(action === "start" ? "databases.service.started" : action === "stop" ? "databases.service.stopped" : "databases.service.restarted"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusyAction(null);
    }
  };

  const [confirmAction, setConfirmAction] = useState<"start" | "stop" | "restart" | null>(null);

  if (engine.engine === "Redis") {
    return <RedisPanel serverId={serverId} container={engine.container} />;
  }

  return (
    <div className="bg-bg-tertiary border border-border-primary rounded-win overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-primary">
        <div className="flex gap-1">
          {(["databases", "users", "query", "backups"] as Tab[]).map((tb) => (
            <button
              key={tb}
              onClick={() => setTab(tb)}
              className={cn(
                "px-3 py-1.5 rounded-win text-sm transition-all",
                tab === tb ? "bg-accent-primary/10 text-accent-primary" : "text-text-secondary hover:text-text-primary"
              )}
            >
              {tb === "databases" && <Table2 size={13} className="inline mr-1 -mt-0.5" />}
              {tb === "users" && <Users size={13} className="inline mr-1 -mt-0.5" />}
              {tb === "query" && <Terminal size={13} className="inline mr-1 -mt-0.5" />}
              {tb === "backups" && <Save size={13} className="inline mr-1 -mt-0.5" />}
              {t(`databases.tabs.${tb}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <IconButton title={t("databases.service.start")} busy={busyAction === "start"} onClick={() => setConfirmAction("start")}><Play size={13} /></IconButton>
          <IconButton title={t("databases.service.stop")} busy={busyAction === "stop"} onClick={() => setConfirmAction("stop")} danger><Square size={13} /></IconButton>
          <IconButton title={t("databases.service.restart")} busy={busyAction === "restart"} onClick={() => setConfirmAction("restart")}><RotateCw size={13} /></IconButton>
          <IconButton title={t("databases.connection.button")} onClick={onOpenConnection}><Settings2 size={13} /></IconButton>
        </div>
      </div>

      <div className="p-4">
        {tab === "databases" && <DatabasesTab serverId={serverId} engine={engine} toast={toast} />}
        {tab === "users" && <UsersTab serverId={serverId} engine={engine} />}
        {tab === "query" && <QueryTab serverId={serverId} engine={engine} toast={toast} />}
        {tab === "backups" && <BackupsTab serverId={serverId} engine={engine} toast={toast} />}
      </div>

      {confirmAction && (
        <ConfirmDialog
          title={t("databases.service.confirmTitle", { action: t(`databases.service.${confirmAction}`), engine: ENGINE_LABEL[engine.engine] })}
          message={t("databases.service.confirmMessage")}
          dangerous={confirmAction === "stop"}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => { const a = confirmAction; setConfirmAction(null); doServiceAction(a); }}
        />
      )}
    </div>
  );
}

function IconButton({ title, onClick, busy, danger, children }: {
  title: string; onClick: () => void; busy?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className={cn(
        "p-1.5 rounded transition-all disabled:opacity-50 text-text-secondary",
        danger ? "hover:text-red-400 hover:bg-red-400/10" : "hover:text-accent-primary hover:bg-accent-primary/10"
      )}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : children}
    </button>
  );
}

// ── Onglet Bases ──────────────────────────────────────────────────────────────────────
function DatabasesTab({ serverId, engine, toast }: { serverId: string; engine: DetectedEngine; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const { t } = useT();
  const [dbs, setDbs] = useState<DbInfo[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<DbInfo | null>(null);

  const load = useCallback(() => {
    setDbs(null);
    invoke<DbInfo[]>("db_list_databases", { serverId, engine: engine.engine, container: engine.container }).then(setDbs).catch((e) => toast.error(String(e)));
  }, [serverId, engine]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!selected) { setTables(null); return; }
    invoke<TableInfo[]>("db_list_tables", { serverId, engine: engine.engine, database: selected, container: engine.container })
      .then(setTables)
      .catch((e) => toast.error(String(e)));
  }, [selected]);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">{t("databases.tabs.databases")}</span>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1 text-xs text-accent-primary hover:underline">
            <Plus size={12} /> {t("databases.db.create")}
          </button>
        </div>
        {dbs === null ? (
          <Loader2 size={16} className="animate-spin text-text-muted" />
        ) : dbs.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("databases.db.empty")}</p>
        ) : (
          <div className="divide-y divide-border-secondary border border-border-primary rounded-win overflow-hidden">
            {dbs.map((d) => (
              <div
                key={d.name}
                onClick={() => setSelected(d.name)}
                className={cn(
                  "flex items-center justify-between px-3 py-2 cursor-pointer text-sm",
                  selected === d.name ? "bg-accent-primary/10" : "hover:bg-bg-hover"
                )}
              >
                <span className="text-text-primary truncate">{d.name}</span>
                <span className="flex items-center gap-3 text-xs text-text-muted shrink-0">
                  <span>{formatBytes(d.size_bytes)}</span>
                  <span>{t("databases.db.tables", { count: d.table_count })}</span>
                  <button onClick={(e) => { e.stopPropagation(); setDropTarget(d); }} className="text-text-muted hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <p className="text-xs text-text-muted mb-2">{t("databases.tabs.databases")} · {selected ?? "—"}</p>
        {!selected ? (
          <p className="text-sm text-text-secondary">{t("databases.tablesTab.pickDb")}</p>
        ) : tables === null ? (
          <Loader2 size={16} className="animate-spin text-text-muted" />
        ) : tables.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("databases.tablesTab.empty")}</p>
        ) : (
          <div className="divide-y divide-border-secondary border border-border-primary rounded-win overflow-hidden max-h-80 overflow-y-auto">
            {tables.map((tb) => (
              <div key={tb.name} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-text-primary truncate">{tb.name}</span>
                <span className="flex items-center gap-3 text-xs text-text-muted shrink-0">
                  <span>{formatBytes(tb.size_bytes)}</span>
                  <span>{t("databases.tablesTab.rows", { count: tb.row_estimate })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateDatabaseDialog
          onCancel={() => setCreateOpen(false)}
          onCreate={async (name) => {
            try {
              await invoke("db_create_database", { serverId, engine: engine.engine, container: engine.container, name });
              toast.success(t("databases.db.created", { name }));
              setCreateOpen(false);
              load();
            } catch (e) {
              toast.error(String(e));
            }
          }}
        />
      )}

      {dropTarget && (
        <DropDatabaseDialog
          name={dropTarget.name}
          onCancel={() => setDropTarget(null)}
          onConfirm={async () => {
            const name = dropTarget.name;
            try {
              await invoke("db_drop_database", { serverId, engine: engine.engine, container: engine.container, name });
              toast.success(t("databases.db.dropped", { name }));
              setDropTarget(null);
              if (selected === name) setSelected(null);
              load();
            } catch (e) {
              toast.error(String(e));
            }
          }}
        />
      )}
    </div>
  );
}

function CreateDatabaseDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const valid = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
  return (
    <ConfirmDialog
      title={t("databases.db.createTitle")}
      message={t("databases.db.createHint")}
      confirmDisabled={!valid}
      onCancel={onCancel}
      onConfirm={() => onCreate(name)}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("databases.db.createPlaceholder")}
        className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary"
      />
    </ConfirmDialog>
  );
}

function DropDatabaseDialog({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useT();
  const [typed, setTyped] = useState("");
  return (
    <ConfirmDialog
      title={t("databases.db.dropTitle", { name })}
      message={t("databases.db.dropMessage")}
      dangerous
      confirmDisabled={typed !== name}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <input
        autoFocus
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={t("databases.db.dropConfirmPlaceholder")}
        className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary"
      />
    </ConfirmDialog>
  );
}

// ── Onglet Utilisateurs ───────────────────────────────────────────────────────────────
function UsersTab({ serverId, engine }: { serverId: string; engine: DetectedEngine }) {
  const { t } = useT();
  const [users, setUsers] = useState<DbUser[] | null>(null);
  useEffect(() => {
    invoke<DbUser[]>("db_list_users", { serverId, engine: engine.engine, container: engine.container }).then(setUsers).catch(() => setUsers([]));
  }, [serverId, engine]);
  if (users === null) return <Loader2 size={16} className="animate-spin text-text-muted" />;
  if (users.length === 0) return <p className="text-sm text-text-secondary">{t("databases.usersTab.empty")}</p>;
  return (
    <div className="divide-y divide-border-secondary border border-border-primary rounded-win overflow-hidden">
      {users.map((u, i) => (
        <div key={`${u.name}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
          <span className="text-text-primary">{u.name}</span>
          <span className="text-xs text-text-muted">{u.detail}</span>
        </div>
      ))}
    </div>
  );
}

// ── Onglet Requête SQL ────────────────────────────────────────────────────────────────
function QueryTab({ serverId, engine, toast }: { serverId: string; engine: DetectedEngine; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const { t } = useT();
  const [sql, setSql] = useState("");
  const [readOnly, setReadOnly] = useState(true);
  const [database, setDatabase] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [confirmUnsafe, setConfirmUnsafe] = useState(false);
  const [queryError, setQueryError] = useState("");

  const run = async () => {
    setRunning(true);
    setQueryError("");
    try {
      const r = await invoke<QueryResult>("db_run_query", {
        serverId, engine: engine.engine, database: database || null, container: engine.container, sql, readOnly,
      });
      setResult(r);
    } catch (e) {
      setQueryError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        value={database}
        onChange={(e) => setDatabase(e.target.value)}
        placeholder={ENGINE_LABEL[engine.engine]}
        className="w-48 bg-bg-primary border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary"
      />
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder={t("databases.query.placeholder")}
        rows={5}
        className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary font-mono resize-y"
      />
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-text-secondary" title={t("databases.query.readOnlyHint")}>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => (e.target.checked ? setReadOnly(true) : setConfirmUnsafe(true))}
          />
          {t("databases.query.readOnly")}
        </label>
        <button
          onClick={run}
          disabled={running || !sql.trim()}
          className="px-4 py-1.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white disabled:opacity-50"
        >
          {running ? <Loader2 size={13} className="animate-spin inline" /> : t("databases.query.run")}
        </button>
      </div>

      {queryError && <ErrorBox message={queryError} />}

      {result && (
        <div className="border border-border-primary rounded-win overflow-auto max-h-96">
          {result.rows.length === 0 ? (
            <p className="text-sm text-text-secondary p-3">{t("databases.query.empty")}</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-bg-primary sticky top-0">
                <tr>{result.columns.map((c, i) => <th key={i} className="text-left px-2 py-1 text-text-muted font-medium">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-border-secondary">
                {result.rows.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j} className="px-2 py-1 text-text-primary whitespace-nowrap">{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
          {result.truncated && <p className="text-xs text-accent-warning px-2 py-1">{t("databases.query.truncated", { count: result.rows.length })}</p>}
        </div>
      )}

      {confirmUnsafe && (
        <ConfirmDialog
          title={t("databases.query.disableReadOnlyTitle")}
          message={t("databases.query.disableReadOnlyMessage")}
          dangerous
          onCancel={() => setConfirmUnsafe(false)}
          onConfirm={() => { setReadOnly(false); setConfirmUnsafe(false); }}
        />
      )}
      <div className="hidden">{toast && null}</div>
    </div>
  );
}

// ── Onglet Sauvegardes ────────────────────────────────────────────────────────────────
function BackupsTab({ serverId, engine, toast }: { serverId: string; engine: DetectedEngine; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const { t } = useT();
  const [database, setDatabase] = useState("");
  const [dir, setDir] = useState("");
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!database.trim()) {
      toast.error(t("databases.backups.noDatabase"));
      return;
    }
    setRunning(true);
    try {
      const r = await invoke<{ path: string; size_bytes: number }>("db_backup_database", {
        serverId, engine: engine.engine, container: engine.container, database, dir: dir || null,
      });
      toast.success(t("databases.backups.done", { path: r.path, size: formatBytes(r.size_bytes) }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("databases.tabs.databases")}</label>
        <input value={database} onChange={(e) => setDatabase(e.target.value)} className="bg-bg-primary border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary" />
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">{t("databases.backups.directory")}</label>
        <input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder={t("databases.connection.backupDirPlaceholder")}
          className="bg-bg-primary border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary"
        />
      </div>
      <button onClick={run} disabled={running} className="px-4 py-1.5 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white disabled:opacity-50 flex items-center gap-2">
        {running ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        {t("databases.backups.run")}
      </button>
    </div>
  );
}

// ── Redis ─────────────────────────────────────────────────────────────────────────────
function RedisPanel({ serverId, container }: { serverId: string; container: string | null }) {
  const { t } = useT();
  const [info, setInfo] = useState<RedisInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  useEffect(() => {
    invoke<RedisInfo>("db_redis_info", { serverId, container }).then(setInfo).catch((e) => setErrorMsg(String(e)));
  }, [serverId, container]);

  if (errorMsg) return <ErrorBox message={errorMsg} />;
  if (!info) return <Loader2 size={16} className="animate-spin text-text-muted" />;

  return (
    <div className="bg-bg-tertiary border border-border-primary rounded-win p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div><span className="text-text-muted">{t("databases.redis.version")}</span> <span className="text-text-primary">{info.version}</span></div>
        <div><span className="text-text-muted">{t("databases.redis.memory")}</span> <span className="text-text-primary">{info.used_memory_human}</span></div>
      </div>
      <div>
        <p className="text-xs text-text-muted mb-1">{t("databases.redis.keysPerDb")}</p>
        {info.keys_per_db.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("databases.redis.noKeys")}</p>
        ) : (
          <div className="flex gap-3 flex-wrap">
            {info.keys_per_db.map(([db, count]) => (
              <span key={db} className="px-2 py-1 rounded-win bg-bg-primary text-xs text-text-primary">{db} : {count}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Modale de connexion ───────────────────────────────────────────────────────────────
function ConnectionModal({
  serverId, engine, onClose, onSaved, onError,
}: {
  serverId: string;
  engine: DbEngine;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [backupDir, setBackupDir] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<DbConnectionView[]>("get_db_connections", { serverId }).then((list) => {
      const c = list.find((x) => x.engine === engine);
      if (c) { setUsername(c.username); setBackupDir(c.backup_dir); }
    });
  }, [serverId, engine]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: DbConnectionPayload = {
        server_id: serverId,
        engine,
        username,
        backup_dir: backupDir,
        password: clearPassword ? "" : password || undefined,
      };
      await invoke("save_db_connection", { payload });
      onSaved();
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmDialog
      title={t("databases.connection.title", { engine: ENGINE_LABEL[engine] })}
      message={t("databases.connection.systemAuth")}
      confirmLabel={t("databases.connection.save")}
      confirmDisabled={saving}
      onCancel={onClose}
      onConfirm={save}
    >
      <div className="space-y-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("databases.connection.username")}
          className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("databases.connection.passwordPlaceholder")}
          disabled={clearPassword}
          className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary disabled:opacity-50"
        />
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
          {t("databases.connection.clearPassword")}
        </label>
        <input
          value={backupDir}
          onChange={(e) => setBackupDir(e.target.value)}
          placeholder={t("databases.connection.backupDirPlaceholder")}
          className="w-full bg-bg-primary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary"
        />
      </div>
    </ConfirmDialog>
  );
}
