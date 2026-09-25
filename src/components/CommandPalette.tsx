import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, TerminalSquare, Wifi, Zap, ArrowRight } from "lucide-react";
import { useStore } from "../stores/useStore";
import { fuzzyFilter } from "../utils/fuzzy";
import { ConfirmDialog } from "./ConfirmDialog";
import { cn } from "../utils";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  /** Action à confirmer avant exécution (agit sur le homelab) */
  confirm?: string;
  run: () => void;
}

/**
 * Palette Ctrl+K : navigation et actions rapides. Volontairement sans arrêt ni
 * redémarrage : une faute de frappe ne doit jamais pouvoir éteindre une machine.
 */
export function CommandPalette({ pages }: { pages: { to: string; label: string }[] }) {
  const navigate = useNavigate();
  const { servers, groups, openTerminal, pingServer, wakeGroup } = useStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<PaletteItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const items: PaletteItem[] = useMemo(() => [
    ...pages.map((p) => ({ id: `page:${p.to}`, label: `Aller à ${p.label}`, hint: "page", icon: ArrowRight, run: () => navigate(p.to) })),
    ...servers.map((s) => ({
      id: `console:${s.id}`, label: `Console sur ${s.name}`, hint: s.ip, icon: TerminalSquare,
      run: () => { openTerminal(s.id); navigate("/console"); },
    })),
    ...servers.map((s) => ({ id: `ping:${s.id}`, label: `Pinger ${s.name}`, hint: s.ip, icon: Wifi, run: () => { pingServer(s.id).catch(() => {}); } })),
    ...groups.map((g) => ({
      id: `wol:${g.id}`, label: `Réveiller le groupe ${g.name}`, hint: "Wake-on-LAN", icon: Zap,
      confirm: `Envoyer un Wake-on-LAN à tous les serveurs du groupe « ${g.name} » ?`,
      run: () => { wakeGroup(g.id).catch(() => {}); },
    })),
  ], [pages, servers, groups]);

  const results = fuzzyFilter(items, query, (i) => `${i.label} ${i.hint}`, 10);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    if (item.confirm) setPending(item);
    else item.run();
  }

  if (!open && !pending) return null;

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[15vh]" onMouseDown={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-lg mx-4 bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover animate-fade-in" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 border-b border-border-primary">
              <Search size={15} className="text-text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
                  else if (e.key === "Enter") { e.preventDefault(); choose(results[index]); }
                }}
                placeholder="Page, serveur, action…  (ex. « cons mini », « rev lab »)"
                className="flex-1 bg-transparent py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                aria-label="Recherche de commande"
              />
              <kbd className="text-[10px] text-text-muted border border-border-primary rounded px-1.5 py-0.5">Échap</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.length === 0 && <li className="px-4 py-3 text-sm text-text-muted">Aucun résultat</li>}
              {results.map((r, i) => {
                const Icon = r.icon;
                return (
                  <li
                    key={r.id}
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => choose(r)}
                    className={cn("flex items-center gap-3 px-4 py-2 cursor-pointer text-sm", i === index ? "bg-accent-primary/15 text-text-primary" : "text-text-secondary")}
                  >
                    <Icon size={14} className="shrink-0" />
                    <span className="flex-1 truncate">{r.label}</span>
                    <span className="text-xs text-text-muted">{r.hint}</span>
                    {i === index && <CornerDownLeft size={12} className="text-text-muted" />}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title={pending.label}
          message={pending.confirm ?? ""}
          confirmLabel="Confirmer"
          onCancel={() => setPending(null)}
          onConfirm={() => { pending.run(); setPending(null); }}
        />
      )}
    </>
  );
}
