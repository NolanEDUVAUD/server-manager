import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Server, ShieldCheck } from "lucide-react";
import { useStore } from "../stores/useStore";
import { useTourStore } from "../stores/useTourStore";
import { MODULES, hiddenExcept } from "../utils/modules";
import { cn } from "../utils";
import { useT } from "../i18n";

/** Premier lancement : choix des modules affichés, puis ajout du premier serveur */
export function Onboarding() {
  const { settings, servers, updateGeneral } = useStore();
  const openTour = useTourStore((s) => s.open);
  const navigate = useNavigate();
  const { t } = useT();
  const [selected, setSelected] = useState<string[]>(MODULES.filter((m) => m.essential).map((m) => m.key));
  const [error, setError] = useState("");

  // Ouvrir automatiquement le tour au premier lancement (avant tout return : règle des hooks)
  const firstLaunch = !settings.general.onboarding_done;
  useEffect(() => {
    if (firstLaunch) openTour();
  }, [firstLaunch, openTour]);

  if (!firstLaunch) return null;

  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  async function finish() {
    try {
      await updateGeneral({ hidden_modules: hiddenExcept(selected), onboarding_done: true });
      if (servers.length === 0) navigate("/servers");
    } catch (e) {
      setError(String(e));
    }
  }

  // Mode sélection des modules
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="p-6 border-b border-border-primary space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-win bg-accent-primary/15"><Server size={20} className="text-accent-primary" /></div>
            <h2 className="text-text-primary font-semibold text-lg">{t("onboarding.welcome")}</h2>
          </div>
          <p className="text-sm text-text-secondary">
            {t("onboarding.intro")}
          </p>
        </div>
        <div className="p-6 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2">
          {MODULES.map((m) => (
            <label key={m.key} className={cn("flex gap-3 p-3 rounded-win border cursor-pointer transition-colors", selected.includes(m.key) ? "border-accent-primary bg-accent-primary/10" : "border-border-primary hover:bg-bg-hover")}>
              <input type="checkbox" checked={selected.includes(m.key)} onChange={() => toggle(m.key)} className="accent-accent-primary mt-0.5" />
              <span>
                <span className="block text-sm text-text-primary">{m.label}</span>
                <span className="block text-xs text-text-muted">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="p-6 border-t border-border-primary flex items-center gap-3">
          <p className="flex items-center gap-2 text-xs text-text-muted flex-1">
            <ShieldCheck size={14} className="text-accent-success shrink-0" />
            {t("onboarding.security")}
          </p>
          {error && <p className="text-xs text-accent-error">{error}</p>}
          <button onClick={() => setSelected(MODULES.map((m) => m.key))} className="px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover">{t("onboarding.all")}</button>
          <button onClick={finish} className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium">{t("onboarding.start")}</button>
        </div>
      </div>
    </div>
  );
}
