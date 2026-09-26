import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Container as ContainerIcon, Play, Square, RotateCw, ScrollText, RefreshCw, Loader2, X, AlertTriangle,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { DockerHost, DockerContainer, OS_ICONS } from "../types";
import { supportsMetrics } from "../hooks/useMetrics";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { cn } from "../utils";
import { useT } from "../i18n";

type HostState = { loading: boolean; host?: DockerHost; error?: string };

const STATE_COLOR: Record<string, string> = {
  running: "bg-accent-success",
  paused: "bg-accent-warning",
  restarting: "bg-accent-warning animate-pulse-soft",
};

const REFRESH_MS = 15_000;

function LogsModal({ serverId, container, onClose }: { serverId: string; container: DockerContainer; onClose: () => void }) {
  const { t } = useT();
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    invoke<string>("docker_logs", { serverId, container: container.id, tail: 300 })
      .then(setLogs)
      .catch((e) => setError(String(e)));
  }, [serverId, container.id]);

  useEffect(load, [load]);

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-4xl mx-4 h-[75vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-primary shrink-0">
          <div className="min-w-0">
            <h2 className="text-text-primary font-semibold text-sm truncate">{t("docker.logs.title", { name: container.name })}</h2>
            <p className="text-text-muted text-xs truncate">{container.image} · {t("docker.logs.lastLines", { count: 300 })}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={load} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10" title={t("common.refresh")}>
              <RefreshCw size={14} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded text-text-secondary hover:text-text-primary" title={t("common.close")}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4 bg-bg-primary rounded-b-win-lg">
          {error ? (
            <p className="text-accent-error text-sm">{error}</p>
          ) : logs === null ? (
            <Loader2 size={16} className="animate-spin text-text-muted" />
          ) : (
            <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap break-all select-text">{logs || t("docker.logs.noOutput")}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function Docker() {
  const { t } = useT();
  const { servers, statuses } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const candidates = servers.filter(supportsMetrics);
  const [hosts, setHosts] = useState<Record<string, HostState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<DockerContainer | null>(null);

  const refresh = useCallback((serverId: string) => {
    setHosts((h) => ({ ...h, [serverId]: { ...h[serverId], loading: true } }));
    invoke<DockerHost>("docker_list", { serverId })
      .then((host) => setHosts((h) => ({ ...h, [serverId]: { loading: false, host } })))
      .catch((e) => setHosts((h) => ({ ...h, [serverId]: { loading: false, error: String(e) } })));
  }, []);

  // Détection de Docker sur chaque serveur en ligne à l'ouverture de la page
  useEffect(() => {
    for (const s of candidates) {
      if (statuses[s.id]?.online) refresh(s.id);
    }
  }, []);

  // Sélection automatique du premier hôte Docker trouvé
  useEffect(() => {
    if (selected) return;
    const first = candidates.find((s) => hosts[s.id]?.host?.available);
    if (first) setSelected(first.id);
  }, [hosts]);

  // Actualisation périodique de l'hôte affiché
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => refresh(selected), REFRESH_MS);
    return () => clearInterval(timer);
  }, [selected, refresh]);

  async function act(c: DockerContainer, action: "start" | "stop" | "restart") {
    if (!selected) return;
    setBusy(`${c.id}:${action}`);
    try {
      await invoke("docker_action", { serverId: selected, container: c.id, action });
      success(t(action === "start" ? "docker.started" : action === "stop" ? "docker.stopped" : "docker.restarted", { name: c.name }));
      refresh(selected);
    } catch (e) {
      error(String(e));
    } finally {
      setBusy(null);
    }
  }

  const current = selected ? hosts[selected] : undefined;
  const containers = current?.host?.containers ?? [];

  function hostBadge(serverId: string): string {
    const st = hosts[serverId];
    if (!statuses[serverId]?.online) return t("docker.badge.offline");
    if (!st || (st.loading && !st.host)) return "…";
    if (st.error) return t("docker.badge.error");
    if (!st.host?.available) return t("docker.badge.noDocker");
    const running = st.host.containers.filter((c) => c.state === "running").length;
    return `${running}/${st.host.containers.length}`;
  }

  return (
    <div className="p-6 space-y-5">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div>
        <h1 className="text-text-primary font-semibold text-lg">Docker</h1>
        <p className="text-text-secondary text-xs mt-0.5">
          {t("docker.subtitle")}
        </p>
      </div>

      {/* ── Hôtes ─────────────────────────────────────────────────────── */}
      <div className="flex gap-2 flex-wrap">
        {candidates.map((s) => {
          const st = hosts[s.id];
          const usable = st?.host?.available;
          return (
            <button
              key={s.id}
              onClick={() => { setSelected(s.id); refresh(s.id); }}
              disabled={!statuses[s.id]?.online}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-win border text-sm transition-all disabled:opacity-40",
                selected === s.id
                  ? "border-accent-primary bg-accent-primary/10 text-text-primary"
                  : "border-border-primary bg-bg-tertiary text-text-secondary hover:text-text-primary"
              )}
            >
              <span>{OS_ICONS[s.os_type]}</span>
              {s.name}
              <span className={cn("text-[11px]", usable ? "text-accent-success" : "text-text-muted")}>{hostBadge(s.id)}</span>
            </button>
          );
        })}
      </div>

      {/* ── Conteneurs ────────────────────────────────────────────────── */}
      {!selected ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <ContainerIcon size={28} className="opacity-50" />
          {t("docker.pickServer")}
        </div>
      ) : current?.error ? (
        <div className="flex items-start gap-2 text-sm text-accent-error bg-bg-tertiary border border-border-primary rounded-win p-4">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{current.error}</span>
        </div>
      ) : current?.host && !current.host.available ? (
        <p className="text-sm text-text-secondary bg-bg-tertiary border border-border-primary rounded-win p-4">
          {t("docker.notInstalled")}
        </p>
      ) : !current?.host ? (
        <Loader2 size={18} className="animate-spin text-text-muted" />
      ) : containers.length === 0 ? (
        <p className="text-sm text-text-secondary">{t("docker.noContainers")}</p>
      ) : (
        <div className="bg-bg-tertiary border border-border-primary rounded-win overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border-primary text-xs text-text-muted">
            <span>{t("docker.containers", { count: containers.length })}</span>
            <button onClick={() => refresh(selected)} className="flex items-center gap-1 hover:text-accent-primary">
              <RefreshCw size={12} className={cn(current.loading && "animate-spin")} /> {t("common.refresh")}
            </button>
          </div>
          <div className="divide-y divide-border-secondary">
            {containers.map((c) => {
              const running = c.state === "running";
              return (
                <div key={c.id} className="flex items-center gap-4 px-4 py-2.5">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", STATE_COLOR[c.state] ?? "bg-text-muted")} title={c.state} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text-primary truncate">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-text-muted"> · {c.image}</span>
                    </p>
                    <p className="text-xs text-text-muted truncate">{c.status}{c.ports && ` · ${c.ports}`}</p>
                  </div>
                  <div className="text-right text-xs tabular-nums shrink-0 w-32">
                    {running && c.cpu_percent !== null ? (
                      <>
                        <p className="text-text-primary">CPU {c.cpu_percent.toFixed(1)} %</p>
                        <p className="text-text-muted truncate" title={c.mem_usage ?? ""}>{c.mem_usage?.split(" / ")[0] ?? "—"}</p>
                      </>
                    ) : (
                      <p className="text-text-muted">—</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!running ? (
                      <IconButton title={t("docker.start")} busy={busy === `${c.id}:start`} onClick={() => act(c, "start")}><Play size={13} /></IconButton>
                    ) : (
                      <>
                        <IconButton title={t("docker.restart")} busy={busy === `${c.id}:restart`} onClick={() => act(c, "restart")}><RotateCw size={13} /></IconButton>
                        <IconButton title={t("docker.stop")} busy={busy === `${c.id}:stop`} onClick={() => act(c, "stop")} danger><Square size={13} /></IconButton>
                      </>
                    )}
                    <IconButton title={t("docker.logs.button")} onClick={() => setLogsFor(c)}><ScrollText size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {logsFor && selected && <LogsModal serverId={selected} container={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function IconButton({ title, onClick, busy, danger, children }: {
  title: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  children: React.ReactNode;
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
