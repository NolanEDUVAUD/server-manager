// src/components/ThemeCard.tsx
import { Copy, Trash2 } from 'lucide-react';
import { Theme } from '../types';
import { useT } from '../i18n';

interface Props {
  theme: Theme;
  active: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete?: () => void;
}

export function ThemeCard({ theme, active, onSelect, onDuplicate, onDelete }: Props) {
  const { t } = useT();
  const c = theme.colors;
  return (
    <div
      onClick={onSelect}
      className={[
        'relative p-3 rounded-win cursor-pointer transition-all duration-150 bg-bg-tertiary border-2',
        active
          ? 'border-accent-primary'
          : 'border-border-primary hover:border-border-secondary'
      ].join(' ')}
    >
      {/* Aperçu des couleurs principales du thème */}
      <div className="flex gap-1.5 mb-2">
        {([c['--bg-primary'], c['--bg-tertiary'], c['--accent-primary'], c['--accent-success']] as string[])
          .map((color, i) => (
            <span
              key={i}
              className="w-5 h-5 rounded"
              style={{ backgroundColor: color }}
            />
          ))
        }
      </div>
      <p className="text-text-primary text-xs font-medium truncate pr-12">{theme.name}</p>

      {/* Boutons d'action (dupliquer, supprimer) */}
      <div className="absolute top-2 right-2 flex gap-1">
        <button
          onClick={e => { e.stopPropagation(); onDuplicate(); }}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors duration-150"
          title={t('themes.duplicate')}
        >
          <Copy size={11} />
        </button>
        {onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent-error transition-colors duration-150"
            title={t('common.delete')}
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}
