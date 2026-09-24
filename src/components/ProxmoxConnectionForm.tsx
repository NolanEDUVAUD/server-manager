import { useState } from "react";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-bg-secondary border border-border-primary rounded-win shadow-win p-6 w-full max-w-md space-y-4"
      >
        <h2 className="text-text-primary font-medium text-base">
          {connection ? "Modifier la connexion" : "Nouvelle connexion Proxmox"}
        </h2>

        <div className="space-y-3">
          <div>
            <label className="text-text-secondary text-xs block mb-1">Nom</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="PVE1"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">URL de l'API</label>
            <input
              value={form.api_url}
              onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))}
              placeholder="https://192.168.50.10:8006"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">Token ID</label>
            <input
              value={form.token_id}
              onChange={(e) => setForm((f) => ({ ...f, token_id: e.target.value }))}
              placeholder="root@pam!server-manager"
              required
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <div>
            <label className="text-text-secondary text-xs block mb-1">
              Secret {connection && "(laisser vide pour ne pas changer)"}
            </label>
            <input
              type="password"
              value={form.token_secret}
              onChange={(e) => setForm((f) => ({ ...f, token_secret: e.target.value }))}
              required={!connection}
              className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2 text-text-primary text-sm font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={form.verify_tls}
              onChange={(e) => setForm((f) => ({ ...f, verify_tls: e.target.checked }))}
            />
            Vérifier le certificat TLS
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary rounded-win hover:bg-bg-hover transition-colors"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : null}
            Tester la connexion
          </button>
          {testResult === "ok" && <CheckCircle2 size={16} className="text-green-400" />}
          {testResult === "fail" && <XCircle size={16} className="text-red-400" />}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors disabled:opacity-50"
          >
            {saving ? "Sauvegarde..." : "Sauvegarder"}
          </button>
        </div>
      </form>
    </div>
  );
}
