/**
 * Internationalisation légère (français par défaut, anglais).
 *
 * - Les dictionnaires sont des objets TypeScript : `fr` est la référence et `en` est
 *   typé `Dict`, donc une clé manquante ou en trop casse la compilation ; le test
 *   `i18n.test.ts` vérifie en plus que chaque traduction est non vide et garde les
 *   mêmes variables `{nom}`.
 * - Les clés passées à `t()` sont typées (`TKey`) : une clé inexistante est refusée par tsc.
 * - Pluriels : une entrée `{ one, other }` est choisie selon `Intl.PluralRules`.
 * - La langue active vit dans un petit store dédié (pas dans `useStore`, qui importe
 *   ce module) ; `useStore` l'aligne sur `settings.general.language`.
 */
import { create } from "zustand";
import { fr } from "./fr";
import { en } from "./en";

export type Lang = "fr" | "en";
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
];

/** Entrée plurielle : `other` est obligatoire, `one` couvre le singulier */
export interface Plural {
  one?: string;
  other: string;
}

export type Dict = typeof fr;

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends Plural ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Toutes les clés de traduction valides, ex. « common.cancel » */
export type TKey = Leaves<Dict>;
export type TVars = Record<string, string | number>;

const RESOURCES: Record<Lang, Dict> = { fr, en };

export function isLang(value: unknown): value is Lang {
  return value === "fr" || value === "en";
}

/** Balise BCP 47 pour les dates et nombres (Intl) */
export function localeOf(lang: Lang): string {
  return lang === "en" ? "en-GB" : "fr-FR";
}

export const useLang = create<{ lang: Lang }>(() => ({ lang: "fr" }));

export function currentLang(): Lang {
  return useLang.getState().lang;
}

/** Locale Intl de la langue active (dates, nombres) */
export function currentLocale(): string {
  return localeOf(currentLang());
}

export function setLanguage(lang: unknown) {
  const next: Lang = isLang(lang) ? lang : "fr";
  if (useLang.getState().lang !== next) useLang.setState({ lang: next });
  if (typeof document !== "undefined") document.documentElement.lang = next;
}

function isPlural(v: unknown): v is Plural {
  return typeof v === "object" && v !== null && typeof (v as Plural).other === "string";
}

function lookup(dict: Dict, key: string): unknown {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function interpolate(text: string, vars?: TVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Traduit `key` dans `lang` ; repli sur le français, puis sur la clé elle-même */
export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  const value = lookup(RESOURCES[lang], key) ?? lookup(RESOURCES.fr, key);
  if (typeof value === "string") return interpolate(value, vars);
  if (isPlural(value)) {
    const count = Number(vars?.count ?? 0);
    const form = new Intl.PluralRules(localeOf(lang)).select(count);
    return interpolate(form === "one" && value.one !== undefined ? value.one : value.other, vars);
  }
  return key;
}

/** Traduction hors composant React (utilitaires, messages construits dans le store) */
export function t(key: TKey, vars?: TVars): string {
  return translate(currentLang(), key, vars);
}

/** Hook : re-rend le composant quand la langue change */
export function useT() {
  const lang = useLang((s) => s.lang);
  return {
    lang,
    locale: localeOf(lang),
    t: (key: TKey, vars?: TVars) => translate(lang, key, vars),
  };
}
