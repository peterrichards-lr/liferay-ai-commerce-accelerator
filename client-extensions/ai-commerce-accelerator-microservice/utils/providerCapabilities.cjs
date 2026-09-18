/**
 * Which providers can generate images, and the single wording used wherever
 * that constraint is reported.
 *
 * Anthropic Claude generates data only. anthropicProvider.generateImage throws,
 * but that happens midway through a run; these helpers let the same condition
 * be reported at configuration time and at startup instead.
 *
 * The capability itself is declared on the provider in providerRegistry.cjs. A
 * provider is image-capable there when its generateImage returns an image, not
 * when its vendor has a model that could: nanobanana returned the literal
 * string BASE64_PLACEHOLDER_FOR_NANOBANANA, and gemini throws 'Image generation
 * not supported yet for Gemini provider' (#642).
 *
 * This is NOT derived from the model catalogue, and must not become so. #637
 * proposed folding per-model output modality into it so the list could not go
 * stale; doing that would make gemini and nanobanana image-capable again on the
 * strength of image models their adapters cannot run, which is precisely the
 * regression #642 fixed. The two facts are different: modality is what a
 * vendor's model produces, capability is what this codebase's generateImage
 * returns. modelCatalog carries the first; this carries the second.
 */
const {
  IMAGE_CAPABLE_PROVIDERS,
  PROVIDER_LABELS,
} = require('./providerRegistry.cjs');

const INHERIT = 'inherit';

function providerLabel(provider) {
  const key = String(provider || '').toLowerCase();
  return PROVIDER_LABELS[key] || provider || 'The selected provider';
}

function canGenerateImages(provider) {
  return IMAGE_CAPABLE_PROVIDERS.includes(String(provider || '').toLowerCase());
}

/**
 * The providers the message may recommend. Derived rather than written out,
 * because it was written out and went stale: the advice named DALL-E, a retired
 * model, and Nano Banana, which produces nothing (#642).
 */
function imageCapableLabels() {
  return IMAGE_CAPABLE_PROVIDERS.map(providerLabel).join(', ');
}

/**
 * The provider that will actually be asked for images, resolving `inherit`.
 */
function resolveMediaProvider(coreProvider, mediaProvider) {
  const media = String(mediaProvider || INHERIT).toLowerCase();
  return media === INHERIT ? String(coreProvider || '').toLowerCase() : media;
}

/**
 * Returns a message when the configuration cannot produce images, or null when
 * it can.
 */
function mediaProviderIssue(coreProvider, mediaProvider) {
  const effective = resolveMediaProvider(coreProvider, mediaProvider);
  if (canGenerateImages(effective)) return null;

  return `${providerLabel(
    effective
  )} cannot generate images. Select a dedicated Media Provider (${imageCapableLabels()}), or set image generation to none.`;
}

/**
 * True only when the run asks the AI provider for images.
 *
 * imageMode also takes 'picsum', 'placeholder', 'default' and 'custom', none of
 * which call a provider, so the capability constraint does not apply to them -
 * blocking those would stop runs that would have worked.
 */
function aiImagesRequested(imageMode, demoMode) {
  return String(imageMode || 'none').toLowerCase() === 'ai' && !demoMode;
}

module.exports = {
  IMAGE_CAPABLE_PROVIDERS,
  canGenerateImages,
  aiImagesRequested,
  imageCapableLabels,
  mediaProviderIssue,
  providerLabel,
  resolveMediaProvider,
};
