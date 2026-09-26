import { useState, useEffect } from "react";
import { Heart, X } from "lucide-react";
import { useT } from "../i18n";
import { useNavigate } from "react-router-dom";
import { useStore } from "../stores/useStore";
import { useDraftStore } from "../stores/useDraftStore";

/**
 * Bannière d'invitation à soutenir le projet, affichée au maximum une fois par session.
 * Peut être masquée temporairement ("Plus tard") ou définitivement ("Ne plus afficher").
 */
export function SupportBanner() {
  const { t } = useT();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);
  const [showedOnce, setShowedOnce] = useState(false);

  // Initialize dismissed state from localStorage
  useEffect(() => {
    try {
      const isDismissed = localStorage.getItem("supportBanner.dismissed") === "true";
      setDismissed(isDismissed);
    } catch {
      // Si localStorage n'est pas disponible, continuer sans
    }
  }, []);

  // Afficher la bannière une seule fois par session, jamais au premier lancement
  // (onboarding en cours) : le réglage vient du backend, pas du localStorage
  const onboardingDone = useStore((s) => s.settings.general.onboarding_done);
  useEffect(() => {
    if (!onboardingDone || dismissed || showedOnce) return;
    const timer = setTimeout(() => setShowedOnce(true), 2000);
    return () => clearTimeout(timer);
  }, [onboardingDone, dismissed, showedOnce]);

  const handleNavigateToSupport = () => {
    // Paramètres lit sa section active via usePersistentState('settings.active')
    useDraftStore.getState().setDraft("settings.active", "coffee");
    navigate("/settings");
    setHiddenThisSession(true);
  };

  const handleDismissLater = () => {
    setHiddenThisSession(true);
  };

  const handleDismissPermanent = () => {
    try {
      localStorage.setItem("supportBanner.dismissed", "true");
    } catch {
      // Stockage indisponible : masquée pour cette session seulement
    }
    setDismissed(true);
    setHiddenThisSession(true);
  };

  // Ne pas afficher si :
  // - L'utilisateur a cliqué "Ne plus afficher"
  // - L'utilisateur a cliqué "Plus tard" cette session
  // - La bannière n'a pas encore été montrée
  if (dismissed || hiddenThisSession || !showedOnce) {
    return null;
  }

  return (
    <div role="status" className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Heart size={16} className="text-amber-600 shrink-0" />
        <p className="text-text-primary">
          <span className="font-medium">{t("supportBanner.title")}</span>
          <span className="text-text-secondary">
            {" "}· {t("supportBanner.description")}
          </span>
        </p>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleNavigateToSupport}
            className="px-3 py-1.5 rounded-win text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors"
          >
            {t("supportBanner.support")}
          </button>
          <button
            onClick={handleDismissLater}
            className="px-3 py-1.5 rounded-win text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            {t("supportBanner.later")}
          </button>
          <button
            onClick={handleDismissPermanent}
            title={t("supportBanner.neverAgain")}
            aria-label={t("supportBanner.neverAgain")}
            className="p-1 rounded-win text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
