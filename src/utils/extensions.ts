// src/utils/extensions.ts
//
// Extensions communautaires (F1) : format de manifeste strictement déclaratif — un
// simple fichier JSON qui décrit des snippets, des thèmes et des liens web. Aucun
// champ n'autorise de code (pas de script, pas d'URL exécutée) : c'est ce qui rend
// le format sûr pour une app qui garde des clés SSH et des identifiants. Voir
// docs/extensions.md pour le format complet.
import { Snippet, Theme } from "../types";
import { BUILTIN_THEMES } from "./theme";

// ─── Format du manifeste ───────────────────────────────────────────────────────

export interface ExtensionSnippet {
  name: string;
  command: string;
  description?: string;
}

export interface ExtensionTheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

export interface ExtensionWebLink {
  name: string;
  url: string;
}

export interface ExtensionContributes {
  snippets?: ExtensionSnippet[];
  themes?: ExtensionTheme[];
  webLinks?: ExtensionWebLink[];
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  homepage?: string;
  minAppVersion?: string;
  contributes?: ExtensionContributes;
}

export interface InstalledExtension {
  manifest: ExtensionManifest;
  enabled: boolean;
}

// ─── Limites (contre un manifeste abusif ou simplement mal formé) ─────────────

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const THEME_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/i;

const MAX_LEN = {
  id: 100,
  name: 80,
  version: 32,
  author: 80,
  description: 400,
  homepage: 500,
  snippetName: 60,
  snippetCommand: 500,
  snippetDescription: 200,
  themeName: 60,
  colorValue: 64,
  webLinkName: 60,
  webLinkUrl: 500,
};

const MAX_COUNT = {
  snippets: 50,
  themes: 10,
  webLinks: 20,
  themeColors: 40,
};

const TOP_LEVEL_KEYS = new Set(["id", "name", "version", "author", "description", "homepage", "minAppVersion", "contributes"]);
const CONTRIBUTES_KEYS = new Set(["snippets", "themes", "webLinks"]);

export type ValidationResult =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/**
 * Valide strictement un manifeste d'extension : types, longueurs, formats (id,
 * semver, URLs https), et rejette toute clé inconnue à chaque niveau. Ne lève
 * jamais d'exception : retourne toujours la liste complète des erreurs trouvées.
 */
export function validateManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["Le manifeste doit être un objet JSON"] };
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`Clé inconnue à la racine : « ${key} »`);
  }

  if (!isNonEmptyString(raw.id, MAX_LEN.id) || !ID_RE.test(raw.id)) {
    errors.push(`id : identifiant invalide (attendu : minuscules, chiffres, points/tirets, ex. « com.exemple.mon-extension », ${MAX_LEN.id} caractères max)`);
  }
  if (!isNonEmptyString(raw.name, MAX_LEN.name)) errors.push(`name : chaîne non vide requise (${MAX_LEN.name} caractères max)`);
  if (!isNonEmptyString(raw.version, MAX_LEN.version) || !SEMVER_RE.test(raw.version)) {
    errors.push("version : doit suivre le format semver (ex. « 1.2.0 »)");
  }
  if (!isNonEmptyString(raw.author, MAX_LEN.author)) errors.push(`author : chaîne non vide requise (${MAX_LEN.author} caractères max)`);
  if (!isNonEmptyString(raw.description, MAX_LEN.description)) errors.push(`description : chaîne non vide requise (${MAX_LEN.description} caractères max)`);

  if (raw.homepage !== undefined) {
    if (!isNonEmptyString(raw.homepage, MAX_LEN.homepage) || !HTTPS_URL_RE.test(raw.homepage)) {
      errors.push("homepage : doit être une URL https:// valide");
    }
  }
  if (raw.minAppVersion !== undefined) {
    if (typeof raw.minAppVersion !== "string" || !SEMVER_RE.test(raw.minAppVersion)) {
      errors.push("minAppVersion : doit suivre le format semver (ex. « 0.3.0 »)");
    }
  }

  let contributes: ExtensionContributes | undefined;
  if (raw.contributes !== undefined) {
    if (!isPlainObject(raw.contributes)) {
      errors.push("contributes : doit être un objet");
    } else {
      for (const key of Object.keys(raw.contributes)) {
        if (!CONTRIBUTES_KEYS.has(key)) errors.push(`contributes : clé inconnue « ${key} »`);
      }
      contributes = {};
      validateSnippets(raw.contributes.snippets, errors, contributes);
      validateThemes(raw.contributes.themes, errors, contributes);
      validateWebLinks(raw.contributes.webLinks, errors, contributes);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const manifest: ExtensionManifest = {
    id: raw.id as string,
    name: raw.name as string,
    version: raw.version as string,
    author: raw.author as string,
    description: raw.description as string,
    ...(raw.homepage !== undefined ? { homepage: raw.homepage as string } : {}),
    ...(raw.minAppVersion !== undefined ? { minAppVersion: raw.minAppVersion as string } : {}),
    ...(contributes ? { contributes } : {}),
  };
  return { ok: true, manifest };
}

/** Analyse un texte JSON brut (fichier lu ou téléchargé) et le valide. */
export function parseAndValidateManifest(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["Le fichier n'est pas un JSON valide"] };
  }
  return validateManifest(raw);
}

