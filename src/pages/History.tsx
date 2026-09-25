import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  WifiOff, Wifi, Zap, Power, RotateCcw, Boxes, AlertTriangle, History as HistoryIcon, Trash2, Container, BellRing,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { AppEvent, EventKind, ServerEventStats, OS_ICONS } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { cn, formatUptime } from "../utils";

const KIND_META: Record<EventKind, { label: string; icon: typeof Wifi; color: string }> = {
  Offline: { label: "Hors ligne", icon: WifiOff, color: "text-accent-error" },
  Online: { label: "En ligne", icon: Wifi, color: "text-accent-success" },
  Wake: { label: "Wake-on-LAN", icon: Zap, color: "text-yellow-400" },
  Shutdown: { label: "Arrêt", icon: Power, color: "text-red-400" },
  Reboot: { label: "Redémarrage", icon: RotateCcw, color: "text-accent-info" },
  VmAction: { label: "Action VM", icon: Boxes, color: "text-accent-primary" },
  Container: { label: "Docker", icon: Container, color: "text-accent-info" },
  Alert: { label: "Alerte", icon: BellRing, color: "text-accent-warning" },
  Failure: { label: "Échec", icon: AlertTriangle, color: "text-accent-warning" },
};

const STATS_DAYS = 30;

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Aujourd'hui";
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ event }: { event: AppEvent }) {
  const meta = KIND_META[event.kind];
  const Icon = meta.icon;
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-bg-hover transition-colors">
      <Icon size={15} className={cn("shrink-0 mt-0.5", meta.color)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary">
          <span className="font-medium">{event.target}</span>
          <span className="text-text-secondary"> · {event.message}</span>
        </p>
      </div>
      <span className="text-xs text-text-muted tabular-nums shrink-0">{timeLabel(event.ts)}</span>
    </div>
  );
}

export function History() {
  const { events, servers, clearEvents } = useStore();
  const [stats, setStats] = useState<ServerEventStats[]>([]);
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<EventKind | "all">("all");
  const [confirmClear, setConfirmClear] = useState(false);

  // Recalcul des statistiques à chaque nouvel événement
  useEffect(() => {
    invoke<ServerEventStats[]>("get_event_stats", { days: STATS_DAYS }).then(setStats).catch(() => setStats([]));
  }, [events.length]);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (serverFilter === "all" || e.server_id === serverFilter) &&
          (kindFilter === "all" || e.kind === kindFilter)
      ),
    [events, serverFilter, kindFilter]
  );

  // Regroupement par jour, en conservant l'ordre (du plus récent au plus ancien)
  const byDay = useMemo(() => {
    const groups: { day: string; items: AppEvent[] }[] = [];
    for (const e of filtered.slice(0, 500)) {
      const day = dayLabel(e.ts);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(e);
      else groups.push({ day, items: [e] });
    }
    return groups;
  }, [filtered]);

  const selectClass =
    "bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">Historique</h1>
          <p className="text-text-secondary text-xs mt-0.5">
            Pertes de connexion et actions sur tes serveurs · {events.length} événement(s)
          </p>
        </div>
        {events.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:text-red-400 hover:border-red-400/40 transition-all"
          >
            <Trash2 size={13} />
            Effacer
          </button>
        )}
      </div>

      {/* ── Disponibilité sur 30 jours ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {servers.map((s) => {
          const st = stats.find((x) => x.server_id === s.id);
          const outages = st?.outages ?? 0;
          const last = events.find((e) => e.server_id === s.id);
          return (
            <div key={s.id} className="bg-bg-tertiary border border-border-primary rounded-win p-3 flex items-center gap-3">
              <span className="text-lg shrink-0">{OS_ICONS[s.os_type]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{s.name}</p>
                <p className="text-xs text-text-muted truncate">
                  {last ? `${KIND_META[last.kind].label} · ${dayLabel(last.ts).toLowerCase()} ${timeLabel(last.ts)}` : "Aucun événement"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn("text-sm font-medium tabular-nums", outages > 0 ? "text-accent-warning" : "text-accent-success")}>
                  {outages} coupure{outages > 1 ? "s" : ""}
                </p>
                <p className="text-[11px] text-text-muted">
                  {st && st.downtime_ms > 0 ? `${formatUptime(Math.round(st.downtime_ms / 1000))} hors ligne` : `${STATS_DAYS} j`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Journal ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className={selectClass}>
          <option value="all">Tous les serveurs</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as EventKind | "all")} className={selectClass}>
          <option value="all">Tous les types</option>
          {(Object.keys(KIND_META) as EventKind[]).map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
        </select>
      </div>

      {byDay.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-text-muted text-sm">
          <HistoryIcon size={28} className="opacity-50" />
          Aucun événement pour l'instant : ils apparaissent dès qu'un serveur change d'état ou qu'une action est lancée.
        </div>
      ) : (
        <div className="space-y-4">
          {byDay.map(({ day, items }) => (
            <div key={day}>
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1.5">{day}</p>
              <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
                {items.map((e) => <EventRow key={e.id} event={e} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Effacer l'historique"
          message="Tous les événements et les statistiques de disponibilité seront supprimés. Continuer ?"
          confirmLabel="Effacer"
          dangerous
          onConfirm={() => {
            setConfirmClear(false);
            clearEvents().catch(console.error);
          }}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
