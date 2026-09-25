import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Pencil, Trash2, Play, Radar, Sparkles, X, Lock, Loader2 } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Probe, ProbeKind, ProbeResult } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { describeProbe, suggestProbes } from "../utils/probes";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

function defaultKind(type: ProbeKind["type"]): ProbeKind {
  if (type === "Http") return { type, url: "https://", expect_status: null, keyword: null };
  if (type === "Tcp") return { type, host: "", port: 22 };
  return { type, host: "", port: 443, warn_days: 14 };
}

function ProbeForm({ initial, onSubmit, onCancel }: { initial: Probe; onSubmit: (p: Probe) => Promise<void>; onCancel: () => void }) {
  const { servers } = useStore();
  const [p, setP] = useState<Probe>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const k = p.kind;
  const setKind = (patch: Partial<ProbeKind>) => setP((x) => ({ ...x, kind: { ...x.kind, ...patch } as ProbeKind }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">{initial.id ? "Modifier la sonde" : "Nouvelle sonde"}</h2>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            try { await onSubmit(p); } catch (err) { setError(String(err)); } finally { setSaving(false); }
          }}
        >
          <label className="block"><span className="block text-xs text-text-secondary mb-1">Nom</span>
            <input className={inputClass} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Zabbix" aria-label="Nom de la sonde" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="block text-xs text-text-secondary mb-1">Type</span>
              <select className={inputClass} value={k.type} onChange={(e) => setP({ ...p, kind: defaultKind(e.target.value as ProbeKind["type"]) })} aria-label="Type de sonde">
                <option value="Http">HTTP(S)</option>
                <option value="Tcp">Port TCP</option>
                <option value="TlsExpiry">Certificat TLS</option>
              </select>
            </label>
            <label className="block"><span className="block text-xs text-text-secondary mb-1">Serveur (optionnel)</span>
              <select className={inputClass} value={p.server_id ?? ""} onChange={(e) => setP({ ...p, server_id: e.target.value || null })} aria-label="Serveur associé">
                <option value="">—</option>
                {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          </div>
          {k.type === "Http" && (
            <>
              <label className="block"><span className="block text-xs text-text-secondary mb-1">URL</span>
                <input className={inputClass} value={k.url} onChange={(e) => setKind({ url: e.target.value })} aria-label="URL" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="block text-xs text-text-secondary mb-1">Code attendu (vide = 2xx/3xx)</span>
                  <input type="number" className={inputClass} value={k.expect_status ?? ""} onChange={(e) => setKind({ expect_status: e.target.value ? Number(e.target.value) : null })} aria-label="Code attendu" />
                </label>
                <label className="block"><span className="block text-xs text-text-secondary mb-1">Mot-clé (optionnel)</span>
                  <input className={inputClass} value={k.keyword ?? ""} onChange={(e) => setKind({ keyword: e.target.value || null })} aria-label="Mot-clé" />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={p.verify_tls} onChange={(e) => setP({ ...p, verify_tls: e.target.checked })} className="accent-accent-primary" /> Vérifier le certificat (décocher si auto-signé)
              </label>
            </>
          )}
          {(k.type === "Tcp" || k.type === "TlsExpiry") && (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <label className="block"><span className="block text-xs text-text-secondary mb-1">Hôte</span>
                <input className={inputClass} value={k.host} onChange={(e) => setKind({ host: e.target.value })} placeholder="192.168.50.53" aria-label="Hôte" />
              </label>
              <label className="block"><span className="block text-xs text-text-secondary mb-1">Port</span>
                <input type="number" className={inputClass} value={k.port} onChange={(e) => setKind({ port: Number(e.target.value) })} aria-label="Port" />
              </label>
            </div>
          )}
          {k.type === "TlsExpiry" && (
            <label className="block"><span className="block text-xs text-text-secondary mb-1">Alerter à moins de (jours)</span>
              <input type="number" className={inputClass} value={k.warn_days} onChange={(e) => setKind({ warn_days: Number(e.target.value) })} aria-label="Seuil en jours" />
            </label>
          )}
          <label className="block"><span className="block text-xs text-text-secondary mb-1">Intervalle (secondes)</span>
            <input type="number" min={10} className={inputClass} value={p.interval_secs} onChange={(e) => setP({ ...p, interval_secs: Number(e.target.value) })} aria-label="Intervalle" />
          </label>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">Annuler</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium disabled:opacity-50">
              {saving && <Loader2 size={13} className="animate-spin" />} Enregistrer et tester
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const blank = (): Probe => ({ id: "", name: "", enabled: true, kind: defaultKind("Http"), server_id: null, interval_secs: 60, verify_tls: false });

export function Services() {
  const { servers } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [probes, setProbes] = useState<Probe[]>([]);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [editing, setEditing] = useState<Probe | null>(null);
  const [deleting, setDeleting] = useState<Probe | null>(null);

  useEffect(() => {
    invoke<Probe[]>("get_probes").then(setProbes).catch((e) => error(String(e)));
    invoke<ProbeResult[]>("get_probe_results").then((rs) => setResults(Object.fromEntries(rs.map((r) => [r.probe_id, r])))).catch(() => {});
    const un = listen<ProbeResult>("probe-result", (e) => setResults((prev) => ({ ...prev, [e.payload.probe_id]: e.payload })));
    return () => { un.then((f) => f()); };
  }, []);

  const suggestions = suggestProbes(servers, probes);

  async function save(p: Probe) {
    const saved = await invoke<Probe>("save_probe", { probe: p });
    setProbes((prev) => (prev.some((x) => x.id === saved.id) ? prev.map((x) => (x.id === saved.id ? saved : x)) : [...prev, saved]));
    setEditing(null);
  }

  async function addSuggestions() {
    for (const p of suggestions) {
      try { await save(p); } catch (e) { error(String(e)); }
    }
    success(`${suggestions.length} sonde(s) ajoutée(s)`);
  }

  const serverName = (id: string | null) => servers.find((s) => s.id === id)?.name;

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">Services</h1>
          <p className="text-text-secondary text-xs mt-0.5">Le service répond-il vraiment ? Sondes HTTP, ports et certificats — reliées aux alertes « Service injoignable »</p>
        </div>
        <div className="flex gap-2">
          {suggestions.length > 0 && (
            <button onClick={addSuggestions} className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover">
              <Sparkles size={14} /> Ajouter {suggestions.length} suggestion(s)
            </button>
          )}
          <button onClick={() => setEditing(blank())} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win">
            <Plus size={15} /> Nouvelle sonde
          </button>
        </div>
      </div>

      {probes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <Radar size={28} className="opacity-50" />
          Aucune sonde. {suggestions.length > 0 && "Les suggestions couvrent tes interfaces Proxmox et TrueNAS."}
        </div>
      ) : (
        <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
          {probes.map((p) => {
            const r = results[p.id];
            return (
              <div key={p.id} className={cn("flex items-center gap-4 px-4 py-3", !p.enabled && "opacity-50")}>
                <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", !r ? "bg-text-muted" : r.ok ? "bg-accent-success" : "bg-accent-error")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-primary truncate">
                    <span className="font-medium">{p.name}</span>
                    {serverName(p.server_id) && <span className="text-text-muted"> · {serverName(p.server_id)}</span>}
                  </p>
                  <p className="text-xs text-text-muted truncate">{describeProbe(p.kind)}</p>
                </div>
                <div className="text-right text-xs shrink-0 w-56">
                  {r ? (
                    <>
                      <p className={cn("truncate", r.ok ? "text-text-primary" : "text-accent-error")} title={r.detail}>
                        {p.kind.type === "TlsExpiry" && <Lock size={11} className="inline mr-1" />}{r.detail}
                      </p>
                      <p className="text-text-muted tabular-nums">
                        {r.latency_ms !== null && `${r.latency_ms} ms · `}dispo {r.uptime_percent.toFixed(r.uptime_percent === 100 ? 0 : 1)} %
                      </p>
                    </>
                  ) : <p className="text-text-muted">en attente…</p>}
                </div>
                <button onClick={() => invoke<ProbeResult>("run_probe_now", { id: p.id }).catch((e) => error(String(e)))} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10" title="Tester maintenant"><Play size={13} /></button>
                <button onClick={() => setEditing(p)} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover" title="Modifier"><Pencil size={13} /></button>
                <button onClick={() => setDeleting(p)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10" title="Supprimer"><Trash2 size={13} /></button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <ProbeForm initial={editing} onSubmit={save} onCancel={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Supprimer la sonde" message={`Supprimer « ${deleting.name} » ?`} confirmLabel="Supprimer" dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const p = deleting;
            setDeleting(null);
            invoke("delete_probe", { id: p.id }).then(() => setProbes((prev) => prev.filter((x) => x.id !== p.id))).catch((e) => error(String(e)));
          }}
        />
      )}
    </div>
  );
}
