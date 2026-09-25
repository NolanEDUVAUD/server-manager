import { CustomField } from "../types";
import { fold } from "./fuzzy";

// Limites miroir de la validation Rust (src-tauri/src/organisation.rs)
export const TAG_NAME_MAX = 32;
export const FOLDER_NAME_MAX = 40;
export const CUSTOM_KEY_MAX = 40;
export const CUSTOM_VALUE_MAX = 500;
export const MAX_CUSTOM_FIELDS = 20;

/** Couleurs proposées à la création d'un tag */
export const TAG_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b"];

export function isValidColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color.trim());
}

/** Noir ou blanc, selon ce qui contraste le mieux avec la couleur de fond (luminance WCAG) */
export function readableTextColor(background: string): "#000000" | "#ffffff" {
  if (!isValidColor(background)) return "#ffffff";
  const hex = background.trim();
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

/**
 * Erreur d'un nom de tag ou de dossier (null = valide) : requis, longueur en caractères,
 * unique sans tenir compte de la casse (hors l'élément modifié lui-même)
 */
export function nameError(name: string, max: number, existing: { id: string; name: string }[], selfId = ""): string | null {
  const n = name.trim();
  if (!n) return "Nom requis";
  if ([...n].length > max) return `${max} caractères au plus`;
  if (existing.some((e) => e.id !== selfId && e.name.toLowerCase() === n.toLowerCase())) return "Ce nom existe déjà";
  return null;
}

// Mots qui trahissent un secret, comparés sans casse ni accents (« Mot de passe », « API_KEY »…).
// « pass » seul doit être un mot entier : « Passerelle » n'est pas un secret.
const SENSITIVE_KEY =
  /(\bpass\b|password|passwd|passphrase|mot\s*de\s*passe|\bmdp\b|\bpwd\b|token|jeton|secret|api[\s_-]*key|apikey|cle\s*(d')?\s*api|private[\s_-]*key|cle\s*privee|ssh[\s_-]*key|cle\s*ssh|credential|\botp\b|\b2fa\b)/;

/** La clé d'un champ personnalisé ressemble-t-elle à un secret ? (avertissement seulement) */
export function looksSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(fold(key).replace(/[’`]/g, "'"));
}

export interface CustomFieldsCheck {
  /** Erreur par ligne (null = valide) */
  rows: (string | null)[];
  /** Erreur d'ensemble (nombre de champs) */
  global: string | null;
}

/** Validation miroir de la validation Rust ; les lignes entièrement vides sont ignorées */
export function checkCustomFields(fields: CustomField[]): CustomFieldsCheck {
  const filled = fields.filter((f) => !isBlankField(f));
  const seen = new Set<string>();
  const rows = fields.map((f) => {
    if (isBlankField(f)) return null;
    const key = f.key.trim();
    if (!key) return "Clé requise";
    if ([...key].length > CUSTOM_KEY_MAX) return `Clé : ${CUSTOM_KEY_MAX} caractères au plus`;
    if ([...f.value.trim()].length > CUSTOM_VALUE_MAX) return `Valeur : ${CUSTOM_VALUE_MAX} caractères au plus`;
    const lower = key.toLowerCase();
    if (seen.has(lower)) return "Clé en double";
    seen.add(lower);
    return null;
  });
  const global = filled.length > MAX_CUSTOM_FIELDS ? `${MAX_CUSTOM_FIELDS} champs au plus` : null;
  return { rows, global };
}

export function isBlankField(f: CustomField): boolean {
  return !f.key.trim() && !f.value.trim();
}

/** « 1 serveur », « 3 serveurs » */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}
