/**
 * Which provider each AI model belongs to.
 *
 * The microservice enforces this too - aiService rejects a mismatched pairing
 * before a run starts - so this exists to keep the model list in the
 * configuration UI showing only what the selected provider can actually run.
 *
 * Kept deliberately parallel to
 * ai-commerce-accelerator-microservice/utils/modelCatalog.cjs. The two cannot
 * share a module because they are separate packages with different module
 * systems; modelCatalog.test.js asserts they stay in step.
 */
import { providerLabel } from './providerCapabilities';

/**
 * Fallback used when an entry carries no explicit `provider`, so that lists
 * seeded before that field existed keep working without a migration.
 */
export const PROVIDER_PATTERNS = [
  { provider: 'anthropic', pattern: /^claude[-.]/i },
  { provider: 'gemini', pattern: /^(gemini|imagen)[-.]/i },
  { provider: 'openai', pattern: /^(gpt[-.]|o\d)/i },
];

/**
 * The list shipped with this build, used when the AICAConfiguration entry is
 * missing. Mirrors ai-models.json in the frontend client extension, which the
 * Gradle generateBatchFiles task builds the batch seed from.
 */
export const DEFAULT_MODEL_OPTIONS = [
  { label: 'GPT-4o Mini', value: 'gpt-4o-mini', provider: 'openai' },
  { label: 'GPT-4o', value: 'gpt-4o', provider: 'openai' },
  { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini', provider: 'openai' },
  { label: 'Claude Opus 5', value: 'claude-opus-5', provider: 'anthropic' },
  { label: 'Claude Sonnet 5', value: 'claude-sonnet-5', provider: 'anthropic' },
  {
    label: 'Claude Haiku 4.5',
    value: 'claude-haiku-4-5',
    provider: 'anthropic',
  },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro', provider: 'gemini' },
  { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash', provider: 'gemini' },
];

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
 * The options a provider can actually run.
 *
 * Options whose provider cannot be resolved are kept rather than dropped: a
 * custom or self-hosted model an administrator added by hand would otherwise
 * disappear from the list the moment a provider is selected.
 */
export function modelsForProvider(options = [], provider) {
  const target = String(provider || '')
    .trim()
    .toLowerCase();
  if (!target) return [...options];

  return options.filter((option) => {
    const owner = modelProvider(option);
    return !owner || owner === target;
  });
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
