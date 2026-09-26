import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { eulaText, EULA_VERSION } from '../legal/eula';
import { useT } from '../i18n';

/**
 * Modal de consentement EULA bloquant, affiché au premier lancement
 * ou quand EULA_VERSION change. Enregistre l'acceptation dans localStorage.
 */
export function EulaModal() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Vérifier si l'EULA a déjà été accepté pour cette version
    try {
      const accepted = localStorage.getItem('eula.accepted.version');
      if (accepted !== EULA_VERSION) {
        // EULA non accepté ou version obsolète : afficher le modal
        setVisible(true);
      }
    } catch {
      // Si localStorage échoue, afficher le modal pour être prudent
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    try {
      localStorage.setItem('eula.accepted.version', EULA_VERSION);
    } catch {
      // Si localStorage échoue, continuer quand même
    }
    setVisible(false);
  };

  const handleReject = async () => {
    try {
      // Quitte réellement l'app (fermer la fenêtre ne ferait que la réduire dans la zone de notification)
      await invoke('quit_app');
    } catch (e) {
      console.error("Impossible de quitter l'application", e);
    }
  };

  if (!visible) return null;


  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative bg-bg-tertiary border border-border-primary rounded-win-lg shadow-win-hover w-full max-w-2xl max-h-[80vh] mx-4 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="shrink-0 p-6 border-b border-border-primary">
          <h2 className="text-text-primary font-semibold text-lg">{t('settingsPage.about.eula')}</h2>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <p className="mb-3 text-xs text-text-muted">{t('settingsPage.about.eulaEnglishOnly')}</p>
          <pre className="text-text-secondary text-xs font-mono whitespace-pre-wrap break-words select-text">
            {eulaText}
          </pre>
        </div>

        {/* Footer */}
        <div className="shrink-0 p-6 border-t border-border-primary flex gap-3 justify-end">
          <button
            onClick={handleReject}
            className="px-4 py-2 text-sm rounded-win border border-red-500/30 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors font-medium"
          >
            {t('settingsPage.about.eulaQuit')}
          </button>
          <button
            onClick={handleAccept}
            className="px-4 py-2 text-sm rounded-win bg-accent-primary hover:bg-accent-secondary text-white transition-colors font-medium"
          >
            {t('settingsPage.about.eulaAccept')}
          </button>
        </div>
      </div>
    </div>
  );
}
