/**
 * Which providers can generate images, and the single wording used wherever
 * that constraint is reported.
 *
 * Anthropic Claude generates data only. anthropicProvider.generateImage throws,
 * but that happens midway through a run; these helpers let the same condition
 * be reported at configuration time and at startup instead.
 */
const IMAGE_CAPABLE_PROVIDERS = ['openai', 'gemini', 'nanobanana'];
const INHERIT = 'inherit';

const PROVIDER_LABELS = {
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  nanobanana: 'Nano Banana',
  openai: 'OpenAI',
};

function providerLabel(provider) {
  const key = String(provider || '').toLowerCase();
  return PROVIDER_LABELS[key] || provider || 'The selected provider';
}

function canGenerateImages(provider) {
  return IMAGE_CAPABLE_PROVIDERS.includes(String(provider || '').toLowerCase());
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
  )} cannot generate images. Select a dedicated Media Provider (OpenAI DALL-E or Nano Banana), or set image generation to none.`;
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
  mediaProviderIssue,
  providerLabel,
  resolveMediaProvider,
};
