import { ReactNode, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle } from "lucide-react";
import { AppSettings, LockStatus } from "../types";
import { useLockStore } from "../stores/useLockStore";
import { ACTIVITY_INTERVAL_MS, createActivityThrottle, isLockShortcut } from "../utils/lock";
import { applyBrightness, applyDensity, applyFontSize, applyTheme, findTheme } from "../utils/theme";
import { LockScreen } from "./LockScreen";

const ACTIVITY_EVENTS = ["keydown", "mousedown", "mousemove", "wheel", "touchstart"] as const;

/**
 * Garde d'affichage : tant que l'app est verrouillée (ou que son état est inconnu),
 * le contenu n'est pas monté du tout, seul l'écran de verrouillage l'est. Le
 * verrouillage automatique est décidé par le backend, qui reçoit l'activité
 * clavier / souris (limitée) et notifie les changements par « lock-state ».
 */
export function LockGate({ children }: { children: ReactNode }) {
  const status = useLockStore((s) => s.status);
  const error = useLockStore((s) => s.error);
  const load = useLockStore((s) => s.load);
  const setStatus = useLockStore((s) => s.setStatus);
  const lockNow = useLockStore((s) => s.lockNow);
  const themed = useRef(false);

  useEffect(() => {
    load();
    const unlisten = listen<LockStatus>("lock-state", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, [load, setStatus]);

  // Démarrage verrouillé : le store principal n'est pas encore chargé, on applique
  // quand même le thème pour que l'écran de verrouillage ait la bonne apparence
  useEffect(() => {
    if (!status?.locked || themed.current) return;
    themed.current = true;
    invoke<AppSettings>("get_settings")
      .then(({ appearance }) => {
        applyTheme(findTheme(appearance.active_theme, appearance.custom_themes));
        applyFontSize(appearance.font_size);
        applyBrightness(appearance.brightness);
        applyDensity(appearance.density);
      })
      .catch(() => {});
  }, [status?.locked]);

  const watching = !!status?.enabled && !status.locked;

  // Activité remontée au backend. Phase de capture : la console (xterm) arrête la
  // propagation des touches qu'elle traite, qui doivent pourtant compter.
  useEffect(() => {
    if (!watching) return;
    const report = createActivityThrottle(() => {
      invoke("lock_activity").catch(() => {});
    }, ACTIVITY_INTERVAL_MS);
    const options = { capture: true, passive: true };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, report, options));
    return () => ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, report, options));
  }, [watching]);

  // Ctrl+Maj+L : verrouiller maintenant (capture, avant que la console ne l'intercepte)
  useEffect(() => {
    if (!watching) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isLockShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
      lockNow().catch(() => {});
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [watching, lockNow]);

  if (!status && error) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary text-text-primary">
        <div className="max-w-sm mx-4 text-center space-y-3">
          <AlertTriangle size={22} className="mx-auto text-yellow-400" />
          <p className="text-sm">Impossible de lire l'état du verrouillage.</p>
          <p className="text-xs text-text-muted break-words">{error}</p>
          <button
            onClick={() => load()}
            className="px-4 py-2 text-sm rounded-win bg-accent-primary text-white hover:bg-accent-secondary transition-colors duration-150"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (status.locked) return <LockScreen status={status} />;
  return <>{children}</>;
}
