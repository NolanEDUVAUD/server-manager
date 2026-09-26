import { X } from 'lucide-react';
import { eulaFr, eulaEn } from '../legal/eula';
import { useT } from '../i18n';

interface EulaViewerProps {
  onClose: () => void;
}

/**
 * Modal de visualisation de l'EULA (lecture uniquement)
 */
export function EulaViewer({ onClose }: EulaViewerProps) {
  const { lang } = useT();
  const eulaText = lang === 'fr' ? eulaFr : eulaEn;
  const title = lang === 'fr' ? 'Accord de licence' : 'License Agreement';

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl max-h-[80vh] mx-4 overflow-hidden flex flex-col animate-slide-in">
        {/* Header */}
        <div className="shrink-0 p-6 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-text-primary font-semibold text-lg">{title}</h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <pre className="text-text-secondary text-xs font-mono whitespace-pre-wrap break-words select-text">
            {eulaText}
          </pre>
        </div>

        {/* Footer */}
        <div className="shrink-0 p-6 border-t border-border-primary flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white transition-colors font-medium"
          >
            {lang === 'fr' ? 'Fermer' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}
