import { CHANGELOG, ChangelogEntry } from "../data/changelog";

/**
 * Analyse une version au format X.Y.Z et retourne [major, minor, patch]
 * Retourne null si le format est invalide
 */
export function parseVersion(version: string): [number, number, number] | null {
  const parts = version.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => isNaN(n))) return null;
  return [nums[0], nums[1], nums[2]];
}

/**
 * Compare deux versions : retourne -1 si a < b, 0 si a === b, 1 si a > b
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);
  if (!aParts || !bParts) return 0; // Format invalide = égal

  for (let i = 0; i < 3; i++) {
    if (aParts[i] < bParts[i]) return -1;
    if (aParts[i] > bParts[i]) return 1;
  }
  return 0;
}

/**
 * Récupère les entrées du changelog entre deux versions (inclut la version finale, exclut la version initiale)
 * Exemple : getChangesBetween("0.3.0", "0.4.0") retourne l'entrée 0.4.0 si elle est plus nouvelle
 */
export function getChangesBetween(
  fromVersion: string | undefined,
  toVersion: string
): ChangelogEntry[] {
  // Si aucune version précédente, on montre juste une validation
  if (!fromVersion) return [];

  // On ne montre que les entrées plus récentes que fromVersion et jusqu'à toVersion inclus
  return CHANGELOG.filter((entry) => {
    const cmp = compareVersions(entry.version, fromVersion);
    const cmpTo = compareVersions(entry.version, toVersion);
    // L'entrée doit être > fromVersion et <= toVersion
    return cmp > 0 && cmpTo <= 0;
  });
}

/**
 * Obtient la version actuelle du changelog (la première dans la liste)
 */
export function getCurrentChangelogVersion(): string {
  return CHANGELOG[0]?.version || "0.0.0";
}
