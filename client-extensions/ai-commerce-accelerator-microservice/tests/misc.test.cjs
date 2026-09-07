const { createERC, normalizeSpecificationKey } = require('../utils/misc.cjs');
const { estimateTokens } = require('../utils/tokenEstimator.cjs');

describe('Misc Utilities', () => {
  describe('createERC', () => {
    it('should generate unique ERCs even when called rapidly', () => {
      const erc1 = createERC('TEST');
      const erc2 = createERC('TEST');

      expect(erc1).not.toBe(erc2);
    });

    it('should include the provided prefix', () => {
      const prefix = 'MY-PREFIX';
      const erc = createERC(prefix);

      expect(erc.startsWith(prefix)).toBe(true);
    });

    it('should generate many unique ERCs', () => {
      const ercs = new Set();
      const count = 5000;

      for (let i = 0; i < count; i++) {
        ercs.add(createERC('TEST'));
      }

      expect(ercs.size).toBe(count);
    });
  });

  describe('estimateTokens', () => {
    it('should calculate tokens exactly using js-tiktoken for gpt models', () => {
      const text = 'hello world';
      const count = estimateTokens(text, 'gpt-4');
      expect(count).toBe(2);
    });

    it('should map gemini models to gpt-4o-mini and calculate successfully', () => {
      const text = 'hello world';
      const count = estimateTokens(text, 'gemini-1.5-pro');
      expect(count).toBe(2);
    });

    it('should fall back to heuristic estimation for unsupported models or errors', () => {
      const text = 'hello world standard estimation fallback';
      const count = estimateTokens(text, 'invalid-unsupported-model-name');
      expect(count).toBe(10);
    });
  });

  describe('normalizeSpecificationKey', () => {
    // Liferay looks a specification up by
    // FriendlyURLNormalizerUtil.normalize(specificationKey) but stores the key
    // verbatim when it creates one, so an un-normalized key is created raw,
    // never matched again, and re-created - which fails with
    // DuplicateCPSpecificationOptionKeyException.
    it("produces keys that are stable under Liferay's normalization", () => {
      const normalizeLikeLiferay = (value) =>
        String(value)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');

      for (const input of [
        'Frame_Material',
        'frameMaterial',
        'FRAMEMATERIAL',
        'Brand Name',
        'weight (kg)',
        'Screen  Size--',
      ]) {
        const key = normalizeSpecificationKey(input);
        expect(normalizeLikeLiferay(key)).toBe(key);
      }
    });

    it('is idempotent', () => {
      const once = normalizeSpecificationKey('Frame_Material');
      expect(normalizeSpecificationKey(once)).toBe(once);
      expect(once).toBe('frame-material');
    });

    it('falls back to a usable key for empty input', () => {
      expect(normalizeSpecificationKey('')).toBe('spec');
      expect(normalizeSpecificationKey(undefined)).toBe('spec');
      expect(normalizeSpecificationKey('!!!')).toBe('spec');
    });
  });
});
