import { currentLocale, t } from "../i18n";
// ── Validation ─────────────────────────────────────────────────────────────

export function isValidIP(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

export function isValidMAC(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac);
}

export function formatMAC(raw: string): string {
  // Normaliser le format MAC (enlever tirets, ajouter deux-points)
  const clean = raw.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 12) return raw;
  return clean.match(/.{2}/g)!.join(":").toUpperCase();
}

// ── Formatage ─────────────────────────────────────────────────────────────

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleTimeString(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb < 1) {
    return t("format.mb", { value: Math.round(bytes / 1024 / 1024) });
  }
  if (gb >= 1024) {
    return t("format.tb", { value: (gb / 1024).toFixed(1) });
  }
  return t("format.gb", { value: gb.toFixed(1) });
}

export function formatUptime(secs: number): string {
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const minutes = Math.floor((secs % 3600) / 60);
  if (days > 0) return t("format.days", { days, hours });
  if (hours > 0) return t("format.hours", { hours, minutes });
  return t("format.minutes", { minutes });
}

// ── Historique de métriques ───────────────────────────────────────────────

/** Ajoute un point à un historique borné (fenêtre glissante), sans muter l'original. */
export function appendSample<T>(history: T[] | undefined, sample: T, max: number): T[] {
  const next = [...(history ?? []), sample];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Fusionne les points rechargés depuis la base avec ceux déjà reçus en direct : on ne
 * garde des premiers que ceux antérieurs au plus ancien point en direct (à 2 s près,
 * les horloges du backend et de la page pouvant différer), pour ne pas dupliquer la
 * collecte en cours, puis on conserve les `max` plus récents.
 */
export function mergeSamples<T extends { t: number }>(loaded: T[] | undefined, live: T[] | undefined, max: number): T[] {
  const current = live ?? [];
  const cutoff = current.length > 0 ? current[0].t - 2000 : Infinity;
  const older = (loaded ?? []).filter((p) => p.t < cutoff).sort((a, b) => a.t - b.t);
  const merged = [...older, ...current];
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

// ── Génération d'IDs ──────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

// ── Classes Tailwind utilitaires ──────────────────────────────────────────

export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ── Debounce ──────────────────────────────────────────────────────────────

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ── Copier dans le presse-papier ──────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
