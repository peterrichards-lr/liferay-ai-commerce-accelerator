import {
  canGenerateImages,
  mediaProviderIssue,
  resolveMediaProvider,
} from './providerCapabilities';

describe('configuration provider capabilities', () => {
  it('flags Claude inheriting media', () => {
    const issue = mediaProviderIssue('anthropic', 'inherit');
    expect(issue).toMatch(/Anthropic Claude cannot generate images/);
  });

  it('accepts Claude with a dedicated media provider', () => {
    expect(mediaProviderIssue('anthropic', 'nanobanana')).toBeNull();
  });

  it('accepts an image-capable core provider inheriting', () => {
    expect(mediaProviderIssue('openai', 'inherit')).toBeNull();
  });

  it('resolves inherit to the core provider', () => {
    expect(resolveMediaProvider('anthropic', 'inherit')).toBe('anthropic');
  });

  it('knows which providers can produce images', () => {
    expect(canGenerateImages('openai')).toBe(true);
    expect(canGenerateImages('anthropic')).toBe(false);
  });

  it('matches the microservice wording, so the fix reads the same in both', () => {
    // The two modules are deliberately parallel; if this drifts, a user sees a
    // different instruction in the UI than in the run that failed.
    expect(mediaProviderIssue('anthropic', 'inherit')).toMatch(
      /Select a dedicated Media Provider .*, or set image generation to none\./
    );
  });
});
