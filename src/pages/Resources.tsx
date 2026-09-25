import { Link } from "react-router-dom";
import { Activity } from "lucide-react";
import { useStore } from "../stores/useStore";
import { ResourceCard } from "../components/ResourceCard";
import { supportsMetrics } from "../hooks/useMetrics";
import { useT } from "../i18n";

export function Resources() {
  const { t } = useT();
  const { servers, statuses, metrics, metricsErrors, metricsHistory, settings } = useStore();
  const { metrics_enabled, metrics_interval_secs } = settings.network;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-text-primary font-semibold text-lg">{t("resources.title")}</h1>
          <p className="text-text-secondary text-xs mt-0.5">
            {metrics_enabled
              ? t("resources.subtitle", { seconds: metrics_interval_secs })
              : t("resources.disabled")}
          </p>
        </div>
      </div>

      {!metrics_enabled && (
        <div className="text-sm text-text-secondary bg-bg-tertiary border border-border-primary rounded-win p-4">
          {t("resources.disabledNotice")}{" "}
          <Link to="/settings" className="text-accent-primary hover:underline">{t("resources.settingsNetwork")}</Link>.
        </div>
      )}

      {servers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-text-muted text-sm">
          <Activity size={28} className="opacity-50" />
          {t("resources.noServers")}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {servers.map((server) => (
            <ResourceCard
              key={server.id}
              server={server}
              status={statuses[server.id]}
              supported={supportsMetrics(server)}
              metrics={metrics[server.id]}
              error={metricsErrors[server.id]}
              history={metricsHistory[server.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