function validateSnippets(value: unknown, errors: string[], out: ExtensionContributes) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("contributes.snippets : doit être une liste");
    return;
  }
  if (value.length > MAX_COUNT.snippets) errors.push(`contributes.snippets : ${MAX_COUNT.snippets} entrées maximum`);
  const list: ExtensionSnippet[] = [];
  value.slice(0, MAX_COUNT.snippets).forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      errors.push(`contributes.snippets[${i}] : doit être un objet`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!["name", "command", "description"].includes(key)) errors.push(`contributes.snippets[${i}] : clé inconnue « ${key} »`);
    }
    if (!isNonEmptyString(entry.name, MAX_LEN.snippetName)) errors.push(`contributes.snippets[${i}].name : chaîne non vide requise (${MAX_LEN.snippetName} caractères max)`);
    if (!isNonEmptyString(entry.command, MAX_LEN.snippetCommand) || (entry.command as string).includes("\n")) {
      errors.push(`contributes.snippets[${i}].command : chaîne non vide, une seule ligne (${MAX_LEN.snippetCommand} caractères max)`);
    }
    if (entry.description !== undefined && (typeof entry.description !== "string" || entry.description.length > MAX_LEN.snippetDescription)) {
      errors.push(`contributes.snippets[${i}].description : ${MAX_LEN.snippetDescription} caractères max`);
    }
    if (isNonEmptyString(entry.name, MAX_LEN.snippetName) && isNonEmptyString(entry.command, MAX_LEN.snippetCommand)) {
      list.push({ name: entry.name, command: entry.command, ...(typeof entry.description === "string" ? { description: entry.description } : {}) });
    }
  });
  out.snippets = list;
}

function validateThemes(value: unknown, errors: string[], out: ExtensionContributes) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("contributes.themes : doit être une liste");
    return;
  }
  if (value.length > MAX_COUNT.themes) errors.push(`contributes.themes : ${MAX_COUNT.themes} entrées maximum`);
  const list: ExtensionTheme[] = [];
  value.slice(0, MAX_COUNT.themes).forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      errors.push(`contributes.themes[${i}] : doit être un objet`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!["id", "name", "colors"].includes(key)) errors.push(`contributes.themes[${i}] : clé inconnue « ${key} »`);
    }
    const idOk = isNonEmptyString(entry.id, MAX_LEN.name) && THEME_ID_RE.test(entry.id as string);
    if (!idOk) errors.push(`contributes.themes[${i}].id : identifiant invalide (minuscules, chiffres, tirets)`);
    if (!isNonEmptyString(entry.name, MAX_LEN.themeName)) errors.push(`contributes.themes[${i}].name : chaîne non vide requise`);
    let colorsOk = false;
    let colors: Record<string, unknown> = {};
    if (!isPlainObject(entry.colors)) {
      errors.push(`contributes.themes[${i}].colors : doit être un objet`);
    } else {
      colors = entry.colors;
      const colorKeys = Object.keys(colors);
      if (colorKeys.length === 0) errors.push(`contributes.themes[${i}].colors : au moins une couleur requise`);
      if (colorKeys.length > MAX_COUNT.themeColors) errors.push(`contributes.themes[${i}].colors : ${MAX_COUNT.themeColors} variables maximum`);
      colorsOk = colorKeys.every((k) => typeof colors[k] === "string" && (colors[k] as string).length <= MAX_LEN.colorValue);
      if (!colorsOk) errors.push(`contributes.themes[${i}].colors : toutes les valeurs doivent être des chaînes (${MAX_LEN.colorValue} caractères max)`);
    }
    if (idOk && isNonEmptyString(entry.name, MAX_LEN.themeName) && colorsOk) {
      list.push({ id: entry.id as string, name: entry.name as string, colors: colors as Record<string, string> });
    }
  });
  out.themes = list;
}

