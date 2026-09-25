import { AppUpdateProgress } from "../types";
import { formatBytes } from "./index";
import { currentLocale, t } from "../i18n";

/** Texte du ConfirmDialog : dit exactement ce qui va se passer */
export function installConfirmMessage(version: string): string {
  return t("appUpdate.confirmMessage", { version });
}

/** Pourcentage du téléchargement, null si la taille totale est inconnue */
export function progressPercent(p: AppUpdateProgress | null): number | null {
  if (!p || !p.total) return null;
  return Math.min(100, Math.floor((p.downloaded / p.total) * 100));
}

export function progressLabel(p: AppUpdateProgress | null): string {
  if (!p) return t("appUpdate.progress.preparing");
  switch (p.phase) {
    case "downloading": {
      const pct = progressPercent(p);
      return pct !== null
        ? t("appUpdate.progress.downloadingPercent", { percent: pct })
        : t("appUpdate.progress.downloadingBytes", { size: formatBytes(p.downloaded) });
    }
    case "verifying":
      return t("appUpdate.progress.verifying");
    case "installing":
      return t("appUpdate.progress.installing");
  }
}

/** Date de publication lisible (« 21/09/2026 »), vide si absente ou illisible */
export function formatReleaseDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(currentLocale());
}
