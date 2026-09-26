import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";

interface InfoPopoverProps {
  /** Texte lu par les lecteurs d'écran et affiché comme title natif au survol */
  label: string;
  /** Contenu explicatif, affiché dans la bulle à l'activation */
  children: React.ReactNode;
}

/** Petite icône « (?) » : au clic (ou au clavier), une bulle affiche un texte d'aide. */
export function InfoPopover({ label, children }: InfoPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        className="text-text-muted hover:text-accent-primary transition-colors"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-dropdown left-0 top-full mt-1.5 w-72 max-w-[80vw] rounded-win border border-border-primary bg-bg-tertiary shadow-win-hover p-3 text-xs text-text-secondary leading-relaxed whitespace-pre-line"
        >
          {children}
        </div>
      )}
    </span>
  );
}
