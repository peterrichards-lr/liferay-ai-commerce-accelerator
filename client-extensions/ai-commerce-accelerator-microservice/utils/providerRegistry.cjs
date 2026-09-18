/**
 * The one place an AI provider is declared.
 *
 * Provider identity used to be spread across roughly twenty-nine literals in
 * nine files - key patterns, environment variables, key families, display
 * labels, model-name patterns, image capability, a factory switch, a dropdown
 * and a catalogue display order - each edited by hand, several duplicated
 * between the microservice and the configuration UI. Adding a provider meant
 * finding all of them, and missing one failed silently: the provider simply
 * misbehaved in that one respect. See #635.
 *
 * Everything downstream is derived from the two tables below. Nothing else in
 * the codebase may name a provider.
 *
 * WHY THIS FILE LIVES HERE, AND IN COMMONJS
 *
 * The configuration client extension needs the same declaration, and the two
 * are separate packages with different module systems. It is not copied: the
 * configuration UI imports this exact file across the package boundary
 * (src/config/providerRegistry.js), because the microservice's
 * client-extension.yaml assembles only CommonJS files and package.json from its
 * own directory - a JSON file, an .mjs file, or a shared package anywhere else
 * in the repository would not be deployed with it. The configuration
 * extension ships as a pre-built bundle instead, so it can read source from
 * anywhere at build time. The side with the stricter packaging rule therefore
 * owns the file and the bundled side reads it, which is the only arrangement
 * that leaves exactly one copy.
 *
 * That is also why this module must stay free of Node built-ins and of any
 * reference to the provider adapters: it is bundled into a browser page, and
 * naming an adapter here would pull the Node-only AI SDKs in with it.
 */

/**
 * The credential families a key can be attributed to.
 *
 * A family is not a provider: Gemini and Nano Banana are both Google endpoints
 * and authenticate with the same key, so the family is what a key prefix
 * actually identifies.
 *
 * Order is significant. Anthropic is tested before OpenAI because an Anthropic
 * key is `sk-ant-...`, which also satisfies OpenAI's `sk-` prefix.
 */
const KEY_FAMILIES = [
  { id: 'anthropic', label: 'Anthropic', pattern: /^sk-ant-/ },
  { id: 'google', label: 'Google', pattern: /^AIza/ },
  { id: 'openai', label: 'OpenAI', pattern: /^sk-/ },
];

/**
 * Every provider this build knows about, declared once.
 *
 * Listed by id so the maps derived from it keep a stable, reviewable order.
 * Two orderings are carried explicitly because the product genuinely uses two
 * and they disagree; neither is derivable from the other:
 *
 * - `preferenceOrder` is the operator-facing order. It fills the Core AI
 *   Provider dropdown and decides which provider-specific environment variable
 *   resolveCoreKey prefers when several are set, which is the same question
 *   asked twice: which provider should an operator land on by default.
 * - `catalogueOrder` is the order scripts/refresh_ai_models.py groups the
 *   shipped model list into, and therefore the order of the model dropdown.
 *
 * `null` for either means the provider does not take part: Nano Banana is not
 * offered as a core provider and has no model catalogue to refresh.
 *
 * `capabilities` records what a provider's adapter actually *does*, not what
 * its vendor sells. Gemini's generateImage throws and Nano Banana's returned a
 * placeholder string, so neither is image-capable however many image models
 * Google publishes (#642).
 */
const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    keyFamily: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    modelPattern: /^claude[-.]/i,
    capabilities: { text: true, images: false },
    preferenceOrder: 2,
    catalogueOrder: 1,
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyFamily: 'google',
    envVar: 'GEMINI_API_KEY',
    modelPattern: /^(gemini|imagen)[-.]/i,
    capabilities: { text: true, images: false },
    preferenceOrder: 1,
    catalogueOrder: 2,
  },
  {
    id: 'nanobanana',
    // Declared with no capability at all, which is the honest record: it has an
    // adapter and a seeded list-type entry, and its generateImage produced
    // nothing usable. It is kept so a stored configuration naming it is still
    // recognised - labelled, attributed to a key family, and reported as unable
    // to generate images - rather than falling through as an unknown provider.
    label: 'Nano Banana',
    keyFamily: 'google',
    envVar: 'GEMINI_API_KEY',
    modelPattern: null,
    capabilities: { text: false, images: false },
    preferenceOrder: null,
    catalogueOrder: null,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    // The dropdown says which family of models it means; the message wording
    // elsewhere reads better without it.
    selectLabel: 'OpenAI (GPT)',
    keyFamily: 'openai',
    envVar: 'OPENAI_API_KEY',
    modelPattern: /^(gpt[-.]|o\d)/i,
    capabilities: { text: true, images: true },
    preferenceOrder: 0,
    catalogueOrder: 0,
  },
];

