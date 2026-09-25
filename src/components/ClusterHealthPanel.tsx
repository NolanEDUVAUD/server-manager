import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, CheckCircle2, HardDrive, Database, Server, RefreshCw, ChevronDown } from "lucide-react";
import { ClusterHealth } from "../types";
import { cn, formatBytes, formatUptime } from "../utils";
import { DrainNodeModal } from "./DrainNodeModal";
import { useT } from "../i18n";

function Bar({ percent }: { percent: number }) {
  const color = percent >= 90 ? "bg-accent-error" : percent >= 75 ? "bg-accent-warning" : "bg-accent-success";
  return (
    <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  );
}

/** Santé d'un cluster Proxmox : quorum, nœuds, stockages, disques (SMART) */
export function ClusterHealthPanel({ connectionId }: { connectionId: string }) {
  const { t } = useT();
  const [health, setHealth] = useState<ClusterHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const [draining, setDraining] = useState<string | null>(null);

  function load() {
    setLoading(true);
    invoke<ClusterHealth>("proxmox_cluster_health", { connectionId })
      .then((h) => { setHealth(h); setError(""); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [connectionId]);

  if (error && !health) {
    return <p className="text-xs text-accent-error bg-bg-tertiary border border-border-primary rounded-win p-3">{t("proxmox.health.unavailable", { message: error })}</p>;
  }
  if (!health) return null;

  const online = health.nodes.filter((n) => n.online).length;
  const ok = health.warnings.length === 0;

  return (
    <div className="bg-bg-tertiary border border-border-primary rounded-win">
      {draining && <DrainNodeModal connectionId={connectionId} node={draining} onClose={() => setDraining(null)} />}
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        {ok ? <CheckCircle2 size={16} className="text-accent-success shrink-0" /> : <AlertTriangle size={16} className="text-accent-warning shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-text-primary">
            {t("proxmox.health.cluster")} <span className="font-medium">{health.name}</span>
            <span className="text-text-secondary">
              {" · "}
              {t("proxmox.health.summary", {
                quorum: health.quorate ? t("proxmox.health.quorumOk") : t("proxmox.health.quorumLost"),
                online,
                count: health.nodes.length,
              })}
            </span>
          </p>
          <p className={cn("text-xs truncate", ok ? "text-text-muted" : "text-accent-warning")}>
            {ok ? t("proxmox.health.noProblem") : t("proxmox.health.problems", { count: health.warnings.length, first: health.warnings[0] })}
          </p>
        </div>
        <span onClick={(e) => { e.stopPropagation(); load(); }} className="p-1 rounded text-text-muted hover:text-accent-primary" title={t("common.refresh")}>
          <RefreshCw size={13} className={cn(loading && "animate-spin")} />
        </span>
        <ChevronDown size={14} className={cn("text-text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border-secondary pt-3">
          {!ok && (
            <ul className="space-y-1">
              {health.warnings.map((w) => (
                <li key={w} className="flex items-start gap-2 text-xs text-accent-warning"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{w}</li>
              ))}
            </ul>
          )}

          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {health.nodes.map((n) => (
              <div key={n.name} className="bg-bg-secondary rounded-win p-3 space-y-2">
                <p className="flex items-center gap-2 text-sm text-text-primary">
                  <Server size={13} className={n.online ? "text-accent-success" : "text-accent-error"} />
                  {n.name}
                  <span className="ml-auto text-[11px] text-text-muted">{n.online ? formatUptime(n.uptime_secs) : t("proxmox.health.nodeOffline")}</span>
                  {n.online && (
                    <button onClick={() => setDraining(n.name)} className="text-[11px] text-accent-primary hover:underline" title={t("proxmox.health.drainHint")}>
                      {t("proxmox.health.drain")}
                    </button>
                  )}
                </p>
                {n.online && (
                  <div className="space-y-1.5 text-[11px] text-text-secondary">
                    <div><div className="flex justify-between"><span>CPU</span><span>{n.cpu_percent.toFixed(0)} %</span></div><Bar percent={n.cpu_percent} /></div>
                    <div><div className="flex justify-between"><span>RAM</span><span>{n.mem_percent.toFixed(0)} %</span></div><Bar percent={n.mem_percent} /></div>
                    <div><div className="flex justify-between"><span>{t("proxmox.health.systemDisk")}</span><span>{n.disk_percent.toFixed(0)} %</span></div><Bar percent={n.disk_percent} /></div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div>
            <p className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1.5"><Database size={12} /> {t("proxmox.health.storages")}</p>
            <div className="divide-y divide-border-secondary">
              {health.storages.map((st) => {
                const down = st.unavailable_on.length > 0;
                return (
                  <div key={st.name} className="flex items-center gap-3 py-1.5 text-xs">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", down ? "bg-accent-error" : "bg-accent-success")} />
                    <span className="text-text-primary w-40 truncate">{st.name}</span>
                    <span className="text-text-muted w-28 truncate">{st.plugin}{st.shared ? ` · ${t("proxmox.health.shared")}` : ""}</span>
                    <span className="flex-1 min-w-0">
                      {down ? (
                        <span className="text-accent-error truncate block">{t("proxmox.health.unavailableOn", { nodes: st.unavailable_on.join(", ") })}</span>
                      ) : st.used_percent !== null ? (
                        <Bar percent={st.used_percent} />
                      ) : null}
                    </span>
                    <span className="text-text-muted w-28 text-right tabular-nums">
                      {st.used_percent !== null && st.total_bytes ? t("proxmox.health.usedOf", { percent: st.used_percent.toFixed(0), total: formatBytes(st.total_bytes) }) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {health.disks.length > 0 && (
            <div>
              <p className="flex items-center gap-2 text-xs font-medium text-text-secondary mb-1.5"><HardDrive size={12} /> {t("proxmox.health.disks")}</p>
              <div className="divide-y divide-border-secondary">
                {health.disks.map((d) => {
                  const healthy = ["PASSED", "OK"].includes(d.health);
                  return (
                    <div key={`${d.node}${d.devpath}`} className="flex items-center gap-3 py-1.5 text-xs">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", healthy ? "bg-accent-success" : "bg-accent-error")} />
                      <span className="text-text-muted w-28 truncate">{d.node}</span>
                      <span className="text-text-primary w-24 truncate">{d.devpath}</span>
                      <span className="text-text-secondary flex-1 truncate">{d.model} · {formatBytes(d.size_bytes)} · {d.kind}</span>
                      <span className={cn("w-20 text-right", healthy ? "text-accent-success" : "text-accent-error")}>{d.health || "?"}</span>
                      <span className="text-text-muted w-24 text-right">{d.life_left_percent !== null ? t("proxmox.health.lifeLeft", { percent: d.life_left_percent }) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
