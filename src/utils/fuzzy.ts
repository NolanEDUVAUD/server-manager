/** Minuscules sans accents, pour une recherche tolérante (« reseau » trouve « Réseau ») */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Score de correspondance approximative : chaque mot de la requête doit apparaître
 * dans le texte, dans l'ordre des lettres (« wol work » trouve « Réveiller Workstation 2 »).
 * Renvoie null si pas de correspondance ; plus le score est bas, meilleur c'est.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const t = fold(text);
  let total = 0;
  for (const word of fold(query).split(/\s+/).filter(Boolean)) {
    const direct = t.indexOf(word);
    if (direct >= 0) {
      // Début de mot = meilleur score
      total += direct === 0 || /\s|[-(·]/.test(t[direct - 1]) ? 0 : 1;
      continue;
    }
    // Sous-séquence : les lettres dans l'ordre, avec des trous
    let pos = -1;
    let gaps = 0;
    for (const ch of word) {
      const next = t.indexOf(ch, pos + 1);
      if (next < 0) return null;
      if (pos >= 0) gaps += next - pos - 1;
      pos = next;
    }
    total += 5 + gaps;
  }
  return total;
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 12): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x): x is { item: T; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((x) => x.item);
}
