import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, ScrollText, Search, Radio, History as HistoryIcon } from "lucide-react";
import { useStore } from "../stores/useStore";
import { LogEntry } from "../types";
import { cn } from "../utils";
import { fold } from "../utils/fuzzy";

const LEVELS = [
  { value: 3, label: "Erreurs" },
  { value: 4, label: "Avertissements +" },
  { value: 6, label: "Infos +" },
  { value: 7, label: "Tout" },
];
const RANGES = [
  { value: 15, label: "15 min" },
  { value: 60, label: "1 h" },
  { value: 360, label: "6 h" },
  { value: 1440, label: "24 h" },
];
const PRIORITY_COLOR: Record<number, string> = { 0: "text-red-400", 1: "text-red-400", 2: "text-red-400", 3: "text-accent-error", 4: "text-accent-warning", 5: "text-accent-info" };

/** Serveur de l'app correspondant à un hôte Loki (« docker-host » ↔ « DockerHost ») */
export function matchServer<T extends { name: string }>(host: string, servers: T[]): T | undefined {
  const n = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");
  return servers.find((s) => n(s.name) === n(host));
}

export function Logs() {
  const { servers, events } = useStore();
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [host, setHost] = useState("");
  const [units, setUnits] = useState<string[]>([]);
  const [unit, setUnit] = useState("");
  const [level, setLevel] = useState(4);
  const [range, setRange] = useState(60);
  const [text, setText] = useState("");
  const [window_, setWindow] = useState<{ start: number; end: number } | null>(null);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    invoke<string[]>("loki_hosts")
      .then((h) => { setHosts(h); if (h[0]) setHost(h[0]); })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!host) return;
    setUnit("");
    invoke<string[]>("loki_units", { host }).then((u) => setUnits(u.filter((x) => x.endsWith(".service")).sort())).catch(() => setUnits([]));
  }, [host]);

  async function search(win = window_) {
    if (!host) return;
    setLoading(true);
    setError("");
    const end = win?.end ?? Date.now();
    const start = win?.start ?? end - range * 60_000;
    try {
      setEntries(await invoke<LogEntry[]>("loki_query", { host, maxPriority: level, unit: unit || null, text: text || null, startMs: start, endMs: end, limit: 500 }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (host) search(); }, [host, level, range, unit]);

  // Suivi en direct : nouvelle requête toutes les 5 s sur la fenêtre glissante
  useEffect(() => {
    if (!live) return;
    setWindow(null);
    const timer = setInterval(() => liveRef.current && search(null), 5000);
    return () => clearInterval(timer);
  }, [live, host, level, unit, text, range]);

  const server = matchServer(host, servers);
  const lastOutage = server ? events.find((e) => e.server_id === server.id && e.kind === "Offline") : undefined;

  function aroundOutage() {
    if (!lastOutage) return;
    const win = { start: lastOutage.ts - 10 * 60_000, end: lastOutage.ts + 5 * 60_000 };
    setLive(false);
    setWindow(win);
    setLevel(7);
    search(win);
  }

  if (error && !hosts) {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-text-primary font-semibold text-lg">Logs</h1>
        <p className="text-sm text-accent-error">{error}</p>
        <p className="text-xs text-text-muted">Configure Loki dans <Link to="/settings" className="text-accent-primary hover:underline">Paramètres → Intégrations</Link>.</p>
      </div>
    );
  }

  const selectClass = "bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

  return (
    <div className="p-6 space-y-4 flex flex-col h-full">
      <div>
        <h1 className="text-text-primary font-semibold text-lg">Logs</h1>
        <p className="text-text-secondary text-xs mt-0.5">Journaux systemd centralisés dans Loki</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={host} onChange={(e) => { setHost(e.target.value); setWindow(null); }} className={selectClass} aria-label="Hôte">
          {(hosts ?? []).map((h) => <option key={h} value={h}>{h}{matchServer(h, servers) ? "" : " (hors app)"}</option>)}
        </select>
        <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className={selectClass} aria-label="Niveau">
          {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <select value={range} onChange={(e) => { setRange(Number(e.target.value)); setWindow(null); }} className={selectClass} aria-label="Période">
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={unit} onChange={(e) => setUnit(e.target.value)} className={cn(selectClass, "max-w-56")} aria-label="Unité">
          <option value="">Toutes les unités</option>
          {units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex items-center gap-1 flex-1 min-w-48">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Rechercher…" aria-label="Texte recherché" className={cn(selectClass, "flex-1")} />
          <button type="submit" className="p-2 rounded-win border border-border-primary text-text-secondary hover:text-accent-primary"><Search size={14} /></button>
        </form>
        <button onClick={() => setLive((l) => !l)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-win border text-sm", live ? "border-accent-success text-accent-success" : "border-border-primary text-text-secondary")}>
          <Radio size={13} className={cn(live && "animate-pulse-soft")} /> Direct
        </button>
        {lastOutage && (
          <button onClick={aroundOutage} className="flex items-center gap-1.5 px-3 py-1.5 rounded-win border border-border-primary text-sm text-text-secondary hover:text-text-primary" title="10 min avant → 5 min après la dernière coupure">
            <HistoryIcon size={13} /> Autour de la dernière coupure
          </button>
        )}
      </div>

      {window_ && (
        <p className="text-xs text-accent-info">
          Fenêtre : {new Date(window_.start).toLocaleString("fr-FR")} → {new Date(window_.end).toLocaleTimeString("fr-FR")}
          <button onClick={() => { setWindow(null); search(null); }} className="ml-2 underline">revenir au direct</button>
        </p>
      )}
      {error && <p className="text-sm text-accent-error">{error}</p>}

      <div className="flex-1 min-h-0 overflow-y-auto bg-bg-primary border border-border-primary rounded-win font-mono text-[11px]">
        {!entries || loading && entries.length === 0 ? (
          <div className="p-4 text-text-muted flex items-center gap-2">{loading ? <Loader2 size={14} className="animate-spin" /> : <ScrollText size={14} />} Chargement…</div>
        ) : entries.length === 0 ? (
          <p className="p-4 text-text-muted">Aucune entrée pour ces critères.</p>
        ) : (
          entries.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex gap-3 px-3 py-0.5 hover:bg-bg-hover select-text">
              <span className="text-text-muted shrink-0">{new Date(e.ts).toLocaleTimeString("fr-FR")}</span>
              <span className="text-text-muted shrink-0 w-40 truncate" title={e.unit}>{e.unit.replace(/\.service$/, "")}</span>
              <span className={cn("break-all", e.priority !== null ? PRIORITY_COLOR[e.priority] ?? "text-text-secondary" : "text-text-secondary")}>{e.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
