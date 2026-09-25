import { Loader2, WifiOff, AlertTriangle, Ban, Thermometer } from "lucide-react";
import { Server, OS_ICONS, ServerMetrics, MetricsSample, ServerStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { ServerIconDisplay } from "./IconPicker";
import { Sparkline } from "./Sparkline";
import { cn, formatBytes, formatUptime } from "../utils";

interface ResourceCardProps {
  server: Server;
  status?: ServerStatus;
  supported: boolean;
  metrics?: ServerMetrics;
  error?: string;
  history: MetricsSample[];
}

/** Couleur selon le taux d'occupation : vert < 70 %, orange < 90 %, rouge au-delà. */
function levelColor(percent: number): string {
  if (percent >= 90) return "bg-accent-error";
  if (percent >= 70) return "bg-accent-warning";
  return "bg-accent-success";
}

/** Couleur d'une température : normale < 70 °C, chaude < 85 °C, critique au-delà. */
function tempColor(celsius: number): string {
  if (celsius >= 85) return "text-accent-error";
  if (celsius >= 70) return "text-accent-warning";
  return "text-accent-success";
}

/**
 * Températures : CPU mis en avant, puis la sonde la plus chaude de chaque autre
 * puce (NVMe, carte mère…) pour rester lisible même avec 16 cœurs.
 */
function Temperatures({ metrics }: { metrics: ServerMetrics }) {
  const others = new Map<string, number>();
  for (const t of metrics.temperatures) {
    if (["coretemp", "k10temp", "zenpower", "cpu_thermal"].includes(t.chip)) continue;
    others.set(t.chip, Math.max(others.get(t.chip) ?? 0, t.celsius));
  }
  if (metrics.cpu_temp_celsius === null && others.size === 0) return null;

  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
      <Thermometer size={13} className="text-text-muted shrink-0" />
      {metrics.cpu_temp_celsius !== null && (
        <span className="text-text-secondary">
          CPU <span className={cn("font-medium tabular-nums", tempColor(metrics.cpu_temp_celsius))}>
            {metrics.cpu_temp_celsius.toFixed(0)} °C
          </span>
        </span>
      )}
      {[...others].map(([chip, celsius]) => (
        <span
          key={chip}
          className="text-text-muted"
          title={metrics.temperatures
            .filter((t) => t.chip === chip)
            .map((t) => `${t.label} : ${t.celsius.toFixed(1)} °C`)
            .join("\n")}
        >
          {chip} <span className={cn("tabular-nums", tempColor(celsius))}>{celsius.toFixed(0)} °C</span>
        </span>
      ))}
    </div>
  );
}

function UsageBar({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-text-secondary truncate">{label}</span>
        <span className="text-text-primary tabular-nums shrink-0">
          {percent.toFixed(0)} % <span className="text-text-muted">· {detail}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-hover overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", levelColor(percent))}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

function Placeholder({ icon: Icon, text, tone = "muted" }: {
  icon: typeof WifiOff;
  text: string;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 text-xs py-6 px-1",
        tone === "error" ? "text-accent-error" : "text-text-muted"
      )}
    >
      <Icon size={14} className={cn("shrink-0 mt-0.5", Icon === Loader2 && "animate-spin")} />
      <span className="break-words min-w-0">{text}</span>
    </div>
  );
}

export function ResourceCard({ server, status, supported, metrics, error, history }: ResourceCardProps) {
  const online = status?.online ?? false;
  const memPercent = metrics && metrics.mem_total_bytes > 0
    ? (metrics.mem_used_bytes * 100) / metrics.mem_total_bytes
    : 0;

  let body: React.ReactNode;
  if (!supported) {
    body = <Placeholder icon={Ban} text={`Monitoring non disponible pour ${server.os_type}`} />;
  } else if (!online) {
    body = <Placeholder icon={WifiOff} text="Serveur hors ligne" />;
  } else if (error && !metrics) {
    body = <Placeholder icon={AlertTriangle} text={error} tone="error" />;
  } else if (!metrics) {
    body = <Placeholder icon={Loader2} text="Collecte en cours…" />;
  } else {
    body = (
      <div className="space-y-3">
        <UsageBar
          label="CPU"
          percent={metrics.cpu_percent}
          detail={`charge ${metrics.load_avg.map((l) => l.toFixed(2)).join(" ")}`}
        />
        <UsageBar
          label="RAM"
          percent={memPercent}
          detail={`${formatBytes(metrics.mem_used_bytes)} / ${formatBytes(metrics.mem_total_bytes)}`}
        />
        {metrics.disks.map((d) => (
          <UsageBar
            key={d.name}
            // Pool ZFS : le nom du pool parle plus que son point de montage
            label={d.fs_type === "zfs" ? `Pool ${d.name}` : d.mount === "/" ? "Disque système" : d.mount}
            percent={d.total_bytes > 0 ? (d.used_bytes * 100) / d.total_bytes : 0}
            detail={`${formatBytes(d.used_bytes)} / ${formatBytes(d.total_bytes)}`}
          />
        ))}

        <Temperatures metrics={metrics} />

        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <p className="text-[11px] text-text-muted mb-1">CPU · 30 min</p>
            <Sparkline values={history.map((h) => h.cpu)} className="text-accent-primary" />
          </div>
          <div>
            <p className="text-[11px] text-text-muted mb-1">RAM · 30 min</p>
            <Sparkline values={history.map((h) => h.mem)} className="text-accent-info" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-bg-tertiary border border-border-primary rounded-win shadow-win",
        "hover:shadow-win-hover transition-all duration-200 flex flex-col gap-3 p-4 animate-fade-in"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">
            {server.icon
              ? <ServerIconDisplay icon={server.icon} size={20} />
              : <span className="text-xl">{OS_ICONS[server.os_type]}</span>}
          </span>
          <div className="min-w-0">
            <h3 className="text-text-primary font-semibold text-sm truncate leading-tight">{server.name}</h3>
            <p className="text-text-muted text-xs">
              {server.ip}
              {metrics && ` · en marche depuis ${formatUptime(metrics.uptime_secs)}`}
            </p>
          </div>
        </div>
        <span className="shrink-0 whitespace-nowrap">
          <StatusBadge status={status} size="sm" />
        </span>
      </div>

      {body}

      {/* Erreur ponctuelle alors que des valeurs précédentes existent encore */}
      {error && metrics && <p className="text-[11px] text-accent-error truncate" title={error}>{error}</p>}
    </div>
  );
}
