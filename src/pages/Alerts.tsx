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
import { useT } from "../i18n";

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
  const { t } = useT();
  const { servers, groups } = useStore();
  const [rule, setRule] = useState<AlertRule>(initial);
  const [error, setError] = useState("");
  const set = <K extends keyof AlertRule>(k: K, v: AlertRule[K]) => setRule((r) => ({ ...r, [k]: v }));
  const setCond = (patch: Partial<AlertCondition>) => setRule((r) => ({ ...r, condition: { ...r.condition, ...patch } as AlertCondition }));
  const c = rule.condition;
  const targetValue = rule.target.kind === "All" ? "All" : `${rule.target.kind}:${rule.target.id}`;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold">{initial.id ? t("alerts.form.editTitle") : t("alerts.form.newTitle")}</h2>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary"><X size={18} /></button>
        </div>
        <form
          className="p-5 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!rule.name.trim()) return setError(t("alerts.form.nameRequired"));
            try { await onSubmit(rule); } catch (err) { setError(String(err)); }
          }}
        >
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">{t("alerts.form.name")}</span>
            <input className={inputClass} value={rule.name} onChange={(e) => set("name", e.target.value)} placeholder={t("alerts.form.namePlaceholder")} aria-label={t("alerts.form.nameAria")} />
          </label>
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">{t("alerts.form.condition")}</span>
            <select className={inputClass} value={c.type} onChange={(e) => set("condition", defaultCondition(e.target.value as ConditionType))} aria-label={t("alerts.form.condition")}>
              {(Object.keys(CONDITION_LABELS) as ConditionType[]).map((type) => <option key={type} value={type}>{t(CONDITION_LABELS[type])}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {"percent" in c && <NumberField label={t("alerts.form.threshold")} value={c.percent} onChange={(v) => setCond({ percent: v })} suffix="%" />}
            {"celsius" in c && <NumberField label={t("alerts.form.threshold")} value={c.celsius} onChange={(v) => setCond({ celsius: v })} suffix="°C" />}
            {"minutes" in c && <NumberField label={t("alerts.form.duration")} value={c.minutes} onChange={(v) => setCond({ minutes: v })} suffix="min" />}
          </div>
          <label className="block">
            <span className="block text-xs text-text-secondary mb-1">{t("alerts.form.appliesTo")}</span>
            <select
              className={inputClass}
              value={targetValue}
              aria-label={t("alerts.form.targetAria")}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "All") set("target", { kind: "All" });
                else {
                  const [kind, id] = v.split(":") as ["Server" | "Group", string];
                  set("target", { kind, id });
                }
              }}
            >
              <option value="All">{t("alerts.form.allServers")}</option>
              {groups.length > 0 && <optgroup label={t("alerts.form.groups")}>{groups.map((g) => <option key={g.id} value={`Group:${g.id}`}>{g.name}</option>)}</optgroup>}
              <optgroup label={t("alerts.form.servers")}>{servers.map((s) => <option key={s.id} value={`Server:${s.id}`}>{s.name}</option>)}</optgroup>
            </select>
          </label>
          <NumberField label={t("alerts.form.cooldown")} value={rule.cooldown_minutes} onChange={(v) => set("cooldown_minutes", v)} suffix="min" />
          <div className="flex gap-4 text-sm text-text-primary">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rule.notify_desktop} onChange={(e) => set("notify_desktop", e.target.checked)} className="accent-accent-primary" /> {t("alerts.form.notifyDesktop")}
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={rule.notify_push} onChange={(e) => set("notify_push", e.target.checked)} className="accent-accent-primary" /> {t("alerts.form.notifyPush")}
            </label>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button type="button" onClick={onCancel} className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">{t("common.cancel")}</button>
            <button type="submit" className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium">{t("alerts.form.save")}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Alerts() {
  const { t, locale } = useT();
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
    const target = r.target;
    if (target.kind === "All") return t("alerts.targetAll");
    if (target.kind === "Group") {
      const name = groups.find((g) => g.id === target.id)?.name;
      return name !== undefined ? t("alerts.targetGroup", { name }) : t("alerts.targetGroupDeleted");
    }
    return servers.find((s) => s.id === target.id)?.name ?? t("alerts.targetServerDeleted");
  }

  async function save(rule: AlertRule) {
    const saved = await invoke<AlertRule>("save_alert_rule", { rule });
    setRules((prev) => (prev.some((r) => r.id === saved.id) ? prev.map((r) => (r.id === saved.id ? saved : r)) : [...prev, saved]));
    setEditing(null);
    success(t("alerts.saved", { name: saved.name }));
  }

  async function test() {
    try {
      await invoke("test_alert_channels");
      success(push.length ? t("alerts.testSentWith", { channels: push.map((c) => c.kind).join(", ") }) : t("alerts.testSent"));
    } catch (e) {
      error(String(e));
    }
  }

  return (
    <div className="p-6 space-y-6">
      <ToastContainer toasts={toasts} onClose={removeToast} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("alerts.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">{t("alerts.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={test} className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover">
            <Send size={14} /> {t("alerts.test")}
          </button>
          <button onClick={() => setEditing(newRule())} className="flex items-center gap-2 px-4 py-2 text-sm bg-accent-primary hover:bg-accent-secondary text-white rounded-win">
            <Plus size={15} /> {t("alerts.newRule")}
          </button>
        </div>
      </div>

      {/* ── Canaux ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 bg-bg-tertiary border border-border-primary rounded-win p-3">
          <Monitor size={16} className={settings.general.notifications ? "text-accent-success" : "text-text-muted"} />
          <div className="text-sm">
            <p className="text-text-primary">{t("alerts.channels.desktop")}</p>
            <p className="text-xs text-text-muted">{settings.general.notifications ? t("alerts.channels.desktopOn") : <>{t("alerts.channels.desktopOff")} — <Link to="/settings" className="text-accent-primary hover:underline">{t("alerts.channels.settings")}</Link></>}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-bg-tertiary border border-border-primary rounded-win p-3">
          <Smartphone size={16} className={push.length ? "text-accent-success" : "text-text-muted"} />
          <div className="text-sm">
            <p className="text-text-primary">{t("alerts.channels.push")}</p>
            <p className="text-xs text-text-muted">
              {push.length ? push.map((c) => c.kind).join(", ") : <>{t("alerts.channels.pushNone")} <Link to="/settings" className="text-accent-primary hover:underline">{t("alerts.channels.settingsIntegrations")}</Link></>}
            </p>
          </div>
        </div>
      </div>

      {/* ── Règles ─────────────────────────────────────────────────────── */}
      <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary overflow-hidden">
        {rules.length === 0 && <p className="p-4 text-sm text-text-muted">{t("alerts.noRules")}</p>}
        {rules.map((r) => (
          <div key={r.id} className={cn("flex items-center gap-4 px-4 py-3", !r.enabled && "opacity-50")}>
            <BellRing size={15} className="text-accent-warning shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text-primary truncate"><span className="font-medium">{r.name}</span><span className="text-text-secondary"> · {targetLabel(r)}</span></p>
              <p className="text-xs text-text-muted">
                {describeCondition(r.condition)} · {[r.notify_desktop && "Windows", r.notify_push && t("alerts.channelPush")].filter(Boolean).join(" + ") || t("alerts.noChannel")} · {t("alerts.cooldown", { minutes: r.cooldown_minutes })}
              </p>
            </div>
            <button
              onClick={() => save({ ...r, enabled: !r.enabled })}
              className={cn("relative w-9 h-5 rounded-full transition-colors shrink-0", r.enabled ? "bg-accent-primary" : "bg-bg-hover")}
              title={r.enabled ? t("alerts.disable") : t("alerts.enable")}
            >
              <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", r.enabled ? "left-[18px]" : "left-0.5")} />
            </button>
            <button onClick={() => setEditing(r)} className="p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover" title={t("common.edit")}><Pencil size={13} /></button>
            <button onClick={() => setDeleting(r)} className="p-1.5 rounded text-text-secondary hover:text-red-400 hover:bg-red-400/10" title={t("common.delete")}><Trash2 size={13} /></button>
          </div>
        ))}
      </div>

      {/* ── Dernières alertes ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <h2 className="text-text-primary font-medium text-sm">{t("alerts.recentTitle")}</h2>
        {recent.length === 0 ? (
          <p className="text-xs text-text-muted">{t("alerts.noRecent")}</p>
        ) : (
          <div className="bg-bg-tertiary border border-border-primary rounded-win divide-y divide-border-secondary">
            {recent.map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="font-medium text-text-primary">{e.target}</span>
                <span className="text-text-secondary flex-1 truncate">{e.message}</span>
                <span className="text-xs text-text-muted tabular-nums">{new Date(e.ts).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && <RuleForm initial={editing} onSubmit={save} onCancel={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={t("alerts.deleteTitle")}
          message={t("alerts.deleteMessage", { name: deleting.name })}
          confirmLabel={t("common.delete")}
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
