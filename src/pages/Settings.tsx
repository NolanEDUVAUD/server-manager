import { useState } from "react";
import { Save, Download, Upload, FolderOpen, Info } from "lucide-react";
import { useStore } from "../stores/useStore";
import { AppSettings } from "../types";
import { ToastContainer } from "../components/Toast";
import { useToast } from "../hooks/useToast";
import { invoke } from "@tauri-apps/api/core";

export function Settings() {
  const { settings, updateSettings, exportConfig, importConfig } = useStore();
  const toast = useToast();

  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [saving, setSaving] = useState(false);
  const [dataPath, setDataPath] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSettings(form);
      toast.success("Paramètres sauvegardés");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    try {
      const json = await exportConfig();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `server-manager-config-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Configuration exportée");
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const msg = await importConfig(text);
        toast.success(msg);
      } catch (e) {
        toast.error(String(e));
      }
    };
    input.click();
  }

  async function handleShowDataPath() {
    try {
      const path = await invoke<string>("get_data_path");
      setDataPath(path);
    } catch (e) {
      toast.error(String(e));
    }
  }

  const inputClass =
    "bg-win-surface border border-win-border rounded-win px-3 py-2 text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors";
  const labelClass = "block text-sm font-medium text-win-text mb-1";
  const hintClass = "text-xs text-win-muted mt-1";

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-win-text">Paramètres</h1>
        <p className="text-sm text-win-muted mt-0.5">Configuration de l'application</p>
      </div>

      {/* Paramètres de monitoring */}
      <form onSubmit={handleSave} className="bg-win-card border border-win-border rounded-win p-5 space-y-5">
        <h2 className="text-sm font-semibold text-win-text border-b border-win-border pb-3">
          Monitoring
        </h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Intervalle de ping (secondes)</label>
            <input
              type="number"
              className={inputClass}
              value={form.ping_interval_secs}
              onChange={(e) =>
                setForm((f) => ({ ...f, ping_interval_secs: parseInt(e.target.value) || 30 }))
              }
              min={5}
              max={3600}
            />
            <p className={hintClass}>Minimum : 5 s — Recommandé : 30 s</p>
          </div>

          <div>
            <label className={labelClass}>Timeout de ping (ms)</label>
            <input
              type="number"
              className={inputClass}
              value={form.ping_timeout_ms}
              onChange={(e) =>
                setForm((f) => ({ ...f, ping_timeout_ms: parseInt(e.target.value) || 2000 }))
              }
              min={500}
              max={30000}
            />
            <p className={hintClass}>Entre 500 et 30 000 ms</p>
          </div>
        </div>

        <div>
          <label className={labelClass}>Timeout SSH (secondes)</label>
          <input
            type="number"
            className={`${inputClass} w-40`}
            value={form.ssh_timeout_secs}
            onChange={(e) =>
              setForm((f) => ({ ...f, ssh_timeout_secs: parseInt(e.target.value) || 30 }))
            }
            min={5}
            max={120}
          />
          <p className={hintClass}>Timeout pour les connexions SSH (shutdown, reboot…)</p>
        </div>

        <div className="flex justify-end pt-2 border-t border-win-border">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm rounded-win bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "Sauvegarde…" : "Sauvegarder"}
          </button>
        </div>
      </form>

      {/* Import / Export */}
      <div className="bg-win-card border border-win-border rounded-win p-5 space-y-4">
        <h2 className="text-sm font-semibold text-win-text border-b border-win-border pb-3">
          Import / Export
        </h2>

        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-win border border-win-border text-win-muted hover:text-win-text hover:bg-win-hover transition-all"
          >
            <Download size={14} />
            Exporter la config
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-win border border-win-border text-win-muted hover:text-win-text hover:bg-win-hover transition-all"
          >
            <Upload size={14} />
            Importer une config
          </button>
        </div>

        <p className="text-xs text-win-muted">
          L'export ne contient pas les mots de passe SSH (pour des raisons de sécurité).
        </p>
      </div>

      {/* Informations */}
      <div className="bg-win-card border border-win-border rounded-win p-5 space-y-4">
        <h2 className="text-sm font-semibold text-win-text border-b border-win-border pb-3">
          À propos
        </h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-win-muted">Application</span>
            <span className="text-win-text font-medium">Server Power Manager</span>
          </div>
          <div className="flex justify-between">
            <span className="text-win-muted">Version</span>
            <span className="text-win-text">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-win-muted">Stack</span>
            <span className="text-win-text">Tauri v2 + React + Rust</span>
          </div>
          <div className="flex justify-between">
            <span className="text-win-muted">Chiffrement</span>
            <span className="text-win-text text-green-400">AES-256-GCM ✓</span>
          </div>
        </div>

        <div>
          <button
            onClick={handleShowDataPath}
            className="flex items-center gap-2 text-xs text-win-muted hover:text-win-text transition-colors"
          >
            <FolderOpen size={12} />
            Afficher le fichier de données
          </button>
          {dataPath && (
            <div className="mt-2 flex items-start gap-2 p-2 bg-win-surface rounded text-xs text-win-muted font-mono break-all">
              <Info size={12} className="shrink-0 mt-0.5" />
              {dataPath}
            </div>
          )}
        </div>
      </div>

      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </div>
  );
}
