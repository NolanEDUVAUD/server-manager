import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, Upload, Copy } from 'lucide-react';
import { useStore } from '../stores/useStore';
import { useToast } from '../hooks/useToast';
import { AppearanceSettings, GeneralSettings, NetworkSettings, Theme } from '../types';
import { applyTheme, findTheme, slugify } from '../utils/theme';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ToastContainer } from '../components/Toast';
import { ThemeCard } from '../components/ThemeCard';
import { ThemeEditor } from '../components/ThemeEditor';
import { IntegrationsSettings } from '../components/IntegrationsSettings';
import { HistorySettingsPanel } from '../components/HistorySettingsPanel';
import { MODULES } from '../utils/modules';
import { AppUpdateSettings } from '../components/AppUpdateSettings';
import { useAppUpdate } from '../stores/useAppUpdate';

// ── Types de sections ──────────────────────────────────────────────────────────
type Section = 'general' | 'appearance' | 'network' | 'history' | 'integrations' | 'config' | 'about';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'general',    label: 'Général' },
  { id: 'appearance', label: 'Apparence' },
  { id: 'network',    label: 'Réseau' },
  { id: 'history',    label: 'Historique' },
  { id: 'integrations', label: 'Intégrations' },
  { id: 'config',     label: 'Configuration' },
  { id: 'about',      label: 'À propos' },
];

// ── Composant principal ────────────────────────────────────────────────────────
export function Settings() {
  const [active, setActive] = useState<Section>('general');
  const { toasts, removeToast } = useToast();

  return (
    <div className="flex h-full">
      {/* Sidebar de navigation */}
      <nav className="w-36 md:w-44 shrink-0 bg-bg-secondary border-r border-border-primary flex flex-col py-4 overflow-y-auto">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={[
              'text-left px-4 py-2.5 text-sm transition-colors duration-150 border-l-[3px]',
              active === s.id
                ? 'border-accent-primary bg-bg-active text-text-primary font-medium'
                : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            ].join(' ')}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* Contenu de la section active */}
      <div className="flex-1 overflow-y-auto p-6">
        {active === 'general'    && <SectionGeneral />}
        {active === 'appearance' && <SectionAppearance />}
        {active === 'network'    && <SectionNetwork />}
        {active === 'history'    && <HistorySettingsPanel />}
        {active === 'integrations' && <IntegrationsSettings />}
        {active === 'config'     && <SectionConfig />}
        {active === 'about'      && <SectionAbout />}
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}

// ── Composant helper : InputRow ────────────────────────────────────────────────
function InputRow({ label, type = 'text', min, max, value, onChange }: {
  label: string;
  type?: string;
  min?: number;
  max?: number;
  value: string | number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="form-row">
      <label className="text-text-secondary text-xs block mb-1">{label}</label>
      <input
        type={type}
        min={min}
        max={max}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-bg-input border border-border-primary rounded-win px-3 py-2
                   text-text-primary text-sm focus:outline-none focus:border-accent-primary
                   transition-colors duration-150"
      />
    </div>
  );
}

// ── Composant helper : ToggleRow ───────────────────────────────────────────────
function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-secondary">
      <div>
        <p className="text-text-primary text-sm">{label}</p>
        <p className="text-text-muted text-xs mt-0.5">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={[
          'relative w-10 h-5 rounded-full transition-colors duration-150',
          checked ? 'bg-accent-primary' : 'bg-bg-active'
        ].join(' ')}
        aria-pressed={checked}
      >
        <span className={[
          'absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white transition-transform duration-150',
          checked ? 'translate-x-5' : 'translate-x-0.5'
        ].join(' ')} />
      </button>
    </div>
  );
}

