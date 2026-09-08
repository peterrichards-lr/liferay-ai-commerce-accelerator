const {
  aiImagesRequested,
  canGenerateImages,
  mediaProviderIssue,
  providerLabel,
  resolveMediaProvider,
} = require('../utils/providerCapabilities.cjs');

describe('provider capabilities', () => {
  describe('canGenerateImages', () => {
    it.each(['openai', 'OpenAI'])('accepts %s', (provider) =>
      expect(canGenerateImages(provider)).toBe(true)
    );

    // A provider belongs on the list when its generateImage returns an image,
    // not when its vendor has a model that could. Both of these were listed
    // and neither can: nanobanana returned the literal string
    // BASE64_PLACEHOLDER_FOR_NANOBANANA and gemini throws 'not supported yet'.
    // See #642.
    it.each(['gemini', 'nanobanana'])(
      'rejects %s, whose generateImage does not produce an image',
      (provider) => expect(canGenerateImages(provider)).toBe(false)
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
      expect(issue).toMatch(/OpenAI/);
    });

    // It used to recommend "OpenAI DALL-E or Nano Banana": a retired model,
    // and a provider that returns a placeholder string. Recommending
    // something unusable is worse than saying nothing.
    it('recommends nothing it cannot deliver', () => {
      const issue = mediaProviderIssue('anthropic', 'inherit');
      expect(issue).not.toMatch(/DALL/i);
      expect(issue).not.toMatch(/Nano Banana/i);
      expect(issue).not.toMatch(/Gemini/i);
    });

    it('accepts Claude with a dedicated media provider that works', () => {
      expect(mediaProviderIssue('anthropic', 'openai')).toBeNull();
    });

    it('flags Claude pointed at a provider that cannot generate images', () => {
      expect(mediaProviderIssue('anthropic', 'nanobanana')).toMatch(
        /cannot generate images/
      );
      expect(mediaProviderIssue('anthropic', 'gemini')).toMatch(
        /cannot generate images/
      );
    });

    it('accepts an image-capable core provider inheriting', () => {
      expect(mediaProviderIssue('openai', 'inherit')).toBeNull();
    });

    it('flags a core provider that cannot generate images inheriting', () => {
      expect(mediaProviderIssue('gemini', 'inherit')).toMatch(
        /cannot generate images/
      );
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
