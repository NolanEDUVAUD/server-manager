// src/utils/theme.ts
import { Theme } from '../types';

// ─── Thèmes builtin ───────────────────────────────────────────────────────────

export const ONE_HALF_DARK: Theme = {
  id: 'one-half-dark',
  name: 'One Half Dark',
  builtin: true,
  colors: {
    '--bg-primary':     '#282c34',
    '--bg-secondary':   '#21252b',
    '--bg-tertiary':    '#2c313a',
    '--bg-input':       '#1e2227',
    '--bg-hover':       '#323842',
    '--bg-active':      '#3a3f4b',
    '--text-primary':   '#abb2bf',
    '--text-secondary': '#7f848e',
    '--text-muted':     '#5c6370',
    '--accent-primary':   '#61afef',
    '--accent-secondary': '#56b6c2',
    '--accent-success':   '#98c379',
    '--accent-warning':   '#e5c07b',
    '--accent-error':     '#e06c75',
    '--accent-info':      '#61afef',
    '--border-primary':   '#3e4451',
    '--border-secondary': '#2c313a',
    '--shadow-color':     'rgba(0, 0, 0, 0.3)',
    '--scrollbar-thumb':  '#3e4451',
    '--scrollbar-track':  '#21252b',
    '--font-size-base':   '14px',
  },
};

export const FLUENT_DARK: Theme = {
  id: 'fluent-dark',
  name: 'Fluent Dark',
  builtin: true,
  colors: {
    '--bg-primary':     '#0a0a0f',
    '--bg-secondary':   '#111117',
    '--bg-tertiary':    '#16161e',
    '--bg-input':       '#0d0d14',
    '--bg-hover':       '#1e1e2e',
    '--bg-active':      '#252535',
    '--text-primary':   '#e2e8f0',
    '--text-secondary': '#94a3b8',
    '--text-muted':     '#64748b',
    '--accent-primary':   '#0078d4',
    '--accent-secondary': '#106ebe',
    '--accent-success':   '#16a34a',
    '--accent-warning':   '#d97706',
    '--accent-error':     '#dc2626',
    '--accent-info':      '#0ea5e9',
    '--border-primary':   '#2a2a3a',
    '--border-secondary': '#1e1e2e',
    '--shadow-color':     'rgba(0, 0, 0, 0.5)',
    '--scrollbar-thumb':  '#2a2a3a',
    '--scrollbar-track':  '#111117',
    '--font-size-base':   '14px',
  },
};

export const BUILTIN_THEMES: Theme[] = [ONE_HALF_DARK, FLUENT_DARK];

// ─── Application du thème ─────────────────────────────────────────────────────

/**
 * Applique un thème en injectant les CSS variables sur :root.
 * Exclut --font-size-base (géré séparément par applyFontSize).
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  Object.entries(theme.colors).forEach(([key, value]) => {
    if (key === '--font-size-base') return;
    root.style.setProperty(key, value);
  });
}

/** Applique la taille de police sur :root et body. */
export function applyFontSize(size: number): void {
  document.documentElement.style.setProperty('--font-size-base', `${size}px`);
  document.body.style.fontSize = `${size}px`;
}

/** Applique la luminosité via filtre CSS sur l'élément #app-root. */
export function applyBrightness(value: number): void {
  const root = document.getElementById('app-root');
  if (root) root.style.filter = value === 1.0 ? '' : `brightness(${value})`;
}

/** Applique la densité via une classe CSS sur <body>. */
export function applyDensity(density: string): void {
  document.body.classList.remove('density-compact', 'density-normal', 'density-comfortable');
  document.body.classList.add(`density-${density.toLowerCase()}`);
}

/** Retourne le thème par son id dans la liste complète (builtins + customs). */
export function findTheme(id: string, customThemes: Theme[]): Theme {
  const all = [...BUILTIN_THEMES, ...customThemes];
  return all.find(t => t.id === id) ?? ONE_HALF_DARK;
}

/** Génère un id slug unique depuis un nom. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
