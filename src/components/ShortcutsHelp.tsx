import { Keyboard, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useShortcuts } from "../hooks/useShortcuts";
import { SHORTCUTS, ShortcutDef, shortcutKeys } from "../utils/shortcuts";
import { TKey, useT } from "../i18n";

/** Groupes dans l'ordre de première apparition dans la table */
function groups(): { name: TKey; items: ShortcutDef[] }[] {
  const out: { name: TKey; items: ShortcutDef[] }[] = [];
  for (const s of SHORTCUTS as readonly ShortcutDef[]) {
    const g = out.find((x) => x.name === s.groupKey);
    if (g) g.items.push(s);
    else out.push({ name: s.groupKey, items: [s] });
  }
  return out;
}

function Keys({ def }: { def: ShortcutDef }) {
  const { t } = useT();
  const steps = shortcutKeys(def);
  return (
    <span className="flex items-center gap-1 shrink-0">
      {steps.map((combo, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-[11px] text-text-muted">{t("shortcuts.then")}</span>}
          {combo.map((k, j) => (
            <span key={j} className="flex items-center gap-1">
              {j > 0 && <span className="text-[11px] text-text-muted">+</span>}
              <kbd className="min-w-[1.5rem] text-center text-[11px] text-text-primary bg-bg-secondary border border-border-primary rounded px-1.5 py-0.5 font-mono">{k}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

/**
 * Aide des raccourcis clavier (« ? »). Générée depuis la table SHORTCUTS, la même que
 * celle du gestionnaire clavier : elle ne peut pas diverger des raccourcis réels.
 */
export function ShortcutsHelp() {
  const { shortcutsHelpOpen: open, setShortcutsHelpOpen } = useStore();
  const { t } = useT();
  useShortcuts({ help: () => setShortcutsHelpOpen(!useStore.getState().shortcutsHelpOpen) });
  useShortcuts({ close: () => setShortcutsHelpOpen(false) }, open);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-toast flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShortcutsHelpOpen(false)} />
      <div role="dialog" aria-label={t("shortcuts.title")} className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-xl mx-4 max-h-[85vh] flex flex-col animate-slide-in">
        <div className="flex items-center justify-between p-5 border-b border-border-primary">
          <h2 className="flex items-center gap-2 text-text-primary font-semibold"><Keyboard size={16} /> {t("shortcuts.title")}</h2>
          <button onClick={() => setShortcutsHelpOpen(false)} className="text-text-secondary hover:text-text-primary" aria-label={t("shortcuts.closeHelp")}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-5 overflow-y-auto">
          {groups().map((g) => (
            <section key={g.name}>
              <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">{t(g.name)}</h3>
              <ul className="space-y-1.5">
                {g.items.map((s) => (
                  <li key={s.id} data-shortcut={s.id} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-text-primary">{t(s.descriptionKey)}</span>
                    <Keys def={s} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-[11px] text-text-muted">
            {t("shortcuts.note")}
          </p>
        </div>
      </div>
    </div>
  );
}
