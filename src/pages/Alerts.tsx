import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Pencil, Trash2, BellRing, Send, Monitor, Smartphone, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { AlertCondition, AlertRule, IntegrationView } from "../types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { CONDITION_LABELS, ConditionType, defaultCondition, describeCondition, newRule } from "../utils/alerts";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

function NumberField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="block">
      <span className="block text-xs text-text-secondary mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" min={0} className={inputClass} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
        <span className="text-xs text-text-muted shrink-0">{suffix}</span>
      </div>
    </label>
  );
}

function RuleForm({ initial, onSubmit, onCancel }: { initial: AlertRule; onSubmit: (r: AlertRule) => Promise<void>; onCancel: () => void }) {
  const { servers, groups } = useStore();
  const [rule, setRule] = useState<AlertRule>(initial);
  const [error, setError] = useState("");
  const set = <K extends keyof AlertRule>(k: K, v: AlertRule[K]) => setRule((r) => ({ ...r, [k]: v }));
  const setCond = (patch: Partial<AlertCondition>) => setRule((r) => ({ ...r, condition: { ...r.condition, ...patch } as AlertCondition }));
  const c = rule.condition;
  const targetValue = rule.target.kind === "All" ? "All" : `${rule.target.kind}:${rule.target.id}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">{initial.id ? "Modifier la règle" : "Nouvelle règle d'alerte"}</h2>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rule.name.trim()) return setError("Le nom est requis");
            try { await onSubmit(rule); } catch (err) { setError(String(err)); }
          }}
        >
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Nom</span>
            <input className={inputClass} value={rule.name} onChange={(e) => set("name", e.target.value)} placeholder="Serveur hors ligne" aria-label="Nom de la règle" />
          </label>
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">Condition</span>
            <select className={inputClass} value={c.type} onChange={(e) => set("condition", defaultCondition(e.target.value as ConditionType))} aria-label="Condition">
              {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((t) => <option key={t} value={t}>{CONDITION_LABELS[t]}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {"percent" in c && <NumberField label="Seuil" value={c.percent} onChange={(v) => setCond({ percent: v })} suffix="%" />}
            {"celsius" in c && <NumberField label="Seuil" value={c.celsius} onChange={(v) => setCond({ celsius: v })} suffix="°C" />}
            {"minutes" in c && <NumberField label="Durée" value={c.minutes} onChange={(v) => setCond({ minutes: v })} suffix="min" />}
          </div>
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">S'applique à</span>
            <select
              className={inputClass}
              value={targetValue}
              aria-label="Cible"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "All") set("target", { kind: "All" });
                else {
                  const [kind, id] = v.split(":") as ["Server" | "Group", string];
                  set("target", { kind, id });
                }
              }}
            >
              <option value="All">Tous les serveurs</option>
              {groups.length > 0 && <optgroup label="Groupes">{groups.map((g) => <option key={g.id} value={`Group:${g.id}`}>{g.name}</option>)}</optgroup>}
              <optgroup label="Serveurs">{servers.map((s) => <option key={s.id} value={`Server:${s.id}`}>{s.name}</option>)}</optgroup>
            </select>
          </label>
          <NumberField label="Délai minimal entre deux alertes" value={rule.cooldown_minutes} onChange={(v) => set("cooldown_minutes", v)} suffix="min" />
          <div className="flex gap-4 text-sm text-text-primary">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rule.notify_desktop} onChange={(e) => set("notify_desktop", e.target.checked)} className="accent-accent-primary" /> Notification Windows
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rule.notify_push} onChange={(e) => set("notify_push", e.target.checked)} className="accent-accent-primary" /> Push (téléphone)
            </label>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">Annuler</button>
            <button type="submit" className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium">Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Alerts() {
  const { servers, groups, events, settings } = useStore();
  const { toasts, removeToast, success, error } = useToast();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [channels, setChannels] = useState<IntegrationView[]>([]);
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [deleting, setDeleting] = useState<AlertRule | null>(null);

  useEffect(() => {
    invoke<AlertRule[]>("get_alert_rules").then(setRules).catch((e) => error(String(e)));
    invoke<IntegrationView[]>("get_integrations").then(setChannels).catch(() => {});
  }, []);

  const push = channels.filter((c) => ["Ntfy", "Discord", "Telegram"].includes(c.kind) && c.enabled && (c.url || c.has_secret));
  const recent = events.filter((e) => e.kind === "Alert").slice(0, 8);

  function targetLabel(r: AlertRule): string {
    const t = r.target;
    if (t.kind === "All") return "tous les serveurs";
    if (t.kind === "Group") return `groupe ${groups.find((g) => g.id === t.id)?.name ?? "supprimé"}`;
    return servers.find((s) => s.id === t.id)?.name ?? "serveur supprimé";
  }

  async function save(rule: AlertRule) {
    const saved = await invoke<AlertRule>("save_alert_rule", { rule });
    setRules((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved]));
    setEditing(null);
    success(`Règle « ${saved.name} » enregistrée`);
  }

  async function test() {
    try {
      await invoke("test_alert_channels");
      success(push.length ? `Test envoyé (Windows + ${push.map((c) => c.kind).join(", ")})` : "Test envoyé (Windows)");
    } catch (e) {
      error(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">Alertes</h1>
          <p className="text-text-secondary text-xs mt-0.5">Être prévenu quand quelque chose ne va pas, même fenêtre fermée (zone de notification)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={test} className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover">
            <Send size={14} /> Tester
          </button>
          <button onClick={() => setEditing(newRule())} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win">
            <Plus size={15} /> Nouvelle règle
          </button>
        </div>
      </div>

      {/* ── Canaux ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 bg-bg-tertiary border border-border-primary rounded-win p-3">
          <Monitor size={16} className={settings.general.notifications ? "text-accent-success" : "text-text-muted"} />
          <div className="text-sm">
            <p className="text-text-primary">Notifications Windows</p>
            <p className="text-xs text-text-muted">{settings.general.notifications ? "activées" : <>désactivées — <Link to="/settings" className="text-accent-primary hover:underline">Paramètres</Link></>}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-bg-tertiary border border-border-primary rounded-win p-3">
          <Smartphone size={16} className={push.length ? "text-accent-success" : "text-text-muted"} />
          <div className="text-sm">
            <p className="text-text-primary">Push téléphone</p>
            <p className="text-xs text-text-muted">
              {push.length ? push.map((c) => c.kind).join(", ") : <>aucun canal — configure ntfy, Discord ou Telegram dans <Link to="/settings" className="text-accent-primary hover:underline">Paramètres → Intégrations</Link></>}
            </p>
          </div>
        </div>
      </div>

      {/* ── Règles ─────────────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
        {rules.length === 0 && <p className="p-4 text-sm text-text-muted">Aucune règle.</p>}
        {rules.map((r) => (
          <div key={r.id} className={cn("flex items-center gap-4 px-4 py-3", !r.enabled && "opacity-50")}>
            <BellRing size={15} className="text-accent-warning shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate"><span className="font-medium">{r.name}</span><span className="text-text-secondary"> · {targetLabel(r)}</span></p>
              <p className="text-xs text-text-muted">
                {describeCondition(r.condition)} · {[r.notify_desktop && "Windows", r.notify_push && "push"].filter(Boolean).join(" + ") || "aucun canal"} · pause {r.cooldown_minutes} min
              </p>
            </div>
            <button
              onClick={() => save({ ...r, enabled: !r.enabled })}
              className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", r.enabled ? "bg-accent-primary" : "bg-bg-hover")}
              title={r.enabled ? "Désactiver" : "Activer"}
            >
              <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", r.enabled ? "left-[18px]" : "left-0.5")} />
            </button>
            <button onClick={() => setEditing(r)} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover" title="Modifier"><Pencil size={13} /></button>
            <button onClick={() => setDeleting(r)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10" title="Supprimer"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      {/* ── Dernières alertes ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-text-primary font-medium text-sm">Dernières alertes</h2>
        {recent.length === 0 ? (
          <p className="text-xs text-text-muted">Aucune alerte déclenchée pour l'instant.</p>
        ) : (
          <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary">
            {recent.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="font-medium text-text-primary">{e.target}</span>
                <span className="text-text-secondary flex-1 truncate">{e.message}</span>
                <span className="text-xs text-text-muted tabular-nums">{new Date(e.ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <RuleForm initial={editing} onSubmit={save} onCancel={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title="Supprimer la règle"
          message={`Supprimer « ${deleting.name} » ?`}
          confirmLabel="Supprimer"
          dangerous
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const r = deleting;
            setDeleting(null);
            invoke("delete_alert_rule", { id: r.id }).then(() => setRules((prev) => prev.filter((x) => x.id !== r.id))).catch((e) => error(String(e)));
          }}
        />
      )}
    </div>
  );
}
