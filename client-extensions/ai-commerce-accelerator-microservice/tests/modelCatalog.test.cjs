const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_MODEL_OPTIONS,
  defaultModelForProvider,
  inferModality,
  inferProvider,
  modelModality,
  modelModalityIssue,
  modelProvider,
  modelProviderIssue,
  modelTier,
  modelsForProvider,
} = require('../utils/modelCatalog.cjs');
const {
  IMAGE_CAPABLE_PROVIDERS,
} = require('../utils/providerCapabilities.cjs');
const { TIER_IDS } = require('../utils/providerRegistry.cjs');

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
// generateBatchFiles task deletes 22-object-entry-ai-model-options before
// recreating it from this, so the batch file is absent partway through a build.
const SOURCE_PATH = path.join(
  __dirname,
  '../../ai-commerce-accelerator-frontend/src/config/ai-models.json'
);

// Entries as scripts/refresh_ai_models.py now writes them: a provider, an
// output modality and a price tier. Separate from FIXTURE so the modality tests
// are not also assertions about provider attribution.
const MODAL_FIXTURE = [
  {
    label: 'Alpha One',
    value: 'gpt-alpha-1',
    provider: 'openai',
    tier: 'mid',
    text: true,
    images: false,
  },
  {
    label: 'Alpha Image',
    value: 'gpt-image-9',
    provider: 'openai',
    tier: null,
    text: false,
    images: true,
  },
  { label: 'Custom', value: 'my-self-hosted-llm' },
];

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

  describe('inferModality', () => {
    it.each([
      'gpt-image-2',
      'dall-e-3',
      'imagen-3.0-generate-002',
      'gemini-3-pro-image',
      'nano-banana-pro-preview',
    ])('reads %s as an image model from its name', (id) => {
      expectDeepEqual(inferModality(id), { text: false, images: true });
    });

    it.each(['gpt-4o-mini', 'claude-opus-5', 'gemini-3.8-flash', 'o3-mini'])(
      'says nothing about %s rather than calling it text',
      (id) => {
        // No provider reports output modality, so a name that does not say
        // "image" is not evidence that a model generates text. Silence here is
        // what lets modelsForProvider keep an unrecognised entry visible.
        expectStrictEqual(inferModality(id), null);
      }
    );

    it('returns null for an empty id', () => {
      expectStrictEqual(inferModality(''), null);
      expectStrictEqual(inferModality(undefined), null);
    });
  });

  describe('modelModality', () => {
    it('takes an explicit field over the name', () => {
      // An operator pointing a proxy at an oddly named model gets the last
      // word, exactly as they do for the provider field.
      expectDeepEqual(modelModality({ value: 'gpt-image-9', text: true }), {
        text: true,
        images: null,
      });
    });

    it('falls back to the name when no field is declared', () => {
      expectDeepEqual(modelModality({ value: 'gpt-image-9' }), {
        text: false,
        images: true,
      });
    });

    it('reports an unrecognised entry as unknown on both counts', () => {
      expectDeepEqual(modelModality({ value: 'my-self-hosted-llm' }), {
        text: null,
        images: null,
      });
      expectDeepEqual(modelModality(null), { text: null, images: null });
    });
  });

  describe('modelTier', () => {
    it('reads the tier an entry was ranked into', () => {
      expectStrictEqual(modelTier({ value: 'x', tier: 'Cheap' }), 'cheap');
    });

    it('returns null for an entry this build could not rank', () => {
      // null rather than a default: an unranked model must stay visibly
      // unranked, because guessing is what #636 exists to prevent.
      expectStrictEqual(modelTier({ value: 'x', tier: null }), null);
      expectStrictEqual(modelTier({ value: 'x' }), null);
      expectStrictEqual(modelTier(undefined), null);
    });
  });

  describe('modelsForProvider, by modality', () => {
    it('keeps an image model out of the text list', () => {
      expectDeepEqual(
        modelsForProvider(MODAL_FIXTURE, 'openai').map((m) => m.value),
        ['gpt-alpha-1', 'my-self-hosted-llm']
      );
    });

    it('excludes an image model on its name alone', () => {
      // A list seeded before the field existed, or edited by hand, still keeps
      // gemini-3-pro-image out of the Core AI Model dropdown.
      const options = [{ value: 'gemini-3-pro-image', provider: 'gemini' }];
      expectDeepEqual(modelsForProvider(options, 'gemini'), []);
    });

    it('keeps an entry whose modality is unknown', () => {
      expectOk(
        modelsForProvider(MODAL_FIXTURE, 'openai', 'text').length <
          MODAL_FIXTURE.length
      );
      expectOk(
        modelsForProvider(MODAL_FIXTURE, '').some(
          (m) => m.value === 'my-self-hosted-llm'
        )
      );
    });

    it('returns the image models when images are asked for', () => {
      expectDeepEqual(
        modelsForProvider(MODAL_FIXTURE, 'openai', 'images').map(
          (m) => m.value
        ),
        ['gpt-image-9', 'my-self-hosted-llm']
      );
    });

    it('filters on modality even with no provider given', () => {
      expectDeepEqual(
        modelsForProvider(MODAL_FIXTURE, '').map((m) => m.value),
        ['gpt-alpha-1', 'my-self-hosted-llm']
      );
    });
  });

  describe('modelModalityIssue', () => {
    it('reports an image model chosen as the core model', () => {
      const issue = modelModalityIssue('gpt-image-9', MODAL_FIXTURE);
      expectMatch(issue, /generates images, not text/);
      expectMatch(issue, /gpt-image-9/);
    });

    it('reports one that is only recognisable by name', () => {
      expectMatch(
        modelModalityIssue('nano-banana-pro-preview', []),
        /generates images, not text/
      );
    });

    it('stays silent on a text model', () => {
      expectStrictEqual(modelModalityIssue('gpt-alpha-1', MODAL_FIXTURE), null);
    });

    it('stays silent on a model it cannot judge', () => {
      expectStrictEqual(modelModalityIssue('my-self-hosted-llm', []), null);
      expectStrictEqual(modelModalityIssue('', MODAL_FIXTURE), null);
    });

    it('lets a declared field overrule the name', () => {
      expectStrictEqual(
        modelModalityIssue('gpt-image-9', [
          { value: 'gpt-image-9', text: true },
        ]),
        null
      );
    });
  });

  describe('defaultModelForProvider, by modality', () => {
    it('never preselects an image model', () => {
      // configService calls this to fill aiConfig.defaultModel, so an image
      // model reaching it would break every generateJSON call in a run.
      expectStrictEqual(
        defaultModelForProvider([MODAL_FIXTURE[1], MODAL_FIXTURE[0]], 'openai'),
        'gpt-alpha-1'
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

    it('records a modality and a tier for every entry', () => {
      for (const option of DEFAULT_MODEL_OPTIONS) {
        expectStrictEqual(typeof option.text, 'boolean');
        expectStrictEqual(typeof option.images, 'boolean');
        expectOk(
          option.tier === null || TIER_IDS.includes(option.tier),
          `${option.value} carries an unknown tier ${option.tier}`
        );
        expectDeepEqual(modelModality(option), {
          text: option.text,
          images: option.images,
        });
      }
    });

    it('offers no image model from a provider that cannot generate images', () => {
      // The regression #642 fixed, restated as data. nanobanana's generateImage
      // returned a placeholder and gemini's throws, so an image model from
      // either would be offered to an operator and produce nothing.
      for (const option of DEFAULT_MODEL_OPTIONS) {
        if (!option.images) continue;
        expectOk(
          IMAGE_CAPABLE_PROVIDERS.includes(option.provider),
          `${option.value} claims images but ${option.provider} cannot produce one`
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
