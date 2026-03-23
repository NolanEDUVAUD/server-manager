import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  dangerous?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  dangerous = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
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
            <p className="text-text-secondary text-sm leading-relaxed">{message}</p>
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
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-win font-medium transition-all duration-150
              ${dangerous
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-accent-primary hover:bg-accent-secondary text-white"
              }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
