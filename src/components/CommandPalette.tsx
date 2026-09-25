import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, TerminalSquare, Wifi, Zap, ArrowRight, Power, RotateCcw, Pencil, Keyboard } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useToast } from "../hooks/useToast";
import { useShortcuts } from "../hooks/useShortcuts";
import { fuzzyFilter } from "../utils/fuzzy";
import { createShortcutMatcher } from "../utils/shortcuts";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToastContainer } from "./Toast";
import { cn } from "../utils";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: typeof Search;
  /** Action qui agit sur le homelab : confirmée avant exécution, avec ce texte précis */
  confirm?: { message: string; label: string; dangerous?: boolean };
  run: () => void;
}

/** Touches de la liste de résultats, lues dans la table des raccourcis */
const PALETTE_KEYS = ["palette-next", "palette-prev", "palette-run"] as const;

/**
 * Palette Ctrl+K : navigation et actions rapides. Toute action qui modifie un serveur
 * (réveil, arrêt, redémarrage) passe par une confirmation qui dit exactement ce qui
 * va se passer : une faute de frappe ne peut jamais éteindre une machine.
 */
export function CommandPalette({ pages }: { pages: { to: string; label: string }[] }) {
  const navigate = useNavigate();
  const { servers, groups, openTerminal, pingServer, wakeGroup, wakeServer, shutdownServer, rebootServer, setShortcutsHelpOpen } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState<PaletteItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matchListKey = useMemo(() => createShortcutMatcher(PALETTE_KEYS), []);

  useShortcuts({ palette: () => setOpen((o) => !o) });
  useShortcuts({ close: () => setOpen(false) }, open);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  /** Exécute une action du store et en affiche le résultat */
  const report = (action: () => Promise<unknown>, ok: string) => () => {
    action().then(() => toast.success(ok)).catch((e) => toast.error(String(e)));
  };

  const items: PaletteItem[] = useMemo(() => [
    ...pages.map((p) => ({ id: `page:${p.to}`, label: `Aller à ${p.label}`, hint: "page", icon: ArrowRight, run: () => navigate(p.to) })),
    ...servers.flatMap((s): PaletteItem[] => [
      {
        id: `console:${s.id}`, label: `Ouvrir la console sur ${s.name}`, hint: s.ip, icon: TerminalSquare,
        run: () => { openTerminal(s.id); navigate("/console"); },
      },
      {
        id: `ping:${s.id}`, label: `Pinger ${s.name}`, hint: s.ip, icon: Wifi,
        run: () => {
          pingServer(s.id)
            .then((r) => (r.online ? toast.success(`${s.name} répond${r.latency_ms !== null ? ` (${r.latency_ms} ms)` : ""}`) : toast.warning(`${s.name} ne répond pas`)))
            .catch((e) => toast.error(String(e)));
        },
      },
      ...(s.mac_address
        ? [{
            id: `wake:${s.id}`, label: `Réveiller ${s.name}`, hint: "Wake-on-LAN", icon: Zap,
            confirm: { message: `Envoyer un paquet Wake-on-LAN à ${s.name} (MAC ${s.mac_address}) pour l'allumer ?`, label: "Réveiller" },
            run: report(() => wakeServer(s.id), `Paquet Wake-on-LAN envoyé à ${s.name}`),
          }]
        : []),
      {
        id: `shutdown:${s.id}`, label: `Arrêter ${s.name}`, hint: s.ip, icon: Power,
        confirm: { message: `${s.name} (${s.ip}) va être éteint via SSH.\nCommande exécutée : ${s.shutdown_command}`, label: "Arrêter", dangerous: true },
        run: report(() => shutdownServer(s.id), `Commande d'arrêt envoyée à ${s.name}`),
      },
      {
        id: `reboot:${s.id}`, label: `Redémarrer ${s.name}`, hint: s.ip, icon: RotateCcw,
        confirm: { message: `${s.name} (${s.ip}) va redémarrer via SSH.\nCommande exécutée : ${s.reboot_command}`, label: "Redémarrer", dangerous: true },
        run: report(() => rebootServer(s.id), `Commande de redémarrage envoyée à ${s.name}`),
      },
      {
        id: `edit:${s.id}`, label: `Modifier ${s.name}`, hint: s.ip, icon: Pencil,
        run: () => navigate("/servers", { state: { editServerId: s.id } }),
      },
    ]),
    ...groups.map((g) => ({
      id: `wol:${g.id}`, label: `Réveiller le groupe ${g.name}`, hint: "Wake-on-LAN", icon: Zap,
      confirm: { message: `Envoyer un Wake-on-LAN à tous les serveurs du groupe « ${g.name} » ?`, label: "Réveiller" },
      run: report(() => wakeGroup(g.id), `Wake-on-LAN envoyé au groupe ${g.name}`),
    })),
    { id: "help", label: "Afficher les raccourcis clavier", hint: "?", icon: Keyboard, run: () => setShortcutsHelpOpen(true) },
  ], [pages, servers, groups]);

  const results = fuzzyFilter(items, query, (i) => `${i.label} ${i.hint}`, 10);

  function choose(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    if (item.confirm) setPending(item);
    else item.run();
  }

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
                  const id = matchListKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, inEditable: true });
                  if (!id) return;
                  e.preventDefault();
                  if (id === "palette-next") setIndex((i) => Math.min(i + 1, results.length - 1));
                  else if (id === "palette-prev") setIndex((i) => Math.max(i - 1, 0));
                  else choose(results[index]);
                }}
                placeholder="Page, serveur, action…  (ex. « cons mini », « arr mini »)"
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
                    <Icon size={14} className={cn("shrink-0", r.confirm?.dangerous && "text-red-400")} />
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
      {pending?.confirm && (
        <ConfirmDialog
          title={pending.label}
          message={pending.confirm.message}
          confirmLabel={pending.confirm.label}
          dangerous={pending.confirm.dangerous}
          onCancel={() => setPending(null)}
          onConfirm={() => { pending.run(); setPending(null); }}
        />
      )}
      <ToastContainer toasts={toast.toasts} onClose={toast.removeToast} />
    </>
  );
}
