const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
  inferProvider,
  modelProvider,
  modelProviderIssue,
  modelsForProvider,
} = require('../utils/modelCatalog.cjs');

// A fixed list for testing the functions themselves.
//
// Behaviour tests used to run against DEFAULT_MODEL_OPTIONS, which made them
// assertions about whichever models happened to ship. The scheduled refresh
// then failed for doing its job: it added gemini-3.x entries and the suite
// broke, because a test expected gemini's first option to be gemini-2.5-pro.
// Nothing was wrong with the code or with the new models.
//
// So the two kinds of assertion are now separate. Function behaviour is tested
// against this fixture and cannot be disturbed by a refresh; the shipped list
// is tested for its invariants - well-formed entries, every provider
// represented, the mirrors agreeing - which stay true whatever the models are.
const FIXTURE = [
  { label: 'Alpha One', value: 'gpt-alpha-1', provider: 'openai' },
  { label: 'Alpha Mini', value: 'gpt-alpha-1-mini', provider: 'openai' },
  { label: 'Beta One', value: 'claude-beta-1', provider: 'anthropic' },
  { label: 'Gamma Pro', value: 'gemini-gamma-pro', provider: 'gemini' },
  { label: 'Gamma Flash', value: 'gemini-gamma-flash', provider: 'gemini' },
];

// The generation source, not the generated batch file: the Gradle
// generateBatchFiles task deletes 19-object-entry-ai-model-options before
// recreating it from this, so the batch file is absent partway through a build.
const SOURCE_PATH = path.join(
  __dirname,
  '../../ai-commerce-accelerator-frontend/src/config/ai-models.json'
);

const expectStrictEqual = (actual, expected) => expect(actual).toBe(expected);
const expectDeepEqual = (actual, expected) => expect(actual).toEqual(expected);
const expectMatch = (actual, re) => expect(actual).toMatch(re);
const expectOk = (actual, message) => expect(actual, message).toBeTruthy();

describe('modelCatalog', () => {
  describe('inferProvider', () => {
    it('attributes each shipped model to its provider', () => {
      expectStrictEqual(inferProvider('claude-opus-5'), 'anthropic');
      expectStrictEqual(inferProvider('gpt-4o-mini'), 'openai');
      expectStrictEqual(inferProvider('o3-mini'), 'openai');
      expectStrictEqual(inferProvider('gemini-2.5-pro'), 'gemini');
    });

    it('returns null for a model it cannot attribute', () => {
      expectStrictEqual(inferProvider('my-self-hosted-llm'), null);
      expectStrictEqual(inferProvider(''), null);
      expectStrictEqual(inferProvider(undefined), null);
    });
  });

  describe('modelProvider', () => {
    it('prefers the explicit field over inference', () => {
      // A deliberately contradictory entry: the field wins, so an operator can
      // point a proxied model at whichever provider actually serves it.
      expectStrictEqual(
        modelProvider({ value: 'gpt-4o', provider: 'anthropic' }),
        'anthropic'
      );
    });

    it('falls back to inference for entries seeded without the field', () => {
      expectStrictEqual(modelProvider({ value: 'claude-opus-5' }), 'anthropic');
    });
  });

  describe('modelsForProvider', () => {
    it('returns only that provider models', () => {
      expectDeepEqual(
        modelsForProvider(FIXTURE, 'gemini').map((m) => m.value),
        ['gemini-gamma-pro', 'gemini-gamma-flash']
      );
    });

    it('keeps unattributable custom entries visible', () => {
      const options = [...FIXTURE, { value: 'custom-llm' }];
      expectOk(
        modelsForProvider(options, 'anthropic').some(
          (m) => m.value === 'custom-llm'
        )
      );
    });

    it('returns everything when no provider is given', () => {
      expectStrictEqual(modelsForProvider(FIXTURE, '').length, FIXTURE.length);
    });
  });

  describe('modelProviderIssue', () => {
    it('reports a cross-provider pairing', () => {
      const issue = modelProviderIssue('anthropic', 'gpt-alpha-1', FIXTURE);
      expectMatch(issue, /Anthropic Claude cannot run/);
      expectMatch(issue, /gpt-alpha-1/);
      expectMatch(issue, /OpenAI/);
    });

    it('stays silent on a matching pairing', () => {
      expectStrictEqual(
        modelProviderIssue('anthropic', 'claude-beta-1', FIXTURE),
        null
      );
    });

    it('stays silent on a model it cannot attribute', () => {
      // Blocking anything unrecognised would reject custom entries that work.
      expectStrictEqual(
        modelProviderIssue('anthropic', 'my-self-hosted-llm', []),
        null
      );
    });

    it('stays silent when either side is missing', () => {
      expectStrictEqual(modelProviderIssue('', 'gpt-4o', []), null);
      expectStrictEqual(modelProviderIssue('openai', '', []), null);
    });
  });

  describe('defaultModelForProvider', () => {
    it('keeps a model that already belongs to the provider', () => {
      expectStrictEqual(
        defaultModelForProvider(FIXTURE, 'openai', 'gpt-alpha-1-mini'),
        'gpt-alpha-1-mini'
      );
    });

    it('replaces a model belonging to another provider', () => {
      expectStrictEqual(
        defaultModelForProvider(FIXTURE, 'gemini', 'gpt-alpha-1'),
        'gemini-gamma-pro'
      );
    });

    it('returns null when the provider has no models', () => {
      expectStrictEqual(defaultModelForProvider(FIXTURE, 'nanobanana'), null);
    });
  });

  describe('the shipped list', () => {
    it('matches ai-models.json, the batch generation source', () => {
      const source = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
      expectDeepEqual(source, DEFAULT_MODEL_OPTIONS);
    });

    it('covers every provider that can generate text', () => {
      // gemini was absent from the list for several releases while being a
      // selectable provider, which guaranteed a mismatched model.
      for (const provider of ['openai', 'anthropic', 'gemini']) {
        expectOk(
          modelsForProvider(DEFAULT_MODEL_OPTIONS, provider).length > 0,
          `no models available for ${provider}`
        );
      }
    });

    it('attributes every entry explicitly', () => {
      for (const option of DEFAULT_MODEL_OPTIONS) {
        expectOk(option.provider, `${option.value} has no provider`);
        expectStrictEqual(
          option.provider,
          inferProvider(option.value),
          `${option.value} provider disagrees with its id`
        );
      }
    });
  });
});
