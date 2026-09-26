import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ChevronLeft, ChevronRight, Coffee, LifeBuoy, PackageSearch, TerminalSquare, X,
} from "lucide-react";
import { useTourStore } from "../stores/useTourStore";
import { useStore } from "../stores/useStore";
import { useT } from "../i18n";
import { cn } from "../utils";
import {
  CardPosition, computeCardPosition, filterStepsByIds, getVisibleSteps, prefersReducedMotion, TourStepDef,
} from "../utils/tour";

const CARD_WIDTH = 336;

/** Éléments focusables considérés pour le piège de focus du tutoriel */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Tutoriel interactif : met en évidence le vrai onglet de la barre latérale (coach-mark)
 * et affiche une carte avec titre, explication et mini-exemple animé.
 * Ouvert/fermé via useTourStore ; `onlyIds` restreint aux étapes d'un sous-ensemble
 * (utilisé par « Quoi de neuf ? » pour ne rejouer qu'une nouveauté).
 */
export function TourModal() {
  const isOpen = useTourStore((s) => s.isOpen);
  const onlyIds = useTourStore((s) => s.onlyIds);
  const close = useTourStore((s) => s.close);
  const { settings } = useStore();
  const { t } = useT();
  const navigate = useNavigate();
  const location = useLocation();

  const steps = useMemo(
    () => filterStepsByIds(getVisibleSteps(settings.general.hidden_modules ?? []), onlyIds),
    [settings.general.hidden_modules, onlyIds]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<CardPosition>({ placement: "center", top: 0, left: 0 });
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  const cardRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Réinitialise l'étape à chaque ouverture
  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  // Repli si l'étape courante dépasse la liste (ex. un module vient d'être masqué)
  const step: TourStepDef | undefined = steps[stepIndex];
  useEffect(() => {
    if (isOpen && steps.length > 0 && stepIndex >= steps.length) setStepIndex(steps.length - 1);
  }, [isOpen, steps.length, stepIndex]);

  // `prefers-reduced-motion` : suit un éventuel changement en cours de session
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Localise la cible réelle de l'étape (coach-mark) ; repositionné au redimensionnement,
  // au défilement de la barre latérale, et quand l'onglet visé n'existe pas (repli centré).
  useEffect(() => {
    if (!isOpen || !step) {
      setRect(null);
      return;
    }
    const locate = () => {
      const el = step.selector ? document.querySelector<HTMLElement>(step.selector) : null;
      setRect(el ? el.getBoundingClientRect() : null);
    };
    locate();
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [isOpen, step]);

  // Place la carte à côté de la cible (ou centrée) une fois sa taille réelle connue
  useLayoutEffect(() => {
    if (!isOpen) return;
    const card = cardRef.current;
    const size = { width: card?.offsetWidth || CARD_WIDTH, height: card?.offsetHeight || 220 };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const target = rect
      ? { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
      : null;
    setPosition(computeCardPosition(target, viewport, size));
  }, [isOpen, rect, stepIndex]);

  const total = steps.length;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex >= total - 1;

  const goNext = () => setStepIndex((i) => Math.min(i + 1, total - 1));
  const goPrev = () => setStepIndex((i) => Math.max(i - 1, 0));
  const handleClose = () => close();

  // Clavier : ←/→ pour naviguer, Échap pour fermer, Tab piégé dans la carte
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "Escape") handleClose();
      else if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => !el.hasAttribute("disabled")
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, total]);

  // Focus initial sur la carte à l'ouverture et à chaque étape
  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen, stepIndex]);

  if (!isOpen || !step || total === 0) return null;

  const canTry = !!step.route && location.pathname !== step.route;

  return (
    <div className="fixed inset-0 z-modal" role="presentation">
      {/* Zone assombrie avec découpe autour de la cible (spotlight) */}
      {rect ? (
        <div
          aria-hidden="true"
          className={cn("fixed rounded-win-lg pointer-events-none", !reducedMotion && "transition-all duration-200")}
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.65)",
            outline: "2px solid var(--accent-primary)",
            outlineOffset: 2,
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-black/65" />
      )}

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("tour.dialogLabel")}
        tabIndex={-1}
        className={cn(
          "fixed bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover flex flex-col outline-none",
          !reducedMotion && "animate-fade-in"
        )}
        style={{ top: position.top, left: position.left, width: CARD_WIDTH, maxHeight: "80vh" }}
      >
        <div className="p-4 border-b border-border-primary space-y-3 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div aria-live="polite">
              <h2 className="text-text-primary font-semibold text-sm">{t(step.titleKey)}</h2>
              <p className="text-xs text-text-secondary mt-1">{t(step.textKey)}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              title={t("tour.skip")}
              className="shrink-0 text-text-secondary hover:text-text-primary transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* L'accueil n'a pas de mini-exemple : on passe directement à la présentation */}
          {step.id !== "welcome" && (
            <div className="rounded-win bg-bg-secondary/60 border border-border-primary/60 p-2.5">
              <StepExample step={step} reducedMotion={reducedMotion} />
            </div>
          )}

          {canTry && (
            <button
              type="button"
              onClick={() => navigate(step.route as string)}
              className="text-xs font-medium text-accent-primary hover:underline"
            >
              {t("tour.try")}
            </button>
          )}
        </div>

        <div className="p-3 border-t border-border-primary flex items-center justify-between gap-2">
          <span className="text-[11px] text-text-muted shrink-0">{t("tour.progress", { current: stepIndex + 1, total })}</span>
          <div className="flex items-center gap-1.5">
            {!isFirst && (
              <button
                type="button"
                onClick={goPrev}
                className="flex items-center gap-1 px-2 py-1.5 text-xs rounded-win border border-border-primary text-text-secondary hover:bg-bg-hover"
              >
                <ChevronLeft size={14} />
                {t("tour.prev")}
              </button>
            )}
            {!isLast ? (
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
              >
                {t("tour.next")}
                <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                className="px-3 py-1.5 text-xs rounded-win bg-accent-primary hover:bg-accent-secondary text-white font-medium"
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

/** Sélectionne le mini-exemple illustrant l'étape courante */
function StepExample({ step, reducedMotion }: { step: TourStepDef; reducedMotion: boolean }) {
  switch (step.id) {
    case "dashboard":
      return <DashboardExample />;
    case "servers":
      return <ServersExample reducedMotion={reducedMotion} />;
    case "console":
      return <ConsoleExample reducedMotion={reducedMotion} />;
    case "batch":
      return <BatchExample />;
    case "network":
      return <NetworkExample />;
    case "alerts":
      return <AlertsExample />;
    case "customization":
      return <CustomizationExample reducedMotion={reducedMotion} />;
    case "settings":
      return <SettingsExample />;
    default:
      return null;
  }
}

function ServersExample({ reducedMotion }: { reducedMotion: boolean }) {
  const { t } = useT();
  const [online, setOnline] = useState(false);
  return (
    <div className="rounded-win border border-border-primary bg-bg-primary/60 p-2.5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn("h-2 w-2 rounded-full shrink-0", online ? "bg-accent-success" : "bg-text-muted", !reducedMotion && "transition-colors duration-300")}
        />
        <div className="min-w-0">
          <p className="text-xs font-medium text-text-primary truncate">{t("tour.examples.servers.name")}</p>
          <p className="text-[10px] text-text-secondary">{online ? t("tour.examples.servers.online") : t("tour.examples.servers.offline")}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOnline((o) => !o)}
        className="shrink-0 px-2 py-1 text-[11px] rounded-win bg-accent-primary text-white font-medium hover:bg-accent-secondary"
      >
        {t("tour.examples.servers.wol")}
      </button>
    </div>
  );
}

function DashboardExample() {
  const { t } = useT();
  const tiles = [
    { label: t("tour.examples.dashboard.onlineLabel"), value: "2/3" },
    { label: t("tour.examples.dashboard.cpuLabel"), value: "42 %" },
    { label: t("tour.examples.dashboard.ramLabel"), value: "58 %" },
  ];
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-win border border-border-primary bg-bg-primary/60 p-1.5 text-center">
          <p className="text-xs font-semibold text-text-primary">{tile.value}</p>
          <p className="text-[9px] text-text-secondary truncate">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

function ConsoleExample({ reducedMotion }: { reducedMotion: boolean }) {
  const { t } = useT();
  const command = t("tour.examples.console.command");
  const [typed, setTyped] = useState(reducedMotion ? command : "");
  const [showOutput, setShowOutput] = useState(reducedMotion);

  useEffect(() => {
    if (reducedMotion) {
      setTyped(command);
      setShowOutput(true);
      return;
    }
    setTyped("");
    setShowOutput(false);
    let i = 0;
    const typing = setInterval(() => {
      i += 1;
      setTyped(command.slice(0, i));
      if (i >= command.length) {
        clearInterval(typing);
        setShowOutput(true);
      }
    }, 100);
    return () => clearInterval(typing);
  }, [command, reducedMotion]);

  return (
    <div className="rounded-win border border-border-primary bg-black/85 p-2.5 font-mono text-[11px] text-accent-success space-y-1">
      <p>
        $ {typed}
        {!showOutput && <span className={cn(!reducedMotion && "animate-pulse-soft")}>▌</span>}
      </p>
      {showOutput && <p className="text-text-secondary">{t("tour.examples.console.output")}</p>}
    </div>
  );
}

function BatchExample() {
  const { t } = useT();
  const rows = [
    { name: t("tour.examples.batch.target1"), os: t("tour.examples.batch.debian"), cmd: "apt update && apt upgrade -y" },
    { name: t("tour.examples.batch.target2"), os: t("tour.examples.batch.alpine"), cmd: "apk update && apk upgrade" },
    { name: t("tour.examples.batch.target3"), os: t("tour.examples.batch.windows"), cmd: "winget upgrade --all" },
  ];
  return (
    <div className="space-y-1">
      <p className="text-[10px] text-text-secondary">{t("tour.examples.batch.action")}</p>
      {rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-2 rounded-win border border-border-primary bg-bg-primary/60 px-2 py-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent-primary/15 text-accent-primary">{row.os}</span>
            <span className="text-[10px] text-text-primary truncate">{row.name}</span>
          </div>
          <code className="text-[9px] text-text-secondary font-mono truncate">{row.cmd}</code>
        </div>
      ))}
    </div>
  );
}

