/**
 * Which providers can generate images.
 *
 * Anthropic Claude generates data only. The microservice enforces this too -
 * anthropicProvider.generateImage throws - so this list exists to catch the
 * combination before a run starts rather than midway through one.
 */
export const IMAGE_CAPABLE_PROVIDERS = ['openai', 'gemini', 'nanobanana'];

export const INHERIT = 'inherit';

export function canGenerateImages(provider) {
  return IMAGE_CAPABLE_PROVIDERS.includes(String(provider || '').toLowerCase());
}

/**
 * The provider that will actually be asked for images, resolving `inherit`.
 */
export function resolveMediaProvider(coreProvider, mediaProvider) {
  return !mediaProvider || mediaProvider === INHERIT
    ? coreProvider
    : mediaProvider;
}

/**
 * Returns a message when the configuration cannot produce images, or null when
 * it can. The same wording is used by the microservice at startup and at
 * generation time, so the fix reads identically wherever it is encountered.
 */
export function mediaProviderIssue(coreProvider, mediaProvider) {
  const effective = resolveMediaProvider(coreProvider, mediaProvider);
  if (canGenerateImages(effective)) return null;

  return `${providerLabel(effective)} cannot generate images. Select a dedicated Media Provider (OpenAI DALL·E or Nano Banana), or set image generation to none.`;
}

export function providerLabel(provider) {
  switch (String(provider || '').toLowerCase()) {
    case 'anthropic':
      return 'Anthropic Claude';
    case 'openai':
      return 'OpenAI';
    case 'gemini':
      return 'Google Gemini';
    case 'nanobanana':
      return 'Nano Banana';
    default:
      return provider || 'The selected provider';
  }
}
