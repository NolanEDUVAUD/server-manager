import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Sparkles, X } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useTourStore } from "../stores/useTourStore";
import { getChangesBetween } from "../utils/changelog";
import { useT } from "../i18n";
import { cn } from "../utils";

const LAST_SEEN_VERSION_KEY = "spm.lastSeenVersion";

/**
 * Affiche les modifications depuis la dernière version utilisée.
 * Montée en permanence mais affichée seulement si :
 * - onboarding_done === true
 * - version actuelle > version stockée
 * - aucun autre écran de premier lancement (EULA, choix des modules, tutoriel) n'est ouvert
 */
export function WhatsNewModal() {
  const { settings } = useStore();
  const { t, lang } = useT();
  const openTour = useTourStore((s) => s.open);
  const tourOpen = useTourStore((s) => s.isOpen);
  const [visible, setVisible] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("");
  const [lastSeenVersion, setLastSeenVersion] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  const firstLaunch = !settings.general.onboarding_done;

  // Lecture de la version actuelle et de la dernière vue
  useEffect(() => {
    let alive = true;
    async function init() {
      try {
        const version = await getVersion();
        if (!alive) return;

        // Récupérer la version vue en dernier
        let last: string | undefined;
        try {
          const stored = localStorage.getItem(LAST_SEEN_VERSION_KEY);
          last = stored ? stored : undefined;
        } catch {
          last = undefined;
        }

        setCurrentVersion(version);
        setLastSeenVersion(last);

        // Déterminer si on doit afficher le modal
        if (!settings.general.onboarding_done) {
          // Première installation : juste stocker la version
          if (!last) {
            try {
              localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
            } catch {}
          }
          setIsLoading(false);
          return;
        }

        // onboarding_done === true
        if (!last) {
          // Première fois après onboarding : stocker et ne pas afficher
          try {
            localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
          } catch {}
          setIsLoading(false);
          return;
        }

        // Comparer les versions : afficher si la version actuelle est plus neuve
        const changes = getChangesBetween(last, version);
        if (changes.length > 0) {
          setVisible(true);
        } else {
          // Pas de changement, mettre à jour le stockage silencieusement
          try {
            localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
          } catch {}
        }
        setIsLoading(false);
      } catch (e) {
        console.warn("WhatsNewModal init error:", e);
        setIsLoading(false);
      }
    }

    init();
    return () => { alive = false; };
  }, [settings.general.onboarding_done]);

  // Ne jamais se superposer à l'EULA, au choix des modules ou au tutoriel : ce sont des
  // écrans bloquants qui doivent chacun rester seuls à l'écran.
  if (isLoading || !visible || !currentVersion || !lastSeenVersion || firstLaunch || tourOpen) {
    return null;
  }

  const changes = getChangesBetween(lastSeenVersion, currentVersion);
  const language = lang === "fr" ? "fr" : "en";

  const handleClose = () => {
    try {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, currentVersion);
    } catch {}
    setVisible(false);
  };

  const discover = (tourStep: string) => {
    handleClose();
    openTour([tourStep]);
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="p-6 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-text-primary font-semibold text-lg flex items-center gap-2">
            <Sparkles size={18} className="text-accent-primary" />
            {t("whatsNew.title", { version: changes[0]?.version ?? currentVersion })}
          </h2>
          <button
            onClick={handleClose}
            title={t("whatsNew.close")}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {changes.map((entry, entryIdx) => (
            <div key={entry.version} className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-text-primary font-medium text-sm">
                  v{entry.version} — {entry.date}
                </h3>
                {entryIdx === 0 && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-accent-primary/15 text-accent-primary">
                    {t("whatsNew.newBadge")}
                  </span>
                )}
              </div>
              <ul className="space-y-1.5 text-sm text-text-secondary">
                {entry.items.map((item, idx) => (
                  <li key={idx} className="flex items-start justify-between gap-3 ml-2">
                    <span className="flex gap-2">
                      <span className="text-accent-primary shrink-0">•</span>
                      <span>{item[language]}</span>
                    </span>
                    {item.tourStep && (
                      <button
                        onClick={() => discover(item.tourStep as string)}
                        className={cn(
                          "shrink-0 px-2 py-0.5 text-xs rounded-win border border-border-primary text-text-secondary",
                          "hover:text-accent-primary hover:border-accent-primary transition-colors"
                        )}
                      >
                        {t("whatsNew.discover")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-border-primary flex items-center justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
          >
            {t("whatsNew.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
