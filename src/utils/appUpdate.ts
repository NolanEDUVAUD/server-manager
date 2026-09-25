import { AppUpdateProgress } from "../types";
import { formatBytes } from "./index";

/** Texte du ConfirmDialog : dit exactement ce qui va se passer */
export function installConfirmMessage(version: string): string {
  return (
    `La version ${version} va être téléchargée depuis GitHub, puis sa signature sera vérifiée ` +
    `avec la clé publique intégrée à l'application : un paquet non signé ou modifié est refusé.\n\n` +
    `Si la signature est valide, l'installateur remplacera l'application puis la redémarrera ` +
    `automatiquement. Tes serveurs et ta configuration sont conservés.\n\n` +
    `Les tâches en cours dans l'application (consoles SSH, tâches en lot, arrêt ou démarrage du lab…) ` +
    `seront interrompues.`
  );
}

/** Pourcentage du téléchargement, null si la taille totale est inconnue */
export function progressPercent(p: AppUpdateProgress | null): number | null {
  if (!p || !p.total) return null;
  return Math.min(100, Math.floor((p.downloaded / p.total) * 100));
}

export function progressLabel(p: AppUpdateProgress | null): string {
  if (!p) return "Préparation du téléchargement…";
  switch (p.phase) {
    case "downloading": {
      const pct = progressPercent(p);
      return pct !== null ? `Téléchargement… ${pct} %` : `Téléchargement… ${formatBytes(p.downloaded)}`;
    }
    case "verifying":
      return "Vérification de la signature…";
    case "installing":
      return "Installation… l'application va redémarrer";
  }
}

/** Date de publication lisible (« 21/09/2026 »), vide si absente ou illisible */
export function formatReleaseDate(date: string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("fr-FR");
}
