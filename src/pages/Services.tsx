import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Pencil, Trash2, Play, Radar, Sparkles, X, Lock, Loader2, ShieldAlert, KeyRound, LayoutGrid, Search } from "lucide-react";
import { useStore } from "../stores/useStore";
import { Probe, ProbeKind, ProbeResult } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { authWarnings, describeProbe, suggestProbes } from "../utils/probes";
import { probeFromPreset, SERVICE_CATALOG, ServicePreset } from "../utils/serviceCatalog";
import { ProbeAuth } from "../types";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

function defaultKind(type: ProbeKind["type"]): ProbeKind {
  if (type === "Http") return { type, url: "https://", expect_status: null, keyword: null, json_path: null, json_expect: null };
  if (type === "Tcp") return { type, host: "", port: 22 };
  return { type, host: "", port: 443, warn_days: 14 };
}

function ProbeForm({ initial, help, onSubmit, onCancel }: { initial: Probe; help?: string; onSubmit: (p: Probe, secret: string | null) => Promise<void>; onCancel: () => void }) {
  const { servers } = useStore();
  const [p, setP] = useState<Probe>(initial);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Secret saisi : jamais pré-rempli (le backend ne le renvoie pas), vide = conserver l'actuel
  const [secret, setSecret] = useState("");
  const k = p.kind;
  const warnings = authWarnings(p);
  const setAuth = (type: ProbeAuth["type"]) =>
    setP((x) => ({ ...x, auth: type === "Basic" ? { type, username: "" } : type === "Header" ? { type, name: "X-Api-Key" } : { type } }));
  const setKind = (patch: Partial<ProbeKind>) => setP((x) => ({ ...x, kind: { ...x.kind, ...patch } as ProbeKind }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">{initial.id ? "Modifier la sonde" : "Nouvelle sonde"}</h2>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setSaving(true);
            // Aucune authentification : rien à envoyer ; sinon un secret saisi remplace l'ancien
            const s = p.auth.type === "None" || !secret ? null : secret;
            try { await onSubmit(p, s); setSecret(""); } catch (err) { setError(String(err)); } finally { setSaving(false); }
          }}
        >
          {help && <p className="text-xs text-accent-info bg-accent-info/10 rounded-win p-2">{help}</p>}
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
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="block text-xs text-text-secondary mb-1">Valeur JSON à lire (optionnel)</span>
                  <input className={inputClass} value={k.json_path ?? ""} onChange={(e) => setKind({ json_path: e.target.value || null })} placeholder="data.version" aria-label="Chemin JSON" />
                </label>
                <label className="block"><span className="block text-xs text-text-secondary mb-1">Valeur attendue (optionnel)</span>
                  <input className={inputClass} value={k.json_expect ?? ""} onChange={(e) => setKind({ json_expect: e.target.value || null })} placeholder="vide = afficher seulement" aria-label="Valeur attendue" disabled={!k.json_path} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
                <input type="checkbox" checked={p.verify_tls} onChange={(e) => setP({ ...p, verify_tls: e.target.checked })} className="accent-accent-primary" /> Vérifier le certificat (décocher si auto-signé)
              </label>

              <div className="border-t border-border-primary pt-3 space-y-3">
                <label className="block"><span className="flex items-center gap-1.5 text-xs text-text-secondary mb-1"><KeyRound size={12} /> Authentification</span>
                  <select className={inputClass} value={p.auth.type} onChange={(e) => setAuth(e.target.value as ProbeAuth["type"])} aria-label="Authentification">
                    <option value="None">Aucune</option>
                    <option value="Basic">Identifiant + mot de passe (Basic)</option>
                    <option value="Bearer">Jeton (Bearer)</option>
                    <option value="Header">En-tête personnalisé (clé d'API)</option>
                  </select>
                </label>
                {p.auth.type === "Basic" && (
                  <input className={inputClass} value={p.auth.username} onChange={(e) => setP({ ...p, auth: { type: "Basic", username: e.target.value } })} placeholder="Identifiant" aria-label="Identifiant" autoComplete="off" />
                )}
                {p.auth.type === "Header" && (
                  <input className={inputClass} value={p.auth.name} onChange={(e) => setP({ ...p, auth: { type: "Header", name: e.target.value } })} placeholder="Nom de l'en-tête (X-Api-Key)" aria-label="Nom de l'en-tête" autoComplete="off" />
                )}
                {p.auth.type !== "None" && (
                  <>
                    <input
                      type="password" className={inputClass} value={secret} onChange={(e) => setSecret(e.target.value)}
                      placeholder={p.has_secret ? "Secret enregistré (chiffré) — laisser vide pour le conserver" : p.auth.type === "Basic" ? "Mot de passe" : p.auth.type === "Bearer" ? "Jeton" : "Valeur de l'en-tête"}
                      aria-label="Secret" autoComplete="new-password" spellCheck={false}
                    />
                    <p className="flex items-center gap-1.5 text-[11px] text-text-muted"><Lock size={11} /> Chiffré avec la clé maître Windows, jamais réaffiché ni exporté.</p>
                  </>
                )}
                {warnings.map((w) => (
                  <p key={w} className="flex items-start gap-1.5 text-xs text-accent-warning"><ShieldAlert size={13} className="shrink-0 mt-0.5" /> {w}</p>
                ))}
              </div>
            </>
          )}
          {(k.type === "Tcp" || k.type === "TlsExpiry") && (
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <label className="block"><span className="block text-xs text-text-secondary mb-1">Hôte</span>
                <input className={inputClass} value={k.host} onChange={(e) => setKind({ host: e.target.value })} placeholder="192.168.1.10" aria-label="Hôte" />
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

const blank = (): Probe => ({ id: "", name: "", enabled: true, kind: defaultKind("Http"), server_id: null, interval_secs: 60, verify_tls: false, auth: { type: "None" } });

/** Catalogue de services courants : adresse du service, puis choix du modèle */
function CatalogPicker({ onPick, onCancel }: { onPick: (p: Probe, preset: ServicePreset) => void; onCancel: () => void }) {
  const { servers } = useStore();
  const [serverId, setServerId] = useState("");
  const [host, setHost] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = SERVICE_CATALOG.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));
  const categories = [...new Set(list.map((s) => s.category))];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">Ajouter un service</h2>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-3 gap-3 border-b border-border-primary">
          <select className={inputClass} value={serverId} onChange={(e) => { setServerId(e.target.value); setHost(servers.find((s) => s.id === e.target.value)?.ip ?? host); }} aria-label="Serveur hôte">
            <option value="">Serveur (optionnel)</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className={inputClass} value={host} onChange={(e) => setHost(e.target.value)} placeholder="Adresse (IP ou nom)" aria-label="Adresse du service" />
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input className={cn(inputClass, "pl-9")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher un service" />
          </div>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          <button onClick={() => onPick({ ...blank(), server_id: serverId || null, kind: { ...defaultKind("Http"), url: host ? `https://${host}/` : "https://" } as ProbeKind }, { id: "custom", name: "", category: "Applications", https: true, port: 443, path: "/", auth: { type: "None" }, help: "Service personnalisé : n'importe quelle URL, avec authentification et lecture d'une valeur JSON si besoin." })}
            className="w-full text-left p-3 rounded-win border border-dashed border-accent-primary/60 hover:bg-accent-primary/10">
            <span className="block text-sm text-text-primary font-medium">Service personnalisé</span>
            <span className="block text-xs text-text-muted">N'importe quelle URL : code HTTP, mot-clé, valeur JSON, authentification</span>
          </button>
          {categories.map((c) => (
            <div key={c}>
              <p className="text-xs font-medium text-text-secondary mb-2">{c}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {list.filter((s) => s.category === c).map((s) => (
                  <button key={s.id} onClick={() => onPick(probeFromPreset(s, host, serverId || null), s)} className="text-left p-3 rounded-win border border-border-primary hover:border-accent-primary hover:bg-bg-hover">
                    <span className="block text-sm text-text-primary">{s.name}</span>
                    <span className="flex items-center gap-1 text-[11px] text-text-muted">{s.auth.type !== "None" && <KeyRound size={10} />}port {s.port}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Services() {
  const { servers } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [probes, setProbes] = useState<Probe[]>([]);
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [editing, setEditing] = useState<Probe | null>(null);
  const [editingHelp, setEditingHelp] = useState<string | undefined>();
  const [picking, setPicking] = useState(false);
  const [deleting, setDeleting] = useState<Probe | null>(null);

  useEffect(() => {
    invoke<Probe[]>("get_probes").then(setProbes).catch((e) => error(String(e)));
    invoke<ProbeResult[]>("get_probe_results").then((rs) => setResults(Object.fromEntries(rs.map((r) => [r.probe_id, r])))).catch(() => {});
    const un = listen<ProbeResult>("probe-result", (e) => setResults((prev) => ({ ...prev, [e.payload.probe_id]: e.payload })));
    return () => { un.then((f) => f()); };
  }, []);

  const suggestions = suggestProbes(servers, probes);

  async function save(p: Probe, secret: string | null = null) {
    const saved = await invoke<Probe>("save_probe", { probe: p, secret });
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
          <button onClick={() => { setEditingHelp(undefined); setEditing(blank()); }} className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover">
            <Plus size={15} /> Sonde manuelle
          </button>
          <button onClick={() => setPicking(true)} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win">
            <LayoutGrid size={15} /> Ajouter un service
          </button>
        </div>
      </div>

      {probes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <Radar size={28} className="opacity-50" />
          Aucun service surveillé. « Ajouter un service » propose un catalogue (Home Assistant, Jellyfin, Pi-hole, Proxmox…) ou n'importe quelle URL.
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
                  <p className="text-xs text-text-muted truncate">{p.auth.type !== "None" && <KeyRound size={10} className="inline mr-1" />}{describeProbe(p.kind)}</p>
                </div>
                <div className="text-right text-xs shrink-0 w-56">
                  {r ? (
                    <>
                      <p className={cn("truncate", r.ok ? "text-text-primary" : "text-accent-error")} title={r.detail}>
                        {p.kind.type === "TlsExpiry" && <Lock size={11} className="inline mr-1" />}{r.detail}
                      </p>
                      <p className="text-text-muted tabular-nums">
                        {r.latency_ms !== null && `${r.latency_ms} ms · `}dispo 24 h {r.uptime_percent.toFixed(r.uptime_percent === 100 ? 0 : 1)} %
                      </p>
                    </>
                  ) : <p className="text-text-muted">en attente…</p>}
                </div>
                <button onClick={() => invoke<ProbeResult>("run_probe_now", { id: p.id }).catch((e) => error(String(e)))} className="p-1.5 rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10" title="Tester maintenant"><Play size={13} /></button>
                <button onClick={() => { setEditingHelp(undefined); setEditing(p); }} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover" title="Modifier"><Pencil size={13} /></button>
                <button onClick={() => setDeleting(p)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10" title="Supprimer"><Trash2 size={13} /></button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <ProbeForm initial={editing} help={editingHelp} onSubmit={save} onCancel={() => setEditing(null)} />}
      {picking && (
        <CatalogPicker
          onCancel={() => setPicking(false)}
          onPick={(p, preset) => { setPicking(false); setEditingHelp(preset.help); setEditing(p); }}
        />
      )}
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
