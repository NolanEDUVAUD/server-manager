import { AlertTriangle, X } from "lucide-react";
import { useT } from "../i18n";
import { useShortcuts } from "../hooks/useShortcuts";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
  /** Contenu additionnel sous le message (choix, case à cocher…) */
  children?: React.ReactNode;
  /** Bouton de confirmation désactivé (choix incomplet, action en cours) */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  dangerous = false,
  children,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useT();
  // Échap = Annuler (raccourci « close » de la table des raccourcis)
  useShortcuts({ close: onCancel });
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover p-6 w-full max-w-md mx-4 animate-slide-in">
        <div className="flex items-start gap-4">
          {dangerous && (
            <div className="p-2 rounded-win bg-red-500/10">
              <AlertTriangle size={20} className="text-red-400" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-text-primary font-semibold text-base mb-2">{title}</h3>
            <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-line break-words max-h-64 overflow-y-auto">{message}</p>
            {children && <div className="mt-3">{children}</div>}
          </div>
          <button
            onClick={onCancel}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-win border border-border-primary
                       text-text-secondary hover:text-text-primary hover:bg-bg-hover
                       transition-all duration-150"
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`px-4 py-2 text-sm rounded-win font-medium transition-all duration-150 disabled:opacity-50
              ${dangerous
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-accent-primary hover:bg-accent-secondary text-white"
              }`}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
