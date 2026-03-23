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
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-md mx-4 animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-primary">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-accent-primary/10">
              <Layers size={18} className="text-accent-primary" />
            </div>
            <h2 className="text-text-primary font-semibold">
              {initial ? "Modifier le groupe" : "Créer un groupe"}
            </h2>
          </div>
          <button onClick={onCancel} className="text-text-secondary hover:text-text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Nom + Icône */}
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Nom *</label>
              <input
                className="w-full bg-bg-secondary border border-border-primary rounded-win px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary transition-colors"
                value={name}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                placeholder="Cluster Proxmox"
              />
              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">Icône</label>
              <input
                className="w-16 bg-bg-secondary border border-border-primary rounded-win px-2 py-2 text-sm text-text-primary text-center text-lg focus:outline-none focus:border-accent-primary transition-colors"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🖥️"
                maxLength={2}
              />
            </div>
          </div>

          {/* Sélection des serveurs */}
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-2">
              Serveurs ({selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""})
            </label>
            {servers.length === 0 ? (
              <p className="text-text-secondary text-xs italic py-3 text-center">
                Aucun serveur disponible — ajoutez-en d'abord dans l'onglet Serveurs
              </p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {servers.map((s) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-3 px-3 py-2 rounded-win cursor-pointer transition-all
                      ${selectedIds.has(s.id)
                        ? "bg-accent-primary/10 border border-accent-primary/30"
                        : "border border-transparent hover:bg-bg-hover"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleServer(s.id)}
                      className="accent-accent-primary"
                    />
                    <span className="text-sm">{s.icon ?? "🖥️"}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-text-primary truncate">{s.name}</p>
                      <p className="text-xs text-text-secondary font-mono">{s.ip}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end pt-2 border-t border-border-primary">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-all"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium transition-all disabled:opacity-50"
            >
              {submitting ? "Enregistrement…" : initial ? "Mettre à jour" : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
