// src/components/IconPicker.tsx
import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Server, Database, HardDrive, Monitor, Cpu, Globe, Network,
  Shield, Box, Cloud, Layers, Terminal, Wifi, Zap,
  Archive, Landmark, Share2, Settings, Container, Boxes,
  type LucideIcon,
} from 'lucide-react';

// Map des icônes Lucide disponibles pour les serveurs
const LUCIDE_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'lucide:Server',    Icon: Server },
  { name: 'lucide:Database',  Icon: Database },
  { name: 'lucide:HardDrive', Icon: HardDrive },
  { name: 'lucide:Monitor',   Icon: Monitor },
  { name: 'lucide:Cpu',       Icon: Cpu },
  { name: 'lucide:Globe',     Icon: Globe },
  { name: 'lucide:Network',   Icon: Network },
  { name: 'lucide:Shield',    Icon: Shield },
  { name: 'lucide:Box',       Icon: Box },
  { name: 'lucide:Cloud',     Icon: Cloud },
  { name: 'lucide:Layers',    Icon: Layers },
  { name: 'lucide:Terminal',  Icon: Terminal },
  { name: 'lucide:Wifi',      Icon: Wifi },
  { name: 'lucide:Zap',       Icon: Zap },
  { name: 'lucide:Archive',   Icon: Archive },
  { name: 'lucide:Landmark',  Icon: Landmark },
  { name: 'lucide:Share2',    Icon: Share2 },
  { name: 'lucide:Settings',  Icon: Settings },
  { name: 'lucide:Container', Icon: Container },
  { name: 'lucide:Boxes',     Icon: Boxes },
];

interface Props {
  serverId: string;
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ serverId, value, onChange }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = async () => {
    try {
      setUploading(true);
      const selected = await open({
        filters: [{ name: 'Image', extensions: ['png', 'svg'] }],
        multiple: false,
      });
      if (!selected || typeof selected !== 'string') return;
      const fileName = await invoke<string>('upload_server_icon', {
        serverId,
        filePath: selected,
      });
      onChange(`file:${fileName}`);
      setShowPicker(false);
    } catch (e) {
      console.error('Upload failed:', e);
    } finally {
      setUploading(false);
    }
  };

  if (!showPicker) {
    return (
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-bg-active
                   text-text-secondary rounded-win hover:bg-bg-hover transition-colors duration-150"
      >
        <ServerIconDisplay icon={value} size={14} />
        {value ? "Changer l'icône" : 'Choisir une icône'}
      </button>
    );
  }

  return (
    <div className="bg-bg-secondary rounded-win p-3 space-y-3 border border-border-primary">
      <p className="text-text-secondary text-xs">Icône Lucide</p>
      <div className="grid grid-cols-10 gap-1.5">
        {LUCIDE_ICONS.map(({ name, Icon }) => (
          <button
            key={name}
            type="button"
            onClick={() => { onChange(name); setShowPicker(false); }}
            title={name.replace('lucide:', '')}
            className={[
              'p-1.5 rounded transition-colors duration-150',
              value === name
                ? 'bg-accent-primary text-white'
                : 'bg-bg-active text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            ].join(' ')}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleFileUpload}
          disabled={uploading}
          className="px-3 py-1.5 text-xs bg-bg-active text-text-secondary rounded-win
                     hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50"
        >
          {uploading ? 'Upload...' : 'Image personnalisée (PNG/SVG)'}
        </button>
        <button
          type="button"
          onClick={() => setShowPicker(false)}
          className="text-xs text-text-muted hover:text-text-primary transition-colors duration-150"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

/**
 * Affiche l'icône courante d'un serveur : icône Lucide, fichier uploadé, ou icône par défaut.
 * Exporté pour utilisation dans ServerCard également.
 */
export function ServerIconDisplay({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  if (!icon) return <Server size={size} />;

  if (icon.startsWith('lucide:')) {
    const name = icon.replace('lucide:', '');
    const found = LUCIDE_ICONS.find(i => i.name === `lucide:${name}`);
    if (found) return <found.Icon size={size} />;
  }

  if (icon.startsWith('file:')) {
    const fileName = icon.replace('file:', '');
    // Utilise le protocole asset:// pour accéder aux fichiers dans AppData
    return (
      <img
        src={`asset://localhost/icons/${fileName}`}
        width={size}
        height={size}
        className="rounded object-cover"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  // Rétrocompatibilité : icône texte/emoji
  return <span style={{ fontSize: size }}>{icon}</span>;
}
