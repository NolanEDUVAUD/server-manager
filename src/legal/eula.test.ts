import { describe, it, expect } from 'vitest';
import { eulaFr, eulaEn, EULA_VERSION } from './eula';

describe('EULA', () => {
  describe('French EULA', () => {
    it('should contain the key clause about forbidding monetization', () => {
      expect(eulaFr).toContain('INTERDICTIONS DE MONÉTISATION');
      expect(eulaFr).toContain('strictement interdite');
      expect(eulaFr).toContain('accord écrit');
      expect(eulaFr).toContain('préalable');
    });

    it('should contain section headers', () => {
      expect(eulaFr).toContain('ACCORD DE LICENCE UTILISATEUR FINAL');
      expect(eulaFr).toContain('LICENCE ET CONDITIONS');
      expect(eulaFr).toContain('UTILISATION PERSONNELLE');
      expect(eulaFr).toContain('LIMITATION DE RESPONSABILITÉ');
      expect(eulaFr).toContain('ACCEPTATION');
    });

    it('should have meaningful content', () => {
      expect(eulaFr.length).toBeGreaterThan(500);
    });
  });

  describe('English EULA', () => {
    it('should contain the key clause about forbidding monetization', () => {
      expect(eulaEn).toContain('MONETIZATION RESTRICTIONS');
      expect(eulaEn).toContain('strictly prohibited');
      expect(eulaEn).toContain('prior written');
      expect(eulaEn).toContain('agreement');
    });

    it('should contain section headers', () => {
      expect(eulaEn).toContain('END-USER LICENSE AGREEMENT');
      expect(eulaEn).toContain('LICENSE AND TERMS');
      expect(eulaEn).toContain('PERSONAL USE');
      expect(eulaEn).toContain('LIMITATION OF LIABILITY');
      expect(eulaEn).toContain('ACCEPTANCE');
    });

    it('should have meaningful content', () => {
      expect(eulaEn.length).toBeGreaterThan(500);
    });
  });

  describe('Version', () => {
    it('should have a defined version', () => {
      expect(EULA_VERSION).toBeDefined();
      expect(EULA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
