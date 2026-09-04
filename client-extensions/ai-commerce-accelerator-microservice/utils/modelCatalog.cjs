/**
 * Which provider each AI model belongs to, and the single wording used wherever
 * a provider/model mismatch is reported.
 *
 * The model list is runtime data: it is seeded by the batch client extension
 * into the AICAConfiguration entry AI-MODEL-OPTIONS and can be edited in the
 * configuration UI afterwards. Entries therefore may or may not carry an
 * explicit `provider`, and an administrator may add a model this build has
 * never heard of. These helpers resolve a provider from whatever is available
 * and stay silent when they cannot tell.
 */
const { providerLabel } = require('./providerCapabilities.cjs');

/**
 * Fallback used when an entry carries no explicit `provider`, so that lists
 * seeded before that field existed keep working without a migration.
 */
const PROVIDER_PATTERNS = [
  { provider: 'anthropic', pattern: /^claude[-.]/i },
  { provider: 'gemini', pattern: /^(gemini|imagen)[-.]/i },
  { provider: 'openai', pattern: /^(gpt[-.]|o\d)/i },
];

function inferProvider(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return null;

  const match = PROVIDER_PATTERNS.find(({ pattern }) => pattern.test(id));
  return match ? match.provider : null;
}

/**
 * The provider an option belongs to: the explicit field when present, the
 * inferred one otherwise, or null when neither is available.
 */
function modelProvider(option) {
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
function modelsForProvider(options = [], provider) {
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
 *
 * Silence is deliberate for unrecognised models. Blocking anything this build
 * does not recognise would reject custom entries that would have worked, so the
 * check only fires when the model is confidently attributed elsewhere.
 */
function modelProviderIssue(provider, modelId, options = []) {
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
 * The list shipped with this build, used when the AICAConfiguration entry is
 * missing or unreadable.
 *
 * Kept in step with ai-models.json in the frontend client extension - the file
 * the Gradle generateBatchFiles task builds the batch seed from - by
 * tests/modelCatalog.test.cjs, so the two cannot drift apart silently.
 */
const DEFAULT_MODEL_OPTIONS = [
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

/**
 * The model to preselect for a provider: the current one when it already
 * belongs to that provider, otherwise that provider's first option.
 *
 * Returns null when the provider has no options at all, which the caller must
 * treat as "not configured" rather than substituting a foreign model.
 */
function defaultModelForProvider(options = [], provider, current) {
  const candidates = modelsForProvider(options, provider);
  if (current && candidates.some((option) => option?.value === current)) {
    return current;
  }
  const owned = candidates.find((option) => modelProvider(option));
  return (owned || candidates[0])?.value || null;
}

module.exports = {
  DEFAULT_MODEL_OPTIONS,
  PROVIDER_PATTERNS,
  defaultModelForProvider,
  inferProvider,
  modelProvider,
  modelProviderIssue,
  modelsForProvider,
};
