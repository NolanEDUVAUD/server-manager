import { useState } from "react";
import { X, Layers } from "lucide-react";
import { Group, Server } from "../types";

interface GroupFormProps {
  initial?: Group;
  servers: Server[];
  onSubmit: (name: string, icon: string | undefined, serverIds: string[]) => Promise<void>;
  onCancel: () => void;
}

export function GroupForm({ initial, servers, onSubmit, onCancel }: GroupFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(initial?.server_ids ?? [])
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggleServer(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Le nom du groupe est requis");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(name.trim(), icon || undefined, Array.from(selectedIds));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-win-card border border-win-border rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-win-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-win-accent/10">
              <Layers size={18} className="text-win-accent" />
            </div>
            <h2 className="text-win-text font-semibold">
              {initial ? "Modifier le groupe" : "Créer un groupe"}
            </h2>
          </div>
          <button onClick={onCancel} className="text-win-muted hover:text-win-text transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Nom + Icône */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="block text-xs font-medium text-win-muted mb-1">Nom *</label>
              <input
                className="w-full bg-win-surface border border-win-border rounded-win px-3 py-2 text-sm text-win-text focus:outline-none focus:border-win-accent transition-colors"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="Cluster Proxmox"
              />
              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-win-muted mb-1">Icône</label>
              <input
                className="w-16 bg-win-surface border border-win-border rounded-win px-2 py-2 text-sm text-win-text text-center text-lg focus:outline-none focus:border-win-accent transition-colors"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🖥️"
                maxLength={2}
              />
            </div>
          </div>

          {/* Sélection des serveurs */}
          <div>
            <label className="block text-xs font-medium text-win-muted mb-2">
              Serveurs ({selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""})
            </label>
            {servers.length === 0 ? (
              <p className="text-win-muted text-xs italic py-3 text-center">
                Aucun serveur disponible — ajoutez-en d'abord dans l'onglet Serveurs
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {servers.map((s) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-win cursor-pointer transition-all
                      ${selectedIds.has(s.id)
                        ? "bg-win-accent/10 border border-win-accent/30"
                        : "border border-transparent hover:bg-win-hover"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleServer(s.id)}
                      className="accent-win-accent"
                    />
                    <span className="text-sm">{s.icon ?? "🖥️"}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-win-text truncate">{s.name}</p>
                      <p className="text-xs text-win-muted font-mono">{s.ip}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2 border-t border-win-border">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-win border border-win-border text-win-muted hover:text-win-text hover:bg-win-hover transition-all"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm rounded-win bg-win-accent hover:bg-win-accent-hover text-white font-medium transition-all disabled:opacity-50"
            >
              {submitting ? "Enregistrement…" : initial ? "Mettre à jour" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
