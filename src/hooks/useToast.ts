import { useState, useCallback } from "react";
import { Toast, ToastType } from "../types";

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastType = "info", duration = 4000) => {
      const id = String(++toastId);
      setToasts((prev) => [...prev, { id, type, message, duration }]);

      if (duration > 0) {
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
      }

      return id;
    },
    []
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback(
    (msg: string) => addToast(msg, "success"),
    [addToast]
  );
  const error = useCallback(
    (msg: string) => addToast(msg, "error", 6000),
    [addToast]
  );
  const info = useCallback(
    (msg: string) => addToast(msg, "info"),
    [addToast]
  );
  const warning = useCallback(
    (msg: string) => addToast(msg, "warning"),
    [addToast]
  );

  return { toasts, addToast, removeToast, success, error, info, warning };
}

export type ToastHook = ReturnType<typeof useToast>;