function NetworkExample() {
  const { t } = useT();
  return (
    <svg viewBox="0 0 220 80" className="w-full h-16" role="img" aria-label={t("tour.steps.network.title")}>
      <line x1="20" y1="40" x2="90" y2="40" style={{ stroke: "var(--border-primary)" }} strokeWidth={2} />
      <line x1="90" y1="40" x2="168" y2="18" style={{ stroke: "var(--border-primary)" }} strokeWidth={2} />
      <line x1="90" y1="40" x2="168" y2="62" style={{ stroke: "var(--border-primary)" }} strokeWidth={2} />
      <circle cx="20" cy="40" r="9" style={{ fill: "var(--accent-primary)" }} />
      <circle cx="90" cy="40" r="9" style={{ fill: "var(--accent-primary)", opacity: 0.7 }} />
      <circle cx="176" cy="18" r="7" style={{ fill: "var(--accent-success)" }} />
      <circle cx="176" cy="62" r="7" style={{ fill: "var(--accent-success)" }} />
      <text x="20" y="58" textAnchor="middle" style={{ fill: "var(--text-secondary)" }} fontSize="9">{t("tour.examples.network.box")}</text>
      <text x="90" y="58" textAnchor="middle" style={{ fill: "var(--text-secondary)" }} fontSize="9">{t("tour.examples.network.switch")}</text>
      <text x="192" y="21" textAnchor="middle" style={{ fill: "var(--text-secondary)" }} fontSize="9">{t("tour.examples.network.machine1")}</text>
      <text x="192" y="65" textAnchor="middle" style={{ fill: "var(--text-secondary)" }} fontSize="9">{t("tour.examples.network.machine2")}</text>
    </svg>
  );
}

