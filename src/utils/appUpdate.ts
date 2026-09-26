import { AppUpdateProgress } from "../types";
import { formatBytes } from "./index";
import { currentLocale, t } from "../i18n";

/**
 * Texte du ConfirmDialog : dit exactement ce qui va se passer. `signed` : l'updater
 * signé est configuré (téléchargement + vérification + installation automatiques) ;
 * sinon la page de la release s'ouvre simplement dans le navigateur.
 */
export function installConfirmMessage(version: string, signed = true): string {
  return t(signed ? "appUpdate.confirmMessage" : "appUpdate.confirmMessageUnsigned", { version });
}

/** Horodatage de la dernière recherche (« 14:32:05 »), vide si jamais lancée */
export function formatCheckedAt(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString(currentLocale());
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
