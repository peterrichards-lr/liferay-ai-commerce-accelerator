/**
 * Which providers can generate images.
 *
 * Anthropic Claude generates data only. The microservice enforces this too -
 * anthropicProvider.generateImage throws - so this exists to catch the
 * combination before a run starts rather than midway through one.
 *
 * The capability is declared on the provider in providerRegistry.js, which is
 * the microservice's declaration imported rather than copied. A provider is
 * image-capable there when its generateImage returns an image, not when its
 * vendor has a model that could: nanobanana returned a placeholder string and
 * gemini throws 'not supported yet', so neither qualifies (#642).
 */
import { IMAGE_CAPABLE_PROVIDERS, PROVIDER_LABELS } from './providerRegistry';

export { IMAGE_CAPABLE_PROVIDERS };

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
 *
 * The providers it recommends are derived from the same capability flag the
 * check itself uses, so the advice cannot outlive the capability. It did once:
 * it named DALL-E, a retired model, and Nano Banana, which produces nothing.
 */
export function mediaProviderIssue(coreProvider, mediaProvider) {
  const effective = resolveMediaProvider(coreProvider, mediaProvider);
  if (canGenerateImages(effective)) return null;

  return `${providerLabel(effective)} cannot generate images. Select a dedicated Media Provider (${IMAGE_CAPABLE_PROVIDERS.map(providerLabel).join(', ')}), or set image generation to none.`;
}

export function providerLabel(provider) {
  const key = String(provider || '').toLowerCase();
  return PROVIDER_LABELS[key] || provider || 'The selected provider';
}
