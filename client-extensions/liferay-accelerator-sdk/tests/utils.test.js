import { describe, it, expect, vi } from 'vitest';
const misc = require('../src/utils/misc.cjs');

describe('utils/misc', () => {
  describe('toERCPart', () => {
    it('should clean and uppercase strings', () => {
      expect(misc.toERCPart('Test-String')).toBe('TESTSTRING');
      expect(misc.toERCPart('   spaces  ')).toBe('SPACES');
      expect(misc.toERCPart('Special@#%Chars')).toBe('SPECIALCHARS');
    });

    it('should truncate to max length', () => {
      expect(misc.toERCPart('VERYLONGSTRING', 5)).toBe('VERYL');
    });

    it('should return NA for empty inputs', () => {
      expect(misc.toERCPart('')).toBe('NA');
      expect(misc.toERCPart(null)).toBe('NA');
    });
  });

  describe('sanitizeForERC', () => {
    it('should remove non-alphanumeric characters', () => {
      expect(misc.sanitizeForERC('Hello World!')).toBe('HELLOWORLD');
    });

    it('should preserve underscores if requested', () => {
      expect(misc.sanitizeForERC('A_B-C', { preserveUnderscore: true })).toBe(
        'A_BC'
      );
    });
  });

  describe('buildKeyedERC', () => {
    it('should construct an ERC with prefix, category, and key', () => {
      const erc = misc.buildKeyedERC({
        prefix: 'AICA',
        category: 'PRD',
        key: 'ITEM123',
        includeRandom: false,
      });
      expect(erc).toBe('AICA-PRD-ITEM12');
    });

    it('should include a random suffix by default', () => {
      const erc = misc.buildKeyedERC({
        prefix: 'AICA',
        category: 'PRD',
        key: 'ITEM123',
      });
      const parts = erc.split('-');
      expect(parts).toHaveLength(4);
      expect(parts[3]).toHaveLength(3);
    });
  });

  describe('createERC', () => {
    it('should generate a string starting with the prefix', () => {
      const erc = misc.createERC('MY-PFX');
      expect(erc.startsWith('MY-PFX-')).toBe(true);
    });

    it('should be unique across calls', () => {
      const erc1 = misc.createERC('A');
      const erc2 = misc.createERC('A');
      expect(erc1).not.toBe(erc2);
    });
  });

  describe('toI18n / fromI18n', () => {
    it('should convert string to object', () => {
      expect(misc.toI18n('Hello')).toEqual({ en_US: 'Hello' });
    });

    it('should extract string from object', () => {
      expect(misc.fromI18n({ en_US: 'Hello', es_ES: 'Hola' })).toBe('Hello');
      expect(misc.fromI18n({ es_ES: 'Hola' }, 'es_ES')).toBe('Hola');
    });
  });

  describe('parseDataUrl', () => {
    it('should parse valid data URLs', () => {
      const input =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BfAAAACQBXRhMzCAAAAABJRU5ErkJggg==';
      const result = misc.parseDataUrl(input);
      expect(result.contentType).toBe('image/png');
      expect(result.base64).toBeDefined();
    });

    it('should parse plain base64 strings', () => {
      const input = 'SGVsbG8gV29ybGQ=';
      const result = misc.parseDataUrl(input);
      expect(result.contentType).toBe('application/octet-stream');
      expect(result.base64).toBe('SGVsbG8gV29ybGQ=');
    });
  });

  describe('normalizeNumber', () => {
    it('should clamp numbers within range', () => {
      expect(misc.normalizeNumber(10, { min: 20 })).toBe(20);
      expect(misc.normalizeNumber(50, { max: 40 })).toBe(40);
      expect(misc.normalizeNumber(30, { min: 20, max: 40 })).toBe(30);
    });

    it('should return default value for non-numbers', () => {
      expect(misc.normalizeNumber('abc', { defaultValue: 5 })).toBe(5);
    });
  });
});