const byId = (value) =>
  Object.fromEntries(
    PROVIDERS.map((provider) => [provider.id, value(provider)])
  );

const PROVIDER_IDS = PROVIDERS.map((provider) => provider.id);

const PROVIDER_LABELS = byId((provider) => provider.label);

const PROVIDER_ENV_VARS = byId((provider) => provider.envVar);

const PROVIDER_KEY_FAMILY = byId((provider) => provider.keyFamily);

const FAMILY_LABELS = Object.fromEntries(
  KEY_FAMILIES.map((family) => [family.id, family.label])
);

const KEY_PATTERNS = KEY_FAMILIES.map(({ id, pattern }) => ({
  family: id,
  pattern,
}));

const PROVIDER_PATTERNS = PROVIDERS.filter(
  (provider) => provider.modelPattern
).map((provider) => ({
  provider: provider.id,
  pattern: provider.modelPattern,
}));

const IMAGE_CAPABLE_PROVIDERS = PROVIDERS.filter(
  (provider) => provider.capabilities.images
).map((provider) => provider.id);

/**
 * The providers an operator may choose as the Core AI Provider, in the order
 * they are offered.
 */
const TEXT_PROVIDERS = PROVIDERS.filter(
  (provider) => provider.preferenceOrder !== null && provider.capabilities.text
).sort((left, right) => left.preferenceOrder - right.preferenceOrder);

/**
 * The providers scripts/refresh_ai_models.py refreshes, in the order it groups
 * the shipped model list into.
 */
const CATALOGUE_PROVIDERS = PROVIDERS.filter(
  (provider) => provider.catalogueOrder !== null
).sort((left, right) => left.catalogueOrder - right.catalogueOrder);

/**
 * The provider a credential family belongs to.
 *
 * A family can be shared, so the answer is the first provider in it that can
 * actually serve as a core provider - which is what an unattributed key is
 * being resolved *for*. Nano Banana shares Google's family and generates no
 * text, so an AIza key resolves to Gemini.
 */
function providerForFamily(family) {
  const match = PROVIDERS.find(
    (provider) => provider.keyFamily === family && provider.capabilities.text
  );
  return match ? match.id : null;
}

const serialise = (entry) =>
  Object.fromEntries(
    Object.entries(entry).map(([key, value]) => [
      key,
      value instanceof RegExp
        ? { source: value.source, flags: value.flags }
        : value,
    ])
  );

/**
 * The declaration as plain JSON, for consumers that cannot execute it.
 *
 * scripts/refresh_ai_models.py reads this through `node -e` rather than keeping
 * its own provider list, which is what makes the display order derived rather
 * than a third copy. Every field is passed through, including ones added later,
 * so a new field on a declaration reaches Python without this needing to change.
 */
function registryAsJson() {
  return {
    keyFamilies: KEY_FAMILIES.map(serialise),
    providers: PROVIDERS.map(serialise),
  };
}

module.exports = {
  CATALOGUE_PROVIDERS,
  FAMILY_LABELS,
  IMAGE_CAPABLE_PROVIDERS,
  KEY_FAMILIES,
  KEY_PATTERNS,
  PROVIDERS,
  PROVIDER_ENV_VARS,
  PROVIDER_IDS,
  PROVIDER_KEY_FAMILY,
  PROVIDER_LABELS,
  PROVIDER_PATTERNS,
  TEXT_PROVIDERS,
  providerForFamily,
  registryAsJson,
};
