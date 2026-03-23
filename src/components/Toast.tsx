import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { Toast as ToastType } from "../types";
import { cn } from "../utils";

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
};

const COLORS = {
  success: "border-green-500/40 bg-green-500/10 text-green-400",
  error: "border-red-500/40 bg-red-500/10 text-red-400",
  info: "border-accent-primary/40 bg-accent-primary/10 text-blue-400",
  warning: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400",
};

interface ToastItemProps {
  toast: ToastType;
  onClose: (id: string) => void;
}

function ToastItem({ toast, onClose }: ToastItemProps) {
  const Icon = ICONS[toast.type];
  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-win border shadow-win",
        "animate-slide-in min-w-[280px] max-w-[400px]",
        COLORS[toast.type]
      )}
    >
      <Icon size={18} className="mt-0.5 shrink-0" />
      <p className="text-sm flex-1 leading-snug">{toast.message}</p>
      <button
        onClick={() => onClose(toast.id)}
        className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastType[];
  onClose: (id: string) => void;
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onClose={onClose} />
      ))}
    </div>
  );
}
