/**
 * Explorateur de fichiers SFTP (Console) — aides pures sur les chemins distants,
 * indépendantes de tout appel réseau : jointure, dossier parent, fil d'Ariane,
 * formatage d'une taille et échappement pour une commande shell (« cd »).
 */

/** Concatène un dossier (déjà normalisé, absolu) et un nom d'entrée. */
export function joinRemotePath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

/** Dossier parent d'un chemin absolu, ou `null` si c'est déjà la racine. */
export function parentRemotePath(path: string): string | null {
  if (path === "/" || path === "") return null;
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

export interface Breadcrumb {
  name: string;
  path: string;
}

/** Fil d'Ariane d'un chemin absolu : la racine, puis chaque segment cliquable. */
export function breadcrumbs(path: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ name: "/", path: "/" }];
  if (path === "/" || path === "") return crumbs;
  let acc = "";
  for (const part of path.split("/").filter(Boolean)) {
    acc += `/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

/** Formate une taille en octets de façon lisible (o, Ko, Mo, Go, To). */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Formate un horodatage Unix (secondes) façon date + heure courtes, ou "—" si absent. */
export function formatModified(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Échappe un chemin pour l'insérer entre apostrophes dans une commande shell POSIX :
 * chaque apostrophe du chemin ferme la citation, insère une apostrophe échappée, puis
 * rouvre la citation (`'` → `'\''`). Fonctionne quel que soit le shell distant (sh, bash,
 * zsh…) puisqu'aucune expansion n'a lieu à l'intérieur d'apostrophes simples.
 */
export function quoteForShell(path: string): string {
  return `'${path.split("'").join(`'\\''`)}'`;
}

/** Commande `cd` prête à insérer dans le terminal (sans le retour à la ligne final). */
export function cdCommand(path: string): string {
  return `cd ${quoteForShell(path)}`;
}

/** Un nom d'entrée commence-t-il par un point (fichier/dossier caché, convention Unix) ? */
export function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}
