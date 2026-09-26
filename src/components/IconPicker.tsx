// src/components/IconPicker.tsx
import { useEffect, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Server, Database, HardDrive, Monitor, Cpu, Globe, Network,
  Shield, Box, Cloud, Layers, Terminal, Wifi, Zap,
  Archive, Landmark, Share2, Settings, Container, Boxes,
  Router, Cable, Radio, Satellite, ShieldCheck, Lock, BrickWall,
  Laptop, Tv, Smartphone, Tablet, Printer, Gamepad2, Camera,
  Code, Bot, Film, Music, Image, House, Mail, MessageSquare,
  Download, Bell, Power, Battery, Thermometer, Flame, Star, Heart,
  Flag, Rocket, Wrench, Leaf, Sun, Moon,
  HardDriveDownload, MemoryStick,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '../i18n';

// Catégories d'icônes avec groupes
interface IconGroup {
  category: string;
  icons: { name: string; Icon: LucideIcon }[];
}

// Map des icônes Lucide disponibles pour les serveurs, groupées par catégorie
const ICON_GROUPS: IconGroup[] = [
  {
    category: 'Serveurs & stockage',
    icons: [
      { name: 'Server',    Icon: Server },
      { name: 'Database',  Icon: Database },
      { name: 'HardDrive', Icon: HardDrive },
      { name: 'HardDriveDownload', Icon: HardDriveDownload },
      { name: 'Cpu',       Icon: Cpu },
      { name: 'MemoryStick', Icon: MemoryStick },
      { name: 'Archive',   Icon: Archive },
    ],
  },
  {
    category: 'Réseau',
    icons: [
      { name: 'Router',     Icon: Router },
      { name: 'Network',    Icon: Network },
      { name: 'Wifi',       Icon: Wifi },
      { name: 'Globe',      Icon: Globe },
      { name: 'Cable',      Icon: Cable },
      { name: 'Radio',      Icon: Radio },
      { name: 'Satellite',  Icon: Satellite },
      { name: 'Shield',     Icon: Shield },
      { name: 'ShieldCheck', Icon: ShieldCheck },
      { name: 'Lock',       Icon: Lock },
      { name: 'BrickWall',  Icon: BrickWall },
    ],
  },
  {
    category: 'Postes',
    icons: [
      { name: 'Monitor',   Icon: Monitor },
      { name: 'Laptop',    Icon: Laptop },
      { name: 'Tv',        Icon: Tv },
      { name: 'Smartphone', Icon: Smartphone },
      { name: 'Tablet',    Icon: Tablet },
      { name: 'Printer',   Icon: Printer },
      { name: 'Gamepad2',  Icon: Gamepad2 },
      { name: 'Camera',    Icon: Camera },
    ],
  },
  {
    category: 'Services',
    icons: [
      { name: 'Cloud',     Icon: Cloud },
      { name: 'Container', Icon: Container },
      { name: 'Boxes',     Icon: Boxes },
      { name: 'Box',       Icon: Box },
      { name: 'Layers',    Icon: Layers },
      { name: 'Terminal',  Icon: Terminal },
      { name: 'Code',      Icon: Code },
      { name: 'Bot',       Icon: Bot },
      { name: 'Film',      Icon: Film },
      { name: 'Music',     Icon: Music },
      { name: 'Image',     Icon: Image },
      { name: 'House',     Icon: House },
      { name: 'Mail',      Icon: Mail },
      { name: 'MessageSquare', Icon: MessageSquare },
      { name: 'Download',  Icon: Download },
      { name: 'Bell',      Icon: Bell },
    ],
  },
  {
    category: 'Divers',
    icons: [
      { name: 'Zap',      Icon: Zap },
      { name: 'Power',    Icon: Power },
      { name: 'Battery',  Icon: Battery },
      { name: 'Thermometer', Icon: Thermometer },
      { name: 'Flame',    Icon: Flame },
      { name: 'Star',     Icon: Star },
      { name: 'Heart',    Icon: Heart },
      { name: 'Flag',     Icon: Flag },
      { name: 'Rocket',   Icon: Rocket },
      { name: 'Wrench',   Icon: Wrench },
      { name: 'Settings', Icon: Settings },
      { name: 'Share2',   Icon: Share2 },
      { name: 'Landmark', Icon: Landmark },
      { name: 'Leaf',     Icon: Leaf },
      { name: 'Sun',      Icon: Sun },
      { name: 'Moon',     Icon: Moon },
    ],
  },
];

// Aplati en liste unique pour recherche / accès par nom
const LUCIDE_ICONS = ICON_GROUPS.flatMap(g => g.icons);

// Couleurs presets disponibles
const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#a855f7', // purple
  '#ec4899', // pink
];