// ── Composant helper : SliderRow ───────────────────────────────────────────────
function SliderRow({ label, value, min, max, step, display, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5 form-row">
      <div className="flex justify-between items-center">
        <p className="text-text-primary text-sm">{label}</p>
        <span className="text-text-muted text-xs font-mono">{display(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded appearance-none cursor-pointer bg-bg-active
          [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:w-3.5
          [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:bg-accent-primary
          [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  );
}

// ── Section : Général ──────────────────────────────────────────────────────────
function SectionGeneral() {
  const { settings, updateGeneral } = useStore();
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const { success, error } = useToast();

  // Récupérer l'état réel de l'autostart depuis le registre Windows
  useEffect(() => {
    invoke<boolean>('get_autostart')
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  const handleToggle = async (field: keyof GeneralSettings, value: boolean) => {
    try {
      if (field === 'auto_start') {
        // Mise à jour du registre Windows via la commande Tauri
        await invoke('set_autostart', { enabled: value });
        setAutostart(value);
        await updateGeneral({ auto_start: value });
      } else {
        await updateGeneral({ [field]: value });
      }
      success('Sauvegardé');
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Général</h2>
      <div className="bg-bg-tertiary rounded-win p-4 card">
        <ToggleRow
          label="Démarrer minimisé"
          description="Démarre directement dans la zone de notification"
          checked={settings.general.start_minimized}
          onChange={v => handleToggle('start_minimized', v)}
        />
        <ToggleRow
          label="Démarrage automatique"
          description="Lance l'application au démarrage de Windows"
          checked={autostart ?? settings.general.auto_start}
          onChange={v => handleToggle('auto_start', v)}
        />
        <ToggleRow
          label="Notifications système"
          description="Affiche des notifications OS pour les événements importants"
          checked={settings.general.notifications}
          onChange={v => handleToggle('notifications', v)}
        />
        <ToggleRow
          label="Fermer dans la zone de notification"
          description="La croix réduit l'app près de l'horloge : planificateur, collecte et alertes continuent"
          checked={settings.general.close_to_tray}
          onChange={v => handleToggle('close_to_tray', v)}
        />
      </div>

      <AppUpdateSettings />

      <h2 className="text-text-primary font-medium text-base">Modules</h2>
      <p className="text-xs text-text-secondary -mt-4">Masque les onglets que tu n'utilises pas. Rien n'est supprimé.</p>
      <div className="bg-bg-tertiary rounded-win p-4 card">
        {MODULES.map(m => (
          <ToggleRow
            key={m.key}
            label={m.label}
            description={m.description}
            checked={!settings.general.hidden_modules.includes(m.key)}
            onChange={async v => {
              const hidden = settings.general.hidden_modules.filter(k => k !== m.key);
              try {
                await updateGeneral({ hidden_modules: v ? hidden : [...hidden, m.key] });
              } catch (e) {
                error(String(e));
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Section : Apparence ────────────────────────────────────────────────────────
function SectionAppearance() {
  const { settings, updateAppearance, allThemes, saveCustomTheme, deleteCustomTheme } = useStore();
  const app = settings.appearance;
  const { success, error } = useToast();
  // État de l'éditeur de thème (null = fermé)
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);

  const handleChange = async (partial: Partial<AppearanceSettings>) => {
    try {
      await updateAppearance(partial);
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Apparence</h2>

      {/* Luminosité */}
      <SliderRow
        label="Luminosité"
        value={app.brightness}
        min={0.6}
        max={1.2}
        step={0.05}
        display={v => `${Math.round(v * 100)}%`}
        onChange={v => handleChange({ brightness: v })}
      />

      {/* Taille de police */}
      <SliderRow
        label="Taille de police"
        value={app.font_size}
        min={12}
        max={18}
        step={1}
        display={v => `${v}px`}
        onChange={v => handleChange({ font_size: v })}
      />

      {/* Densité de l'interface */}
      <div className="space-y-2">
        <p className="text-text-primary text-sm">Densité</p>
        <div className="flex gap-2">
          {(['Compact', 'Normal', 'Comfortable'] as const).map(d => (
            <button
              key={d}
              onClick={() => handleChange({ density: d })}
              className={[
                'px-3 py-1.5 text-xs rounded-win transition-colors duration-150',
                app.density === d
                  ? 'bg-accent-primary text-white'
                  : 'bg-bg-active text-text-secondary hover:bg-bg-hover'
              ].join(' ')}
            >
              {d === 'Compact' ? 'Compact' : d === 'Normal' ? 'Normal' : 'Aéré'}
            </button>
          ))}
        </div>
      </div>

      {/* Sélecteur de thème */}
      <div className="space-y-3">
        <p className="text-text-primary text-sm">Thème</p>
        <div className="grid grid-cols-3 gap-2">
          {allThemes.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              active={app.active_theme === theme.id}
              onSelect={() => handleChange({ active_theme: theme.id })}
              onDuplicate={() => setEditingTheme({
                ...theme,
                id: `${theme.id}-copy`,
                name: `${theme.name} (copie)`,
                builtin: false,
              })}
              onDelete={theme.builtin ? undefined : () => deleteCustomTheme(theme.id)}
            />
          ))}
        </div>

        {/* Éditeur de thème inline */}
        {editingTheme && (
          <ThemeEditor
            initial={editingTheme}
            onSave={async t => {
              await saveCustomTheme(t);
              await handleChange({ active_theme: t.id });
              setEditingTheme(null);
              success('Thème sauvegardé');
            }}
            onCancel={() => {
              // Restaurer le thème courant si la prévisualisation a modifié les variables CSS
              const current = findTheme(app.active_theme, settings.appearance.custom_themes);
              applyTheme(current);
              setEditingTheme(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Section : Réseau ───────────────────────────────────────────────────────────
function SectionNetwork() {
  const { settings, updateNetwork } = useStore();
  const [net, setNet] = useState(settings.network);
  const { success, error } = useToast();

  const handleSave = async () => {
    try {
      await updateNetwork(net);
      success('Paramètres réseau sauvegardés');
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Réseau</h2>
      <div className="space-y-4">
        <InputRow
          label="Intervalle de ping (secondes)"
          type="number"
          min={5}
          max={3600}
          value={net.ping_interval_secs}
          onChange={v => setNet(n => ({ ...n, ping_interval_secs: Number(v) }))}
        />
        <InputRow
          label="Timeout ping (ms)"
          type="number"
          min={500}
          max={30000}
          value={net.ping_timeout_ms}
          onChange={v => setNet(n => ({ ...n, ping_timeout_ms: Number(v) }))}
        />
        <InputRow
          label="Timeout SSH (secondes)"
          type="number"
          min={5}
          max={120}
          value={net.ssh_timeout_secs}
          onChange={v => setNet(n => ({ ...n, ssh_timeout_secs: Number(v) }))}
        />
        <InputRow
          label="Intervalle de rafraîchissement Proxmox (secondes)"
          type="number"
          min={5}
          max={300}
          value={net.proxmox_poll_interval_secs}
          onChange={v => setNet(n => ({ ...n, proxmox_poll_interval_secs: Number(v) }))}
        />
        <InputRow
          label="Timeout API Proxmox (secondes)"
          type="number"
          min={2}
          max={60}
          value={net.proxmox_timeout_secs}
          onChange={v => setNet(n => ({ ...n, proxmox_timeout_secs: Number(v) }))}
        />
        <ToggleRow
          label="Monitoring des ressources"
          description="Collecte CPU / RAM / disques des serveurs en ligne via SSH"
          checked={net.metrics_enabled}
          onChange={v => setNet(n => ({ ...n, metrics_enabled: v }))}
        />
        <InputRow
          label="Intervalle du monitoring (secondes)"
          type="number"
          min={5}
          max={300}
          value={net.metrics_interval_secs}
          onChange={v => setNet(n => ({ ...n, metrics_interval_secs: Number(v) }))}
        />
      </div>
      <button
        onClick={handleSave}
        className="px-4 py-2 text-sm bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150"
      >
        Sauvegarder
      </button>
    </div>
  );
}

// ── Section : Configuration (Export / Import / Reset) ─────────────────────────
function SectionConfig() {
  const { exportFullConfig, importFullConfig, applyImportConfig, resetSettings, pendingImport } = useStore();
  const { success, error } = useToast();
  const [dataPath, setDataPath] = useState('');
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmReplace, setShowConfirmReplace] = useState(false);

  // Récupérer le chemin du fichier de données au montage
  useEffect(() => {
    invoke<string>('get_data_path').then(setDataPath).catch(() => {});
  }, []);

  const handleExport = async () => {
    try {
      const path = await exportFullConfig();
      success(`Exporté : ${path}`);
    } catch (e) {
      // Ne pas afficher d'erreur si l'utilisateur a annulé la boîte de dialogue
      if (!String(e).includes('annulé')) error(String(e));
    }
  };

  const handleImport = async () => {
    try {
      await importFullConfig();
    } catch (e) {
      if (!String(e).includes('annulé')) error(String(e));
    }
  };

  const handleApplyImport = async (mode: 'merge' | 'replace') => {
    try {
      await applyImportConfig(mode);
      success('Configuration importée');
    } catch (e) {
      error(String(e));
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">Configuration</h2>

      {/* Boutons Export / Import */}
      <div className="space-y-3">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary
                       rounded-win hover:bg-bg-hover transition-colors duration-150"
          >
            <Download size={14} /> Exporter la configuration
          </button>
          <button
            onClick={handleImport}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-bg-active text-text-primary
                       rounded-win hover:bg-bg-hover transition-colors duration-150"
          >
            <Upload size={14} /> Importer une configuration
          </button>
        </div>

        {/* Récapitulatif de l'import en attente */}
        {pendingImport && (
          <div className="bg-bg-tertiary rounded-win p-4 space-y-3 text-sm card border border-border-primary">
            <p className="text-text-primary font-medium">Récapitulatif de l'import</p>
            <div className="text-text-secondary space-y-1 text-xs">
              <p>Version : <span className="text-text-primary">{pendingImport.config_version}</span></p>
              <p>Serveurs : <span className="text-text-primary">{pendingImport.servers_count}</span></p>
              <p>Groupes : <span className="text-text-primary">{pendingImport.groups_count}</span></p>
              <p>Tags et dossiers : <span className="text-text-primary">{pendingImport.tags_count ?? 0} / {pendingImport.folders_count ?? 0}</span></p>
              <p>Paramètres : <span className="text-text-primary">{pendingImport.settings_present ? 'inclus' : 'non inclus'}</span></p>
              {pendingImport.exported_at && (
                <p>Exporté le : <span className="text-text-primary">{pendingImport.exported_at}</span></p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {/* Fusion : ajoute sans écraser */}
              <button
                onClick={() => handleApplyImport('merge')}
                className="px-3 py-1.5 text-xs bg-accent-primary text-white rounded-win hover:bg-accent-secondary transition-colors duration-150"
              >
                Fusion
              </button>
              {/* Remplacement : confirmation requise */}
              <button
                onClick={() => setShowConfirmReplace(true)}
                className="px-3 py-1.5 text-xs bg-bg-active text-accent-error rounded-win hover:bg-bg-hover transition-colors duration-150"
              >
                Remplacement
              </button>
              {/* Ignorer : efface le pendingImport */}
              <button
                onClick={() => handleApplyImport('merge').then(() => {}).catch(() => {})}
                className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary transition-colors duration-150"
              >
                Ignorer
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Chemin du fichier de données */}
      <div className="space-y-1">
        <p className="text-text-secondary text-xs">Fichier de données</p>
        <div className="flex gap-2 items-center">
          <code className="text-text-muted text-xs bg-bg-input px-2 py-1.5 rounded flex-1 truncate font-mono">
            {dataPath || 'Chargement...'}
          </code>
          <button
            onClick={() => navigator.clipboard.writeText(dataPath)}
            className="p-1.5 rounded bg-bg-active hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors duration-150"
            title="Copier"
          >
            <Copy size={12} />
          </button>
        </div>
      </div>

      {/* Réinitialisation des paramètres */}
      <div className="pt-2">
        <button
          onClick={() => setShowConfirmReset(true)}
          className="px-3 py-2 text-sm text-accent-error bg-bg-active rounded-win
                     hover:bg-bg-hover transition-colors duration-150"
        >
          Réinitialiser les paramètres
        </button>
      </div>

      {/* Dialogs de confirmation */}
      {showConfirmReset && (
        <ConfirmDialog
          title="Réinitialiser les paramètres"
          message="Les paramètres d'apparence, de réseau et généraux seront remis aux valeurs par défaut. Les serveurs et groupes ne sont pas affectés."
          onConfirm={async () => {
            await resetSettings();
            setShowConfirmReset(false);
            success('Paramètres réinitialisés');
          }}
          onCancel={() => setShowConfirmReset(false)}
        />
      )}
      {showConfirmReplace && (
        <ConfirmDialog
          title="Remplacer la configuration"
          message="Toute la configuration actuelle (serveurs, groupes, paramètres, tags et dossiers) sera remplacée. Cette action est irréversible."
          dangerous
          onConfirm={async () => {
            await handleApplyImport('replace');
            setShowConfirmReplace(false);
          }}
          onCancel={() => setShowConfirmReplace(false)}
        />
      )}
    </div>
  );
}

// ── Section : À propos ─────────────────────────────────────────────────────────
function SectionAbout() {
  const { info, loadInfo } = useAppUpdate();
  useEffect(() => {
    if (!info) loadInfo();
  }, [info, loadInfo]);

  return (
    <div className="space-y-4 max-w-lg">
      <h2 className="text-text-primary font-medium text-base">À propos</h2>
      <div className="bg-bg-tertiary rounded-win p-4 space-y-2 text-sm card">
        <div className="flex justify-between py-1 border-b border-border-secondary">
          <span className="text-text-secondary">Version</span>
          <span className="text-text-primary">{info?.current_version ?? '…'}</span>
        </div>
        <div className="flex justify-between py-1 border-b border-border-secondary">
          <span className="text-text-secondary">Framework</span>
          <span className="text-text-primary">Tauri v2 + React 18 + Rust</span>
        </div>
        <div className="flex justify-between py-1 border-b border-border-secondary">
          <span className="text-text-secondary">Chiffrement</span>
          <span className="text-text-primary">AES-256-GCM</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-text-secondary">Stockage</span>
          <span className="text-text-primary">JSON local (AppData)</span>
        </div>
      </div>
    </div>
  );
}
