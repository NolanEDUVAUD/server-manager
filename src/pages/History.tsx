import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  WifiOff, Wifi, Zap, Power, RotateCcw, Boxes, AlertTriangle, History as HistoryIcon, Trash2, Container, BellRing,
} from "lucide-react";
import { useStore } from "../stores/useStore";
import { AppEvent, EventKind, ServerEventStats, ServerUptime, OS_ICONS } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { cn, formatUptime } from "../utils";
import { currentLocale, TKey, useT } from "../i18n";

const KIND_META: Record<EventKind, { label: TKey; icon: typeof Wifi; color: string }> = {
  Offline: { label: "events.kinds.offline", icon: WifiOff, color: "text-accent-error" },
  Online: { label: "events.kinds.online", icon: Wifi, color: "text-accent-success" },
  Wake: { label: "events.kinds.wake", icon: Zap, color: "text-yellow-400" },
  Shutdown: { label: "events.kinds.shutdown", icon: Power, color: "text-red-400" },
  Reboot: { label: "events.kinds.reboot", icon: RotateCcw, color: "text-accent-info" },
  VmAction: { label: "events.kinds.vmAction", icon: Boxes, color: "text-accent-primary" },
  Container: { label: "events.kinds.container", icon: Container, color: "text-accent-info" },
  Alert: { label: "events.kinds.alert", icon: BellRing, color: "text-accent-warning" },
  Failure: { label: "events.kinds.failure", icon: AlertTriangle, color: "text-accent-warning" },
};

const STATS_DAYS = 30;

/** 99,95 % plutôt que 100 % arrondi : une coupure courte reste visible */
export function formatPercent(p: number): string {
  if (p >= 100) return "100 %";
  const digits = p >= 99 ? 2 : 1;
  const value = Math.floor(p * 10 ** digits) / 10 ** digits;
  return `${value.toLocaleString(currentLocale(), { maximumFractionDigits: digits })} %`;
}

type Translate = ReturnType<typeof useT>["t"];

/**
 * Libellé du jour : « Aujourd'hui », « Hier », sinon la date longue. `inline` = forme
 * utilisée au milieu d'une phrase (« aujourd'hui »), la date restant telle quelle.
 */
function dayLabel(ts: number, t: Translate, locale: string, inline = false): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t(inline ? "events.todayInline" : "events.today");
  if (d.toDateString() === yesterday.toDateString()) return t(inline ? "events.yesterdayInline" : "events.yesterday");
  return d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
}

function timeLabel(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EventRow({ event }: { event: AppEvent }) {
  const { locale } = useT();
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
      <span className="text-xs text-text-muted tabular-nums shrink-0">{timeLabel(event.ts, locale)}</span>
    </div>
  );
}

export function History() {
  const { t, locale } = useT();
  const { events, servers, clearEvents } = useStore();
  const [stats, setStats] = useState<ServerEventStats[]>([]);
  const [uptime, setUptime] = useState<ServerUptime[]>([]);
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<EventKind | "all">("all");
  const [confirmClear, setConfirmClear] = useState(false);

  // Recalcul des statistiques à chaque nouvel événement
  useEffect(() => {
    invoke<ServerEventStats[]>("get_event_stats", { days: STATS_DAYS }).then(setStats).catch(() => setStats([]));
    invoke<ServerUptime[]>("get_server_uptime", { days: STATS_DAYS }).then(setUptime).catch(() => setUptime([]));
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
      const day = dayLabel(e.ts, t, locale);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.items.push(e);
      else groups.push({ day, items: [e] });
    }
    return groups;
    // `locale` suit la langue : les libellés de jour sont recalculés quand elle change
  }, [filtered, locale]);

  const selectClass =
    "bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("events.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">
            {t("events.subtitle")} · {t("events.count", { count: events.length })}
          </p>
        </div>
        {events.length > 0 && (
          <button
            onClick={() => setConfirmClear(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:text-red-400 hover:border-red-400/40 transition-all"
          >
            <Trash2 size={13} />
            {t("events.clear")}
          </button>
        )}
      </div>

      {/* ── Disponibilité sur 30 jours ─────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {servers.map((s) => {
          const st = stats.find((x) => x.server_id === s.id);
          const outages = st?.outages ?? 0;
          const up = uptime.find((x) => x.server_id === s.id);
          const last = events.find((e) => e.server_id === s.id);
          return (
            <div key={s.id} className="bg-bg-tertiary border border-border-primary rounded-win p-3 flex items-center gap-3">
              <span className="text-lg shrink-0">{OS_ICONS[s.os_type]}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">{s.name}</p>
                <p className="text-xs text-text-muted truncate">
                  {last ? `${t(KIND_META[last.kind].label)} · ${dayLabel(last.ts, t, locale, true)} ${timeLabel(last.ts, locale)}` : t("events.noEvent")}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn("text-sm font-medium tabular-nums", outages > 0 ? "text-accent-warning" : "text-accent-success")}>
                  {t("events.outages", { count: outages })}
                </p>
                <p className="text-[11px] text-text-muted">
                  {st && st.downtime_ms > 0 ? t("events.offlineFor", { duration: formatUptime(Math.round(st.downtime_ms / 1000)) }) : t("events.statsDays", { days: STATS_DAYS })}
                </p>
                {up && up.checks > 0 && (
                  <p className="text-[11px] text-text-muted tabular-nums" title={t("events.pingsTitle", { online: up.online, checks: up.checks })}>
                    {t("events.uptime", { percent: formatPercent(up.uptime_percent) })}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Journal ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={serverFilter} onChange={(e) => setServerFilter(e.target.value)} className={selectClass}>
          <option value="all">{t("events.allServers")}</option>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as EventKind | "all")} className={selectClass}>
          <option value="all">{t("events.allTypes")}</option>
          {(Object.keys(KIND_META) as EventKind[]).map((k) => <option key={k} value={k}>{t(KIND_META[k].label)}</option>)}
        </select>
      </div>

      {byDay.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-text-muted text-sm">
          <HistoryIcon size={28} className="opacity-50" />
          {t("events.empty")}
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
          title={t("events.clearTitle")}
          message={t("events.clearMessage")}
          confirmLabel={t("events.clear")}
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
