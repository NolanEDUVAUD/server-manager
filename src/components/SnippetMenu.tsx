import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScrollText, Plus, Trash2 } from "lucide-react";
import { Snippet } from "../types";

/**
 * Commandes mémorisées : insère la commande dans le terminal actif SANS l'exécuter
 * (pas de retour à la ligne) — l'utilisateur relit puis valide avec Entrée.
 */
export function SnippetMenu({ sessionId }: { sessionId: string | undefined }) {
  const [open, setOpen] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    invoke<Snippet[]>("get_snippets").then(setSnippets).catch((e) => setError(String(e)));
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function insert(s: Snippet) {
    if (!sessionId) return;
    invoke("terminal_write", { sessionId, data: s.command }).catch((e) => setError(String(e)));
    setOpen(false);
  }

  async function add() {
    try {
      const saved = await invoke<Snippet>("save_snippet", { snippet: { id: "", name, command } });
      setSnippets((p) => [...p, saved]);
      setName("");
      setCommand("");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={!sessionId}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded text-text-secondary hover:text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40"
        title={sessionId ? "Insérer une commande mémorisée (sans l'exécuter)" : "Ouvre une session pour utiliser les commandes"}
      >
        <ScrollText size={13} /> Commandes
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 z-20 bg-bg-tertiary border border-border-primary rounded-win shadow-win-hover animate-fade-in">
          <ul className="max-h-72 overflow-y-auto py-1">
            {snippets.map((s) => (
              <li key={s.id} className="group flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer" onClick={() => insert(s)}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{s.name}</p>
                  <p className="text-[11px] text-text-muted font-mono truncate">{s.command}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    invoke("delete_snippet", { id: s.id }).then(() => setSnippets((p) => p.filter((x) => x.id !== s.id)));
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-red-400"
                  title="Supprimer"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border-primary p-2 space-y-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom" aria-label="Nom de la commande" className="w-full bg-bg-input border border-border-primary rounded px-2 py-1 text-xs text-text-primary" />
            <div className="flex gap-1.5">
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="commande" aria-label="Commande" className="flex-1 bg-bg-input border border-border-primary rounded px-2 py-1 text-xs font-mono text-text-primary" />
              <button onClick={add} className="px-2 rounded bg-accent-primary text-white" title="Ajouter"><Plus size={12} /></button>
            </div>
            {error && <p className="text-[11px] text-red-400">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
