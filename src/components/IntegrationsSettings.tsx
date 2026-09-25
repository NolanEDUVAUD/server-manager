import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Loader2, CheckCircle2, XCircle, KeyRound } from "lucide-react";
import { IntegrationKind, IntegrationView } from "../types";
import { INTEGRATIONS, IntegrationSpec } from "../utils/integrations";
import { cn } from "../utils";

const inputClass =
  "w-full bg-bg-input border border-border-primary rounded-win px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-primary";

type TestState = { running: boolean; ok?: boolean; message?: string };

function IntegrationCard({ spec, view, onSaved }: {
  spec: IntegrationSpec;
  view?: IntegrationView;
  onSaved: (v: IntegrationView) => void;
}) {
  const f = spec.fields;
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(view?.enabled ?? true);
  const [url, setUrl] = useState(view?.url ?? "");
  const [username, setUsername] = useState(view?.username ?? "");
  // Vide = secret inchangé (il n'est jamais renvoyé par le backend)
  const [secret, setSecret] = useState("");
  const [verifyTls, setVerifyTls] = useState(view?.verify_tls ?? false);
  const [extra, setExtra] = useState<Record<string, string>>(view?.extra ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [test, setTest] = useState<TestState>({ running: false });

  const configured = !!view && (!!view.url || view.has_secret);

  async function save(): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const saved = await invoke<IntegrationView>("save_integration", {
        payload: { kind: spec.kind, enabled, url, username, secret: secret ? secret : null, verify_tls: verifyTls, extra },
      });
      setSecret("");
      onSaved(saved);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndTest() {
    if (!(await save())) return;
    setTest({ running: true });
    try {
      const message = await invoke<string>("test_integration", { kind: spec.kind });
      setTest({ running: false, ok: true, message });
    } catch (e) {
      setTest({ running: false, ok: false, message: String(e) });
    }
  }

  return (
    <div className="bg-bg-tertiary border border-border-primary rounded-win">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className={cn("w-2 h-2 rounded-full shrink-0", configured && view?.enabled ? "bg-accent-success" : "bg-text-muted")} />
        <span className="text-sm text-text-primary flex-1">{spec.name}</span>
        {view?.has_secret && <KeyRound size={12} className="text-text-muted" aria-label="Secret enregistré" />}
        <span className="text-xs text-text-muted">{configured ? (view?.enabled ? "configuré" : "désactivé") : "non configuré"}</span>
        <ChevronDown size={14} className={cn("text-text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border-secondary pt-3">
          <p className="text-xs text-text-muted">{f.help}</p>
          {f.url && (
            <label className="block">
              <span className="block text-xs text-text-secondary mb-1">{f.url.label}</span>
              <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={f.url.placeholder} aria-label={f.url.label} />
            </label>
          )}
          {f.username && (
            <label className="block">
              <span className="block text-xs text-text-secondary mb-1">{f.username.label}</span>
              <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} placeholder={f.username.placeholder} aria-label={f.username.label} />
            </label>
          )}
          {f.secret && (
            <label className="block">
              <span className="block text-xs text-text-secondary mb-1">
                {f.secret.label}{view?.has_secret && " (laisser vide = inchangé)"}
              </span>
              <input type="password" className={inputClass} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={view?.has_secret ? "••••••••" : f.secret.placeholder} aria-label={f.secret.label} autoComplete="off" />
            </label>
          )}
          {f.extra?.map((x) => (
            <label key={x.key} className="block">
              <span className="block text-xs text-text-secondary mb-1">{x.label}</span>
              <input className={inputClass} value={extra[x.key] ?? ""} onChange={(e) => setExtra((prev) => ({ ...prev, [x.key]: e.target.value }))} placeholder={x.placeholder} aria-label={x.label} />
            </label>
          ))}
          <div className="flex items-center gap-4 text-xs text-text-secondary">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-accent-primary" />
              Activée
            </label>
            {f.tls && (
              <label className="flex items-center gap-2 cursor-pointer" title="Décocher pour un certificat auto-signé">
                <input type="checkbox" checked={verifyTls} onChange={(e) => setVerifyTls(e.target.checked)} className="accent-accent-primary" />
                Vérifier le certificat TLS
              </label>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
          {test.message && (
            <p className={cn("flex items-start gap-1.5 text-xs", test.ok ? "text-accent-success" : "text-accent-error")}>
              {test.ok ? <CheckCircle2 size={13} className="shrink-0 mt-px" /> : <XCircle size={13} className="shrink-0 mt-px" />}
              <span className="break-words min-w-0">{test.message}</span>
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-50">
              Enregistrer
            </button>
            <button onClick={saveAndTest} disabled={saving || test.running} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-win bg-accent-primary text-white hover:bg-accent-secondary disabled:opacity-50">
              {test.running && <Loader2 size={12} className="animate-spin" />}
              Enregistrer et tester
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function IntegrationsSettings() {
  const [views, setViews] = useState<IntegrationView[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<IntegrationView[]>("get_integrations").then(setViews).catch((e) => setError(String(e)));
  }, []);

  function onSaved(v: IntegrationView) {
    setViews((prev) => [...prev.filter((x) => x.kind !== v.kind), v]);
  }

  const categories = ["Notifications", "Supervision", "Infrastructure"] as const;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-text-primary font-medium text-base">Intégrations</h2>
        <p className="text-text-muted text-xs mt-1">Services externes utilisés par l'app. Les secrets sont chiffrés avec la clé maître (Gestionnaire d'identification Windows).</p>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {categories.map((cat) => (
        <div key={cat} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{cat}</p>
          {INTEGRATIONS.filter((s) => s.category === cat).map((spec) => (
            <IntegrationCard
              key={`${spec.kind}-${views.find((v) => v.kind === spec.kind) ? "set" : "new"}`}
              spec={spec}
              view={views.find((v) => v.kind === spec.kind as IntegrationKind)}
              onSaved={onSaved}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
