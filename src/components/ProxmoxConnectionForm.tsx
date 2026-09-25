import { useState } from "react";
import { X, Network, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { ProxmoxConnection, ProxmoxConnectionPayload } from "../types";
import { useStore } from "../stores/useStore";

interface ProxmoxConnectionFormProps {
  connection: ProxmoxConnection | null;
  onClose: () => void;
  onMessage: (msg: string, type?: "success" | "error" | "info") => void;
}

export function ProxmoxConnectionForm({ connection, onClose, onMessage }: ProxmoxConnectionFormProps) {
  const { addProxmoxConnection, updateProxmoxConnection, testProxmoxConnection } = useStore();
  const [form, setForm] = useState<ProxmoxConnectionPayload>({
    name: connection?.name ?? "",
    api_url: connection?.api_url ?? "https://",
    token_id: connection?.token_id ?? "",
    token_secret: "",
    verify_tls: connection?.verify_tls ?? false,
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [saving, setSaving] = useState(false);

  // En édition, le secret est laissé vide tant qu'on ne veut pas le changer (le
  // backend conserve alors l'ancien secret chiffré). `proxmox_test_connection`
  // n'a pas cette logique de fallback : il utilise tel quel le secret du payload.
  // Tester avec un secret vide échouerait donc toujours, même si la connexion
  // existante est valide — on désactive le bouton de test dans ce cas plutôt que
  // de laisser afficher un faux échec.
  const testDisabled = testing || (!!connection && !form.token_secret);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      await testProxmoxConnection(form);
      setTestResult("ok");
    } catch (e) {
      setTestResult("fail");
      onMessage(String(e), "error");
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (connection) {
        await updateProxmoxConnection(connection.id, form);
        onMessage("Connexion mise à jour", "success");
      } else {
        await addProxmoxConnection(form);
        onMessage("Connexion ajoutée", "success");
      }
      onClose();
    } catch (e) {
      onMessage(String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary placeholder-text-secondary/50 focus:outline-none focus:border-accent-primary transition-colors";
  const labelClass = "text-text-secondary text-xs block mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-accent-primary/10">
              <Network size={18} className="text-accent-primary" />
            </div>
            <h2 className="text-text-primary font-semibold">
              {connection ? "Modifier la connexion" : "Nouvelle connexion Proxmox"}
            </h2>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="space-y-3">
            <div>
              <label className={labelClass}>Nom</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="PVE1"
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>URL de l'API</label>
              <input
                value={form.api_url}
                onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
                placeholder="https://192.168.1.10:8006"
                required
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>Token ID</label>
              <input
                value={form.token_id}
                onChange={(e) => setForm((f) => ({ ...f, token_id: e.target.value }))}
                placeholder="root@pam!server-manager"
                required
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <label className={labelClass}>
                Secret {connection && "(laisser vide pour ne pas changer)"}
              </label>
              <input
                type="password"
                value={form.token_secret}
                onChange={(e) => setForm((f) => ({ ...f, token_secret: e.target.value }))}
                required={!connection}
                className={`${inputClass} font-mono`}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={form.verify_tls}
                onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
                className="accent-accent-primary"
              />
              Vérifier le certificat TLS
            </label>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testDisabled}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary rounded-win hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : null}
                Tester la connexion
              </button>
              {testResult === "ok" && <CheckCircle2 size={16} className="text-green-400" />}
              {testResult === "fail" && <XCircle size={16} className="text-red-400" />}
            </div>
            {connection && !form.token_secret && (
              <p className="text-xs text-text-secondary mt-1.5">
                Retape le secret pour tester la connexion
              </p>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50"
            >
              {saving ? "Sauvegarde..." : "Sauvegarder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
