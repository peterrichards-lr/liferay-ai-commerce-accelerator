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
        modelsForProvider(DEFAULT_MODEL_OPTIONS, 'gemini').map((m) => m.value),
        ['gemini-2.5-pro', 'gemini-2.5-flash']
      );
    });

    it('keeps unattributable custom entries visible', () => {
      const options = [...DEFAULT_MODEL_OPTIONS, { value: 'custom-llm' }];
      expectOk(
        modelsForProvider(options, 'anthropic').some(
          (m) => m.value === 'custom-llm'
        )
      );
    });

    it('returns everything when no provider is given', () => {
      expectStrictEqual(
        modelsForProvider(DEFAULT_MODEL_OPTIONS, '').length,
        DEFAULT_MODEL_OPTIONS.length
      );
    });
  });

  describe('modelProviderIssue', () => {
    it('reports a cross-provider pairing', () => {
      const issue = modelProviderIssue(
        'anthropic',
        'gpt-4o-mini',
        DEFAULT_MODEL_OPTIONS
      );
      expectMatch(issue, /Anthropic Claude cannot run/);
      expectMatch(issue, /gpt-4o-mini/);
      expectMatch(issue, /OpenAI/);
    });

    it('stays silent on a matching pairing', () => {
      expectStrictEqual(
        modelProviderIssue('anthropic', 'claude-opus-5', DEFAULT_MODEL_OPTIONS),
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
        defaultModelForProvider(DEFAULT_MODEL_OPTIONS, 'openai', 'gpt-4o'),
        'gpt-4o'
      );
    });

    it('replaces a model belonging to another provider', () => {
      expectStrictEqual(
        defaultModelForProvider(DEFAULT_MODEL_OPTIONS, 'gemini', 'gpt-4o'),
        'gemini-2.5-pro'
      );
    });

    it('returns null when the provider has no models', () => {
      expectStrictEqual(
        defaultModelForProvider(DEFAULT_MODEL_OPTIONS, 'nanobanana'),
        null
      );
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
