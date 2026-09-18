/**
 * Which provider each AI model belongs to.
 *
 * The microservice enforces this too - aiService rejects a mismatched pairing
 * before a run starts - so this exists to keep the model list in the
 * configuration UI showing only what the selected provider can actually run.
 *
 * Kept deliberately parallel to
 * ai-commerce-accelerator-microservice/utils/modelCatalog.cjs, which holds the
 * same helpers for the run itself; modelCatalog.test.js asserts they stay in
 * step. The provider attribution they share is no longer duplicated - both read
 * the one declaration through providerRegistry.js.
 */
import { providerLabel } from './providerCapabilities';
import { IMAGE_MODEL_PATTERNS, PROVIDER_PATTERNS } from './providerRegistry';

export { IMAGE_MODEL_PATTERNS, PROVIDER_PATTERNS };

const TEXT = 'text';
const IMAGES = 'images';

/**
 * The list shipped with this build, used when the AICAConfiguration entry is
 * missing. Mirrors ai-models.json in the frontend client extension, which the
 * Gradle generateBatchFiles task builds the batch seed from.
 */
export const DEFAULT_MODEL_OPTIONS = [
  {
    label: 'GPT Live 1',
    value: 'gpt-live-1',
    provider: 'openai',
    tier: null,
    text: true,
    images: false,
  },
  {
    label: 'GPT-6 Astra',
    value: 'gpt-6-astra',
    provider: 'openai',
    tier: null,
    text: true,
    images: false,
  },
  {
    label: 'GPT-5.6 Luna',
    value: 'gpt-5.6-luna',
    provider: 'openai',
    tier: null,
    text: true,
    images: false,
  },
  {
    label: 'Claude Opus 5',
    value: 'claude-opus-5',
    provider: 'anthropic',
    tier: 'premium',
    text: true,
    images: false,
  },
  {
    label: 'Claude Sonnet 5',
    value: 'claude-sonnet-5',
    provider: 'anthropic',
    tier: 'mid',
    text: true,
    images: false,
  },
  {
    label: 'Claude Haiku 4.5',
    value: 'claude-haiku-4-5',
    provider: 'anthropic',
    tier: 'cheap',
    text: true,
    images: false,
  },
  {
    label: 'Gemini 3.8 Flash',
    value: 'gemini-3.8-flash',
    provider: 'gemini',
    tier: 'mid',
    text: true,
    images: false,
  },
  {
    label: 'Gemini 3.7 Flash',
    value: 'gemini-3.7-flash',
    provider: 'gemini',
    tier: 'mid',
    text: true,
    images: false,
  },
  {
    label: 'Gemini 3.6 Flash',
    value: 'gemini-3.6-flash',
    provider: 'gemini',
    tier: 'mid',
    text: true,
    images: false,
  },
];

/**
 * Attributes a model by name. Used when an entry carries no explicit
 * `provider`, so that lists seeded before that field existed keep working
 * without a migration.
 */
export function inferProvider(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return null;

  const match = PROVIDER_PATTERNS.find(({ pattern }) => pattern.test(id));
  return match ? match.provider : null;
}

/**
 * The provider an option belongs to: the explicit field when present, the
 * inferred one otherwise, or null when neither is available.
 */
export function modelProvider(option) {
  if (!option) return null;

  const explicit = String(option.provider || '')
    .trim()
    .toLowerCase();

  return explicit || inferProvider(option.value);
}

/**
 * What a model produces, read off its name, because no provider reports output
 * modality (#637). Returns null rather than a guess when the name says nothing.
 */
export function inferModality(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return null;

  return IMAGE_MODEL_PATTERNS.some(({ pattern }) => pattern.test(id))
    ? { text: false, images: true }
    : null;
}

const UNKNOWN_MODALITY = { text: null, images: null };

/**
 * The modality of an option: its explicit fields when it carries any, the
 * inferred one otherwise, and unknown - null on both - when neither answers.
 */
export function modelModality(option) {
  if (!option) return UNKNOWN_MODALITY;

  const declared = {
    text: typeof option.text === 'boolean' ? option.text : null,
    images: typeof option.images === 'boolean' ? option.images : null,
  };

  if (declared.text !== null || declared.images !== null) return declared;

  return inferModality(option.value) || UNKNOWN_MODALITY;
}

/**
 * Whether an option produces a named modality: true, false, or null when this
 * build cannot tell. A modality it does not recognise constrains nothing.
 */
function produces(option, modality) {
  const { text, images } = modelModality(option);
  if (modality === TEXT) return text;
  if (modality === IMAGES) return images;
  return null;
}

/**
 * The price tier an option was ranked into, or null when this build could not
 * rank it. See scripts/refresh_ai_models.py, which assigns it.
 */
export function modelTier(option) {
  const tier = String(option?.tier || '')
    .trim()
    .toLowerCase();
  return tier || null;
}

/**
 * The options a provider can actually run, for a given output modality.
 *
 * Options whose provider cannot be resolved are kept rather than dropped: a
 * custom or self-hosted model an administrator added by hand would otherwise
 * disappear from the list the moment a provider is selected. Modality is
 * treated the same way - an option is removed only when it is *known* not to
 * produce what was asked for.
 */
export function modelsForProvider(options = [], provider, modality = TEXT) {
  const target = String(provider || '')
    .trim()
    .toLowerCase();
  const wanted = String(modality || '')
    .trim()
    .toLowerCase();

  return options.filter((option) => {
    if (produces(option, wanted) === false) return false;
    if (!target) return true;

    const owner = modelProvider(option);
    return !owner || owner === target;
  });
}

/**
 * Returns a message when the model chosen for text generates images instead, or
 * null when it does not or cannot be judged.
 */
export function modelModalityIssue(modelId, options = []) {
  const id = String(modelId || '').trim();
  if (!id) return null;

  const listed = options.find((option) => option?.value === id);
  if (produces(listed || { value: id }, TEXT) !== false) return null;

  return `The model "${id}" generates images, not text, so it cannot serve as the Core AI Model. Select a model that generates text.`;
}

/**
 * Returns a message when the selected model belongs to a different provider, or
 * null when the pairing is fine or cannot be judged.
 */
export function modelProviderIssue(provider, modelId, options = []) {
  const target = String(provider || '')
    .trim()
    .toLowerCase();
  const id = String(modelId || '').trim();
  if (!target || !id) return null;

  const listed = options.find((option) => option?.value === id);
  const owner = listed ? modelProvider(listed) : inferProvider(id);
  if (!owner || owner === target) return null;

  return `${providerLabel(target)} cannot run the model "${id}", which belongs to ${providerLabel(
    owner
  )}. Select a model from ${providerLabel(
    target
  )}, or change the Core AI Provider.`;
}

/**
 * The model to preselect for a provider: the current one when it already
 * belongs to that provider, otherwise that provider's first option.
 */
export function defaultModelForProvider(options = [], provider, current) {
  const candidates = modelsForProvider(options, provider);
  if (current && candidates.some((option) => option?.value === current)) {
    return current;
  }
  const owned = candidates.find((option) => modelProvider(option));
  return (owned || candidates[0])?.value || null;
}
