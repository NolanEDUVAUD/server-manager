import { cn, formatLatency } from "../utils";
import { ServerStatus } from "../types";
import { useT } from "../i18n";

interface StatusBadgeProps {
  status?: ServerStatus;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const { t } = useT();
  if (!status) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium",
          size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1",
          "bg-gray-500/10 text-gray-400 border border-gray-500/20"
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
        {t("common.unknown")}
      </span>
    );
  }

  if (status.online) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full font-medium",
          size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1",
          "bg-green-500/10 text-green-400 border border-green-500/20"
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        {t("common.online")}
        {status.latency_ms != null && (
          <span className="opacity-70">{formatLatency(status.latency_ms)}</span>
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium",
        size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1",
        "bg-red-500/10 text-red-400 border border-red-500/20"
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
      {t("common.offline")}
    </span>
  );
}