function validateWebLinks(value: unknown, errors: string[], out: ExtensionContributes) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push("contributes.webLinks : doit être une liste");
    return;
  }
  if (value.length > MAX_COUNT.webLinks) errors.push(`contributes.webLinks : ${MAX_COUNT.webLinks} entrées maximum`);
  const list: ExtensionWebLink[] = [];
  value.slice(0, MAX_COUNT.webLinks).forEach((entry, i) => {
    if (!isPlainObject(entry)) {
      errors.push(`contributes.webLinks[${i}] : doit être un objet`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!["name", "url"].includes(key)) errors.push(`contributes.webLinks[${i}] : clé inconnue « ${key} »`);
    }
    const nameOk = isNonEmptyString(entry.name, MAX_LEN.webLinkName);
    if (!nameOk) errors.push(`contributes.webLinks[${i}].name : chaîne non vide requise`);
    const urlOk = isNonEmptyString(entry.url, MAX_LEN.webLinkUrl) && HTTPS_URL_RE.test(entry.url as string);
    if (!urlOk) errors.push(`contributes.webLinks[${i}].url : doit être une URL https:// valide`);
    if (nameOk && urlOk) list.push({ name: entry.name as string, url: entry.url as string });
  });
  out.webLinks = list;
}

// ─── Espace de noms des contributions ─────────────────────────────────────────

/** Préfixe utilisé pour toute contribution d'extension, afin d'éviter toute collision
 * avec un identifiant natif (« ext:<idExtension>:<nom> ») */
export function namespacedId(extensionId: string, name: string): string {
  return `ext:${extensionId}:${name}`;
}

export function isExtensionId(id: string): boolean {
  return id.startsWith("ext:");
}

// ─── Fusion avec les listes natives (activées uniquement) ─────────────────────

export function mergeSnippets(builtin: Snippet[], installed: InstalledExtension[]): Snippet[] {
  const extras: Snippet[] = [];
  for (const ext of installed) {
    if (!ext.enabled) continue;
    for (const s of ext.manifest.contributes?.snippets ?? []) {
      extras.push({ id: namespacedId(ext.manifest.id, s.name), name: s.name, command: s.command });
    }
  }
  return [...builtin, ...extras];
}

/** Thèmes contribués par les extensions activées, sans les builtins/customs. */
export function extensionThemesOnly(installed: InstalledExtension[]): Theme[] {
  const extras: Theme[] = [];
  for (const ext of installed) {
    if (!ext.enabled) continue;
    for (const th of ext.manifest.contributes?.themes ?? []) {
      extras.push({ id: namespacedId(ext.manifest.id, th.id), name: th.name, builtin: false, colors: th.colors });
    }
  }
  return extras;
}

export function mergeThemes(installed: InstalledExtension[], builtin: Theme[] = BUILTIN_THEMES): Theme[] {
  return [...builtin, ...extensionThemesOnly(installed)];
}

export function mergeWebLinks(installed: InstalledExtension[]): (ExtensionWebLink & { extensionId: string; extensionName: string })[] {
  const links: (ExtensionWebLink & { extensionId: string; extensionName: string })[] = [];
  for (const ext of installed) {
    if (!ext.enabled) continue;
    for (const l of ext.manifest.contributes?.webLinks ?? []) {
      links.push({ ...l, extensionId: ext.manifest.id, extensionName: ext.manifest.name });
    }
  }
  return links;
}

/** Nombre total de contributions d'un manifeste, tous types confondus (affichage) */
export function contributionCount(manifest: ExtensionManifest): number {
  const c = manifest.contributes;
  if (!c) return 0;
  return (c.snippets?.length ?? 0) + (c.themes?.length ?? 0) + (c.webLinks?.length ?? 0);
}