interface Props {
  serverId: string;
  value: string | null;
  onChange: (icon: string | null) => void;
}

export function IconPicker({ serverId, value, onChange }: Props) {
  const { t } = useT();
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  // Parse current icon to extract color if present
  useEffect(() => {
    if (value?.startsWith('lucide:')) {
      const match = value.match(/#([0-9a-f]{6})$/i);
      if (match) {
        setSelectedColor(match[1].toLowerCase());
      } else {
        setSelectedColor(null);
      }
    }
  }, [value]);

  const handleFileUpload = async () => {
    try {
      setUploading(true);
      const selected = await open({
        filters: [{ name: t('iconPicker.fileFilter'), extensions: ['png', 'svg'] }],
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

  const handleIconSelect = (iconName: string) => {
    let finalIcon = `lucide:${iconName}`;
    if (selectedColor) {
      finalIcon += `#${selectedColor}`;
    }
    onChange(finalIcon);
    setShowPicker(false);
  };

  const handleColorSelect = (color: string) => {
    setSelectedColor(color.toLowerCase().replace('#', ''));
    // Update current icon with new color
    if (value?.startsWith('lucide:')) {
      const baseName = value.match(/^lucide:([^#]+)/)?.[1];
      if (baseName) {
        onChange(`lucide:${baseName}#${color.toLowerCase().replace('#', '')}`);
      }
    }
  };

  // Filter icons by search query
  const filteredIcons = ICON_GROUPS.map(group => ({
    ...group,
    icons: group.icons.filter(icon =>
      icon.name.toLowerCase().includes(searchQuery.toLowerCase())
    ),
  })).filter(group => group.icons.length > 0);

  if (!showPicker) {
    return (
      <button
        type="button"
        onClick={() => setShowPicker(true)}
        className="flex items-center gap-2 px-3 py-1.5 text-xs bg-bg-active
                   text-text-secondary rounded-win hover:bg-bg-hover transition-colors duration-150"
      >
        <ServerIconDisplay icon={value} size={14} />
        {value ? t('iconPicker.change') : t('iconPicker.choose')}
      </button>
    );
  }

  const baseIconValue = value?.match(/^lucide:([^#]+)/)?.[1];

  return (
    <div className="bg-bg-secondary rounded-win p-3 space-y-3 border border-border-primary">
      <input
        type="text"
        placeholder={t('iconPicker.search') || 'Search icons...'}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-2 py-1.5 text-xs bg-bg-active border border-border-primary rounded-win
                   text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-primary"
      />

      {/* Color picker */}
      <div className="space-y-1.5">
        <p className="text-text-secondary text-xs">{t('iconPicker.color') || 'Color'}</p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => handleColorSelect('')}
            className={[
              'px-2 py-1 rounded text-xs transition-colors duration-150',
              !selectedColor
                ? 'bg-accent-primary text-white'
                : 'bg-bg-active text-text-secondary hover:bg-bg-hover'
            ].join(' ')}
          >
            {t('iconPicker.default') || 'Default'}
          </button>
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => handleColorSelect(color)}
              className={[
                'w-6 h-6 rounded transition-all duration-150 border-2',
                selectedColor === color.toLowerCase().replace('#', '')
                  ? 'border-white shadow-lg'
                  : 'border-transparent hover:shadow'
              ].join(' ')}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      </div>

      {/* Icons grouped by category */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {filteredIcons.length === 0 ? (
          <p className="text-text-muted text-xs py-2">{t('iconPicker.noResults') || 'No icons found'}</p>
        ) : (
          filteredIcons.map((group) => (
            <div key={group.category}>
              <p className="text-text-secondary text-xs font-medium mb-1.5">{group.category}</p>
              <div className="grid grid-cols-10 gap-1.5">
                {group.icons.map(({ name, Icon }) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleIconSelect(name)}
                    title={name}
                    className={[
                      'p-1.5 rounded transition-colors duration-150',
                      baseIconValue === name
                        ? 'bg-accent-primary text-white'
                        : 'bg-bg-active text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    ].join(' ')}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleFileUpload}
          disabled={uploading}
          className="px-3 py-1.5 text-xs bg-bg-active text-text-secondary rounded-win
                     hover:bg-bg-hover transition-colors duration-150 disabled:opacity-50"
        >
          {uploading ? t('iconPicker.uploading') : t('iconPicker.custom')}
        </button>
        <button
          type="button"
          onClick={() => setShowPicker(false)}
          className="text-xs text-text-muted hover:text-text-primary transition-colors duration-150"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/**
 * Affiche l'icône courante d'un serveur : icône Lucide, fichier uploadé, ou icône par défaut.
 * Exporté pour utilisation dans ServerCard également.
 * Supporte: lucide:IconName, lucide:IconName#rrggbb, file:filename
 */
export function ServerIconDisplay({ icon, size = 16 }: { icon: string | null | undefined; size?: number }) {
  if (!icon) return <Server size={size} />;

  // Lucide icons with optional color: lucide:IconName or lucide:IconName#rrggbb
  if (icon.toLowerCase().startsWith('lucide:')) {
    // Extract icon name and color
    const match = icon.match(/^lucide:([^#]+)(?:#([0-9a-f]{6}))?$/i);
    if (match) {
      const iconName = match[1];
      const color = match[2];
      const found = LUCIDE_ICONS.find(i => i.name.toLowerCase() === iconName.toLowerCase());
      if (found) {
        return (
          <found.Icon
            size={size}
            style={color ? { color: `#${color}` } : undefined}
          />
        );
      }
    }
    // Unknown lucide name: fallback to Server icon instead of rendering raw string
    return <Server size={size} />;
  }

  if (icon.toLowerCase().startsWith('file:')) {
    return <UploadedIcon fileName={icon.replace(/^file:/i, '')} size={size} />;
  }

  // Rétrocompatibilité : icône texte/emoji (anything without lucide: or file: prefix)
  return <span style={{ fontSize: size }}>{icon}</span>;
}

/** Dossier des icônes (chemin absolu), résolu une seule fois pour toute l'app */
let iconsDirPromise: Promise<string> | null = null;
function iconsDir(): Promise<string> {
  iconsDirPromise ??= appDataDir().then((dir) => join(dir, 'icons'));
  return iconsDirPromise;
}

/**
 * Icône importée par l'utilisateur. Le protocole asset attend un chemin absolu
 * (http://asset.localhost/<chemin> sous Windows) : convertFileSrc construit la
 * bonne URL, limitée par le scope « $APPDATA/icons/** » de tauri.conf.json.
 */
function UploadedIcon({ fileName, size }: { fileName: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    iconsDir()
      .then((dir) => join(dir, fileName))
      .then((path) => alive && setSrc(convertFileSrc(path)))
      .catch(() => alive && setSrc(null));
    return () => { alive = false; };
  }, [fileName]);

  if (!src) return <Server size={size} />;
  return (
    <img
      src={src}
      width={size}
      height={size}
      className="rounded object-cover"
      style={{ width: size, height: size }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
}
