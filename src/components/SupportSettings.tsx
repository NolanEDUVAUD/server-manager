import { Coffee, Github, Star } from "lucide-react";
import { useT } from "../i18n";
import { openExternal } from "../utils";
import { REPO_URL, SUPPORT_URL } from "../utils/support";

/** Paramètres → Soutenir le développement : don et étoile GitHub */
export function SupportSettings() {
  const { t } = useT();

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">{t("support.title")}</h2>
      <div className="bg-bg-tertiary rounded-win p-4 card space-y-4">
        <p className="text-text-secondary text-sm">{t("support.intro")}</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => openExternal(SUPPORT_URL)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-win bg-accent-primary text-white hover:opacity-90 transition-opacity text-sm"
          >
            <Coffee size={14} />
            {t("support.donate")}
          </button>
          <button
            onClick={() => openExternal(REPO_URL)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-win border border-border-primary text-text-primary hover:bg-bg-hover transition-colors text-sm"
          >
            <Star size={14} />
            {t("support.star")}
          </button>
        </div>
        <p className="text-text-muted text-xs flex items-center gap-1.5">
          <Github size={12} />
          {t("support.thanks")}
        </p>
      </div>
    </div>
  );
}
