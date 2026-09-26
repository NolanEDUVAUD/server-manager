import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Server } from "lucide-react";
import { useTourStore } from "../stores/useTourStore";
import { useT } from "../i18n";
import { cn } from "../utils";

const TOUR_STEPS = [
  "welcome",
  "serversAndGroups",
  "dashboard",
  "ssh",
  "batch",
  "network",
  "customization",
  "settings",
] as const;

type TourStep = (typeof TOUR_STEPS)[number];

/**
 * Modal tour de présentation (indépendant de l'onboarding).
 * Peut être ouvert/fermé via useTourStore.
 */
export function TourModal() {
  const isOpen = useTourStore((s) => s.isOpen);
  const close = useTourStore((s) => s.close);
  const { t } = useT();

  // État interne du tour (quelle étape affichée)
  const [currentStep, setCurrentStep] = useState<number>(0);

  const step = TOUR_STEPS[currentStep];

  const nextStep = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    close();
  };

  if (!isOpen) return null;

  const stepToTitleKey: Record<TourStep, any> = {
    welcome: t("tour.welcome.title"),
    serversAndGroups: t("tour.serversAndGroups.title"),
    dashboard: t("tour.dashboard.title"),
    ssh: t("tour.ssh.title"),
    batch: t("tour.batch.title"),
    network: t("tour.network.title"),
    customization: t("tour.customization.title"),
    settings: t("tour.settings.title"),
  };

  const stepToTextKey: Record<TourStep, any> = {
    welcome: t("tour.welcome.text"),
    serversAndGroups: t("tour.serversAndGroups.text"),
    dashboard: t("tour.dashboard.text"),
    ssh: t("tour.ssh.text"),
    batch: t("tour.batch.text"),
    network: t("tour.network.text"),
    customization: t("tour.customization.text"),
    settings: t("tour.settings.text"),
  };

  const title = stepToTitleKey[step];
  const text = stepToTextKey[step];

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col animate-slide-in">
        <div className="p-6 border-b border-border-primary space-y-4">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-win bg-accent-primary/15 shrink-0">
              <Server size={24} className="text-accent-primary" />
            </div>
            <div className="flex-1">
              <h2 className="text-text-primary font-semibold text-lg mb-2">
                {title}
              </h2>
              <p className="text-sm text-text-secondary">
                {text}
              </p>
            </div>
          </div>

          {/* Dots indicateurs */}
          <div className="flex gap-1 items-center justify-center">
            {TOUR_STEPS.map((s, idx) => (
              <div
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-200",
                  idx === currentStep ? "bg-accent-primary w-6" : "bg-border-primary w-1.5"
                )}
              />
            ))}
          </div>
        </div>

        <div className="p-6 border-t border-border-primary flex items-center justify-between">
          <div className="text-xs text-text-muted">
            {currentStep + 1} / {TOUR_STEPS.length}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover"
            >
              {t("tour.skip")}
            </button>
            {currentStep > 0 && (
              <button
                onClick={prevStep}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover"
              >
                <ChevronLeft size={16} />
                {t("tour.prev")}
              </button>
            )}
            {currentStep < TOUR_STEPS.length - 1 && (
              <button
                onClick={nextStep}
                className="flex items-center gap-2 px-3 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
              >
                {t("tour.next")}
                <ChevronRight size={16} />
              </button>
            )}
            {currentStep === TOUR_STEPS.length - 1 && (
              <button
                onClick={handleClose}
                className="px-5 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
              >
                {t("tour.done")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