function AlertsExample() {
  const { t } = useT();
  const [enabled, setEnabled] = useState(true);
  const [showToast, setShowToast] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 rounded-win border border-border-primary bg-bg-primary/60 px-2 py-1.5">
        <span className="text-[10px] text-text-primary">{t("tour.examples.alerts.toggleLabel")}</span>
        <button
          type="button"
          onClick={() => { setEnabled((e) => !e); setShowToast(true); }}
          aria-pressed={enabled}
          className={cn("w-7 h-4 rounded-full relative transition-colors", enabled ? "bg-accent-primary" : "bg-border-primary")}
        >
          <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform", enabled ? "translate-x-3.5" : "translate-x-0.5")} />
        </button>
      </div>
      {showToast && (
        <div className="rounded-win border border-accent-warning/40 bg-accent-warning/10 px-2 py-1.5 animate-fade-in">
          <p className="text-[10px] font-medium text-text-primary">{t("tour.examples.alerts.toastTitle")}</p>
          <p className="text-[9px] text-text-secondary">{t("tour.examples.alerts.toastMessage")}</p>
        </div>
      )}
    </div>
  );
}

function CustomizationExample({ reducedMotion }: { reducedMotion: boolean }) {
  const { t } = useT();
  return (
    <div className="relative rounded-win border border-border-primary bg-bg-primary/60 p-2.5 h-16 overflow-hidden">
      <p className="text-[9px] text-text-secondary/70 uppercase tracking-wide">{t("tour.examples.customization.favoritesLabel")}</p>
      <div className="absolute left-3 bottom-3 w-16 h-6 rounded-win border border-dashed border-border-primary" />
      <div
        className={cn(
          "absolute bottom-3 h-6 px-2 rounded-win bg-accent-primary text-white text-[10px] flex items-center gap-1",
          !reducedMotion && "animate-tour-drag"
        )}
        style={{ left: reducedMotion ? 12 : undefined }}
      >
        <TerminalSquare size={11} /> {t("tour.examples.customization.tabLabel")}
      </div>
    </div>
  );
}

function SettingsExample() {
  const { t } = useT();
  const rows = [
    { Icon: PackageSearch, label: t("settingsPage.sections.updates") },
    { Icon: LifeBuoy, label: t("settingsPage.sections.report") },
    { Icon: Coffee, label: t("settingsPage.sections.coffee") },
  ];
  return (
    <div className="space-y-1">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 rounded-win border border-border-primary bg-bg-primary/60 px-2 py-1.5">
          <row.Icon size={13} className="text-accent-primary shrink-0" />
          <span className="text-[10px] text-text-primary">{row.label}</span>
        </div>
      ))}
    </div>
  );
}
