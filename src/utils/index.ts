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
  return new Date(ts).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb < 1) {
    return `${Math.round(bytes / 1024 / 1024)} Mo`;
  }
  return `${gb.toFixed(1)} Go`;
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
