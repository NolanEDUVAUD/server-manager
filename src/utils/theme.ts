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

/** Palette réduite d'un pack de couleurs → jeu complet de variables du thème */
interface Palette {
  bg0: string; bg1: string; bg2: string; bgInput: string; hover: string; active: string;
  fg: string; fg2: string; muted: string;
  accent: string; accent2: string; success: string; warning: string; error: string; info: string;
  border: string;
}

function pack(id: string, name: string, p: Palette): Theme {
  return {
    id, name, builtin: true,
    colors: {
      '--bg-primary': p.bg0, '--bg-secondary': p.bg1, '--bg-tertiary': p.bg2,
      '--bg-input': p.bgInput, '--bg-hover': p.hover, '--bg-active': p.active,
      '--text-primary': p.fg, '--text-secondary': p.fg2, '--text-muted': p.muted,
      '--accent-primary': p.accent, '--accent-secondary': p.accent2,
      '--accent-success': p.success, '--accent-warning': p.warning,
      '--accent-error': p.error, '--accent-info': p.info,
      '--border-primary': p.border, '--border-secondary': p.bg2,
      '--shadow-color': 'rgba(0, 0, 0, 0.4)',
      '--scrollbar-thumb': p.border, '--scrollbar-track': p.bg1,
      '--font-size-base': '14px',
    },
  };
}

// Packs de couleurs populaires (valeurs issues des palettes officielles).
// L'accent principal est la teinte la plus sombre de la palette : le texte blanc des boutons reste lisible.
export const GRUVBOX_DARK = pack('gruvbox-dark', 'Gruvbox Dark', {
  bg0: '#282828', bg1: '#1d2021', bg2: '#32302f', bgInput: '#1d2021', hover: '#3c3836', active: '#504945',
  fg: '#ebdbb2', fg2: '#bdae93', muted: '#928374',
  accent: '#458588', accent2: '#689d6a', success: '#b8bb26', warning: '#fabd2f', error: '#fb4934', info: '#83a598',
  border: '#504945',
});

export const NORD = pack('nord', 'Nord', {
  bg0: '#2e3440', bg1: '#272c36', bg2: '#3b4252', bgInput: '#272c36', hover: '#434c5e', active: '#4c566a',
  fg: '#eceff4', fg2: '#d8dee9', muted: '#7b88a1',
  accent: '#5e81ac', accent2: '#81a1c1', success: '#a3be8c', warning: '#ebcb8b', error: '#bf616a', info: '#88c0d0',
  border: '#4c566a',
});

export const DRACULA = pack('dracula', 'Dracula', {
  bg0: '#282a36', bg1: '#21222c', bg2: '#343746', bgInput: '#1e1f29', hover: '#3d4052', active: '#44475a',
  fg: '#f8f8f2', fg2: '#c0c2d4', muted: '#6272a4',
  accent: '#7c5fc9', accent2: '#bd93f9', success: '#50fa7b', warning: '#f1fa8c', error: '#ff5555', info: '#8be9fd',
  border: '#44475a',
});

export const CATPPUCCIN_MOCHA = pack('catppuccin-mocha', 'Catppuccin Mocha', {
  bg0: '#1e1e2e', bg1: '#181825', bg2: '#313244', bgInput: '#11111b', hover: '#45475a', active: '#585b70',
  fg: '#cdd6f4', fg2: '#bac2de', muted: '#7f849c',
  accent: '#5a7fd6', accent2: '#89b4fa', success: '#a6e3a1', warning: '#f9e2af', error: '#f38ba8', info: '#89dceb',
  border: '#45475a',
});

export const TOKYO_NIGHT = pack('tokyo-night', 'Tokyo Night', {
  bg0: '#1a1b26', bg1: '#16161e', bg2: '#24283b', bgInput: '#13131a', hover: '#292e42', active: '#3b4261',
  fg: '#c0caf5', fg2: '#a9b1d6', muted: '#565f89',
  accent: '#3d59a1', accent2: '#7aa2f7', success: '#9ece6a', warning: '#e0af68', error: '#f7768e', info: '#7dcfff',
  border: '#3b4261',
});

export const BUILTIN_THEMES: Theme[] = [ONE_HALF_DARK, FLUENT_DARK, GRUVBOX_DARK, NORD, DRACULA, CATPPUCCIN_MOCHA, TOKYO_NIGHT];

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

// Thèmes contribués par les extensions activées (voir utils/extensions.ts). Registre
// à part plutôt qu'un import direct : évite un cycle (extensions.ts importe déjà
// BUILTIN_THEMES d'ici) et permet à `findTheme` de les retrouver même quand
// l'appelant (ex. le store à l'initialisation) n'a que l'id en main.
let extraThemes: Theme[] = [];

/** Enregistre les thèmes actuellement contribués par les extensions activées. */
export function registerExtraThemes(themes: Theme[]): void {
  extraThemes = themes;
}

/** Retourne le thème par son id dans la liste complète (builtins + customs + extensions). */
export function findTheme(id: string, customThemes: Theme[]): Theme {
  const all = [...BUILTIN_THEMES, ...customThemes, ...extraThemes];
  return all.find(t => t.id === id) ?? ONE_HALF_DARK;
}

/** Génère un id slug unique depuis un nom. */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
