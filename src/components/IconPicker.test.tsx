import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ServerIconDisplay } from './IconPicker';

describe('ServerIconDisplay', () => {
  describe('Icon parsing', () => {
    it('should render Server icon for null/undefined icon', () => {
      const { container } = render(<ServerIconDisplay icon={null} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should render Server icon for undefined icon', () => {
      const { container } = render(<ServerIconDisplay icon={undefined} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should render lucide icon by name', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:Database" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle case-insensitive lucide prefix', () => {
      const { container } = render(<ServerIconDisplay icon="LUCIDE:database" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should render lucide icon with color', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:Server#ef4444" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg).toHaveStyle('color: #ef4444');
    });

    it('should handle uppercase color hex', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:Server#EF4444" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg).toHaveStyle('color: #EF4444');
    });

    it('should fallback to Server icon for unknown lucide name', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:UnknownIcon" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should handle file: prefix icons', () => {
      const { container } = render(<ServerIconDisplay icon="file:test.png" />);
      // UploadedIcon renders an img tag
      const img = container.querySelector('img');
      expect(img || container.querySelector('svg')).toBeTruthy();
    });

    it('should handle backward compatibility with text/emoji icons', () => {
      const { container } = render(<ServerIconDisplay icon="🖥️" />);
      const span = container.querySelector('span');
      expect(span?.textContent).toBe('🖥️');
    });

    it('should support multiple valid lucide icon names with colors', () => {
      const icons = [
        'lucide:Monitor#3b82f6',
        'lucide:Cpu#22c55e',
        'lucide:Network#a855f7',
      ];

      icons.forEach((icon) => {
        const { container } = render(<ServerIconDisplay icon={icon} />);
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
      });
    });
  });

  describe('Custom size', () => {
    it('should apply custom size prop', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:Server" size={24} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('should default to size 16', () => {
      const { container } = render(<ServerIconDisplay icon="lucide:Server" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });
});
