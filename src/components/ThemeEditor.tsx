// src/components/ThemeEditor.tsx
import { useState } from 'react';
import { Theme } from '../types';
import { slugify } from '../utils/theme';
import { TKey, useT } from '../i18n';

// Étiquettes lisibles (clés de traduction) pour chaque variable CSS du thème
const CSS_VAR_LABELS: Record<string, TKey> = {
  '--bg-primary':       'themes.vars.bgPrimary',
  '--bg-secondary':     'themes.vars.bgSecondary',
  '--bg-tertiary':      'themes.vars.bgTertiary',
  '--bg-input':         'themes.vars.bgInput',
  '--bg-hover':         'themes.vars.bgHover',
  '--bg-active':        'themes.vars.bgActive',
  '--text-primary':     'themes.vars.textPrimary',
  '--text-secondary':   'themes.vars.textSecondary',
  '--text-muted':       'themes.vars.textMuted',
  '--accent-primary':   'themes.vars.accentPrimary',
  '--accent-secondary': 'themes.vars.accentSecondary',
  '--accent-success':   'themes.vars.accentSuccess',
  '--accent-warning':   'themes.vars.accentWarning',
  '--accent-error':     'themes.vars.accentError',
  '--accent-info':      'themes.vars.accentInfo',
  '--border-primary':   'themes.vars.borderPrimary',
  '--border-secondary': 'themes.vars.borderSecondary',
  '--scrollbar-thumb':  'themes.vars.scrollbarThumb',
  '--scrollbar-track':  'themes.vars.scrollbarTrack',
};

interface Props {
  initial: Theme;
  onSave: (theme: Theme) => void;
  onCancel: () => void;
}

export function ThemeEditor({ initial, onSave, onCancel }: Props) {
  const { t } = useT();
  const [name, setName] = useState(initial.name);
  const [colors, setColors] = useState<Record<string, string>>({ ...initial.colors });

  // Mise à jour d'une couleur avec prévisualisation instantanée via CSS variable
  const handleColorChange = (key: string, value: string) => {
    const updated = { ...colors, [key]: value };
    setColors(updated);
    // Prévisualisation live : injection directe de la variable CSS sur :root
    document.documentElement.style.setProperty(key, value);
  };

  const handleSave = () => {
    // Si on édite un thème builtin, créer un nouvel id unique pour le thème personnalisé
    const id = initial.builtin
      ? `${slugify(name)}-${Date.now()}`
      : initial.id;
    onSave({ id, name, builtin: false, colors });
  };

  return (
    <div className="mt-4 bg-bg-secondary rounded-win p-4 space-y-4 border border-border-primary">
      {/* Nom du thème */}
      <div>
        <label className="text-text-secondary text-xs block mb-1">{t('themes.name')}</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-1.5
                     text-text-primary text-sm focus:outline-none focus:border-accent-primary"
        />
      </div>

      {/* Grille des sélecteurs de couleurs */}
      <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
        {Object.entries(CSS_VAR_LABELS).map(([key, labelKey]) => {
          const colorVal = colors[key] ?? '#888888';
          // Vérifier que la valeur est un hex valide pour l'input color (évite les erreurs navigateur)
          const isValidHex = /^#[0-9a-fA-F]{3,8}$/.test(colorVal);
          return (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={isValidHex ? colorVal : '#888888'}
                onChange={e => handleColorChange(key, e.target.value)}
                className="w-7 h-7 rounded cursor-pointer border border-border-primary flex-shrink-0"
                style={{ backgroundColor: 'transparent' }}
              />
              <span className="text-text-secondary text-xs truncate">{t(labelKey)}</span>
            </div>
          );
        })}
      </div>

      {/* Boutons d'action */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary bg-bg-active rounded-win transition-colors duration-150"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim()}
          className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150 disabled:opacity-50"
        >
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}
