const {
  aiImagesRequested,
  canGenerateImages,
  mediaProviderIssue,
  providerLabel,
  resolveMediaProvider,
} = require('../utils/providerCapabilities.cjs');

describe('provider capabilities', () => {
  describe('canGenerateImages', () => {
    it.each(['openai', 'gemini', 'nanobanana', 'OpenAI'])(
      'accepts %s',
      (provider) => expect(canGenerateImages(provider)).toBe(true)
    );

    it.each(['anthropic', 'Anthropic', undefined, ''])(
      'rejects %s',
      (provider) => expect(canGenerateImages(provider)).toBe(false)
    );
  });

  describe('resolveMediaProvider', () => {
    it('resolves inherit to the core provider', () => {
      expect(resolveMediaProvider('anthropic', 'inherit')).toBe('anthropic');
    });

    it('treats an unset media provider as inherit', () => {
      expect(resolveMediaProvider('openai', undefined)).toBe('openai');
    });

    it('uses an explicit media provider over the core one', () => {
      expect(resolveMediaProvider('anthropic', 'nanobanana')).toBe(
        'nanobanana'
      );
    });
  });

  describe('mediaProviderIssue', () => {
    it('flags Claude inheriting media, which cannot produce images', () => {
      const issue = mediaProviderIssue('anthropic', 'inherit');
      expect(issue).toMatch(/Anthropic Claude cannot generate images/);
      expect(issue).toMatch(/OpenAI DALL-E or Nano Banana/);
    });

    it('accepts Claude with a dedicated media provider', () => {
      expect(mediaProviderIssue('anthropic', 'openai')).toBeNull();
      expect(mediaProviderIssue('anthropic', 'nanobanana')).toBeNull();
    });

    it('accepts an image-capable core provider inheriting', () => {
      expect(mediaProviderIssue('openai', 'inherit')).toBeNull();
      expect(mediaProviderIssue('gemini', 'inherit')).toBeNull();
    });
  });

  describe('aiImagesRequested', () => {
    it('is true only for the ai image mode', () => {
      expect(aiImagesRequested('ai', false)).toBe(true);
    });

    it('is false in demo mode, which uses placeholders', () => {
      expect(aiImagesRequested('ai', true)).toBe(false);
    });

    it.each(['none', 'picsum', 'placeholder', 'default', 'custom', undefined])(
      'is false for %s, which needs no provider',
      (mode) => expect(aiImagesRequested(mode, false)).toBe(false)
    );
  });

  describe('providerLabel', () => {
    it('gives readable names for the message', () => {
      expect(providerLabel('anthropic')).toBe('Anthropic Claude');
      expect(providerLabel('nanobanana')).toBe('Nano Banana');
    });

    it('falls back rather than rendering undefined', () => {
      expect(providerLabel(undefined)).toBe('The selected provider');
    });
  });
});
