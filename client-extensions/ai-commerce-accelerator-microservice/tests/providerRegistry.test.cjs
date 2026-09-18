const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const registry = require('../utils/providerRegistry.cjs');
const AIProviderFactory = require('../services/ai-providers/providerFactory.cjs');
const {
  IMAGE_CAPABLE_PROVIDERS,
  providerLabel,
} = require('../utils/providerCapabilities.cjs');
const {
  KEY_PATTERNS,
  PROVIDER_ENV_VARS,
  PROVIDER_KEY_FAMILY,
  providerForKey,
  resolveCoreKey,
} = require('../utils/apiKeys.cjs');
const { PROVIDER_PATTERNS } = require('../utils/modelCatalog.cjs');

const ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Every provider table as it was written out by hand before #635 derived them,
 * copied verbatim from the nine files that held them.
 *
 * These are literals on purpose and must stay literals. Computing them from the
 * registry would make this file compare the refactor against itself and prove
 * nothing; the whole value of it is that it was transcribed from the code that
 * existed *before* the derivation did. Changing one is therefore a deliberate
 * statement that the product's behaviour is meant to change, not a way to make
 * a red test green.
 */
const BEFORE = {
  // utils/apiKeys.cjs and src/config/apiKeys.js
  PROVIDER_KEY_FAMILY: {
    anthropic: 'anthropic',
    gemini: 'google',
    nanobanana: 'google',
    openai: 'openai',
  },
  PROVIDER_ENV_VARS: {
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    nanobanana: 'GEMINI_API_KEY',
    openai: 'OPENAI_API_KEY',
  },
  KEY_PATTERNS: [
    { family: 'anthropic', pattern: '/^sk-ant-/' },
    { family: 'google', pattern: '/^AIza/' },
    { family: 'openai', pattern: '/^sk-/' },
  ],
  FAMILY_LABELS: {
    anthropic: 'Anthropic',
    google: 'Google',
    openai: 'OpenAI',
  },
  // utils/providerCapabilities.cjs and src/config/providerCapabilities.js
  IMAGE_CAPABLE_PROVIDERS: ['openai'],
  PROVIDER_LABELS: {
    anthropic: 'Anthropic Claude',
    gemini: 'Google Gemini',
    nanobanana: 'Nano Banana',
    openai: 'OpenAI',
  },
  // utils/modelCatalog.cjs and src/config/modelCatalog.js
  PROVIDER_PATTERNS: [
    { provider: 'anthropic', pattern: '/^claude[-.]/i' },
    { provider: 'gemini', pattern: '/^(gemini|imagen)[-.]/i' },
    { provider: 'openai', pattern: '/^(gpt[-.]|o\\d)/i' },
  ],
  // services/ai-providers/providerFactory.cjs, the switch cases
  FACTORY_CASES: ['openai', 'gemini', 'nanobanana', 'anthropic'],
  // utils/apiKeys.cjs resolveCoreKey, the provider-specific variables in the
  // order it tried them
  CORE_KEY_ORDER: [
    ['openai', 'OPENAI_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
  ],
  // src/components/panels/AiSettingsPanel.jsx, the Core AI Provider dropdown
  TEXT_PROVIDER_OPTIONS: [
    { label: 'OpenAI (GPT)', value: 'openai' },
    { label: 'Google Gemini', value: 'gemini' },
    { label: 'Anthropic Claude', value: 'anthropic' },
  ],
  // src/components/panels/AiSettingsPanel.jsx, the Media Provider dropdown
  MEDIA_PROVIDER_OPTIONS: [
    { label: 'Same as Core AI', value: 'inherit' },
    { label: 'OpenAI', value: 'openai' },
  ],
  // scripts/refresh_ai_models.py PROVIDERS, in iteration order
  CATALOGUE_PROVIDERS: [
    ['openai', 'OPENAI_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
  ],
  // scripts/refresh_ai_models.py, the display order the model list is sorted by
  DISPLAY_ORDER: { openai: 0, anthropic: 1, gemini: 2 },
};

const asSource = (patterns, name) =>
  patterns.map((entry) => ({
    [name]: name === 'family' ? entry.family : entry.provider,
    pattern: String(entry.pattern),
  }));

describe('provider registry', () => {
  describe('derives every table that used to be written out by hand', () => {
    // Object key order is asserted alongside the contents because
    // providerForKey resolves a shared credential family by walking the
    // declaration in order, so a reordering is a behaviour change rather than a
    // cosmetic one.
    it('the credential family each provider authenticates with', () => {
      expect(PROVIDER_KEY_FAMILY).toEqual(BEFORE.PROVIDER_KEY_FAMILY);
      expect(Object.keys(PROVIDER_KEY_FAMILY)).toEqual(
        Object.keys(BEFORE.PROVIDER_KEY_FAMILY)
      );
    });

    it('the environment variable each provider prefers', () => {
      expect(PROVIDER_ENV_VARS).toEqual(BEFORE.PROVIDER_ENV_VARS);
      expect(Object.keys(PROVIDER_ENV_VARS)).toEqual(
        Object.keys(BEFORE.PROVIDER_ENV_VARS)
      );
    });

    it('the key prefixes, still with Anthropic ahead of OpenAI', () => {
      expect(asSource(KEY_PATTERNS, 'family')).toEqual(BEFORE.KEY_PATTERNS);
    });

    it('the credential family labels', () => {
      expect(registry.FAMILY_LABELS).toEqual(BEFORE.FAMILY_LABELS);
    });

    it('the providers that can generate images', () => {
      expect(IMAGE_CAPABLE_PROVIDERS).toEqual(BEFORE.IMAGE_CAPABLE_PROVIDERS);
    });

    it('the provider display labels', () => {
      expect(registry.PROVIDER_LABELS).toEqual(BEFORE.PROVIDER_LABELS);
      for (const [id, label] of Object.entries(BEFORE.PROVIDER_LABELS)) {
        expect(providerLabel(id)).toBe(label);
      }
    });

    it('the model-name patterns, nanobanana still absent from them', () => {
      expect(asSource(PROVIDER_PATTERNS, 'provider')).toEqual(
        BEFORE.PROVIDER_PATTERNS
      );
    });

    it('the order resolveCoreKey tries the provider-specific variables in', () => {
      const tried = [];
      resolveCoreKey((name) => {
        tried.push(name);
        return null;
      });

      expect(tried).toEqual([
        ...BEFORE.CORE_KEY_ORDER.map(([, envVar]) => envVar),
        'AI_API_KEY',
      ]);

      for (const [provider, envVar] of BEFORE.CORE_KEY_ORDER) {
        expect(
          resolveCoreKey((name) => (name === envVar ? 'key' : null))
        ).toEqual({ apiKey: 'key', provider, envVar });
      }
    });

    it('the Core AI Provider dropdown', () => {
      expect(
        registry.TEXT_PROVIDERS.map(({ id, label, selectLabel }) => ({
          label: selectLabel || label,
          value: id,
        }))
      ).toEqual(BEFORE.TEXT_PROVIDER_OPTIONS);
    });

    it('the Media Provider dropdown', () => {
      expect([
        { label: 'Same as Core AI', value: 'inherit' },
        ...IMAGE_CAPABLE_PROVIDERS.map((id) => ({
          label: providerLabel(id),
          value: id,
        })),
      ]).toEqual(BEFORE.MEDIA_PROVIDER_OPTIONS);
    });

    it('the providers the refresh script fetches, in its iteration order', () => {
      expect(
        registry.CATALOGUE_PROVIDERS.map(({ id, envVar }) => [id, envVar])
      ).toEqual(BEFORE.CATALOGUE_PROVIDERS);
    });
  });

  describe('the factory covers exactly what is declared', () => {
    // CommonJS needs a literal require path, so the id-to-class association in
    // providerFactory.cjs cannot be derived. It is checked instead: a provider
    // declared with no adapter used to surface as "Unsupported AI provider"
    // partway through an operator's run.
    it('has an adapter for every declared provider and no others', () => {
      const declared = [...AIProviderFactory.ADAPTERS.keys()].sort();

      expect(declared).toEqual([...registry.PROVIDER_IDS].sort());
      expect(declared).toEqual([...BEFORE.FACTORY_CASES].sort());
    });

    it('still builds each one, and still refuses an undeclared name', () => {
      const factory = new AIProviderFactory({});

      for (const id of registry.PROVIDER_IDS) {
        expect(factory.getProvider(id)).toBeInstanceOf(
          AIProviderFactory.ADAPTERS.get(id)
        );
      }

      expect(() => factory.getProvider('some-future-provider')).toThrow(
        'Unsupported AI provider: some-future-provider'
      );
      // A property borrowed from Object.prototype is not a declaration.
      expect(() => factory.getProvider('constructor')).toThrow(
        'Unsupported AI provider'
      );
    });
  });

  describe('the declaration is the only place a provider is named', () => {
    const sourcesWithNoProviderNames = [
      'client-extensions/ai-commerce-accelerator-microservice/utils/apiKeys.cjs',
      'client-extensions/ai-commerce-accelerator-microservice/utils/modelCatalog.cjs',
      'client-extensions/ai-commerce-accelerator-microservice/utils/providerCapabilities.cjs',
      'client-extensions/ai-commerce-accelerator-configuration/src/config/apiKeys.js',
      'client-extensions/ai-commerce-accelerator-configuration/src/config/modelCatalog.js',
      'client-extensions/ai-commerce-accelerator-configuration/src/config/providerCapabilities.js',
      'client-extensions/ai-commerce-accelerator-configuration/src/components/panels/AiSettingsPanel.jsx',
    ];

    it.each(sourcesWithNoProviderNames)(
      '%s declares no provider of its own',
      (relative) => {
        const source = fs
          .readFileSync(path.join(ROOT, relative), 'utf8')
          // Comments cite providers by name to explain why something is the way
          // it is, which is the opposite of a hidden second declaration.
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          // The shipped model list is data scripts/refresh_ai_models.py writes,
          // and every entry names the provider it belongs to by design.
          .replace(/DEFAULT_MODEL_OPTIONS = \[[\s\S]*?\n\];/, '');

        for (const id of registry.PROVIDER_IDS) {
          // Quoted as a value, and unquoted as an object key - a table keyed by
          // provider is a declaration however its keys are written.
          expect(source).not.toMatch(new RegExp(`['"\`]${id}['"\`]`, 'i'));
          expect(source).not.toMatch(new RegExp(`\\b${id}\\s*:`, 'i'));
        }
      }
    );

    it('the configuration UI imports the declaration rather than copying it', () => {
      const source = fs.readFileSync(
        path.join(
          ROOT,
          'client-extensions/ai-commerce-accelerator-configuration/src/config/providerRegistry.js'
        ),
        'utf8'
      );

      expect(source).toContain(
        '../../../ai-commerce-accelerator-microservice/utils/providerRegistry.cjs'
      );
    });

    it('the registry pulls in no Node built-in, so it can be bundled for a browser', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'utils', 'providerRegistry.cjs'),
        'utf8'
      );

      expect(source).not.toMatch(/require\(/);
    });
  });

  describe('scripts/refresh_ai_models.py reads the same declaration', () => {
    const run = (expression) =>
      execFileSync(
        'python3',
        [
          '-c',
          [
            'import importlib.util, json, sys',
            'spec = importlib.util.spec_from_file_location("r", sys.argv[1])',
            'mod = importlib.util.module_from_spec(spec)',
            'spec.loader.exec_module(mod)',
            `print(json.dumps(${expression}))`,
          ].join('\n'),
          path.join(ROOT, 'scripts/refresh_ai_models.py'),
        ],
        { encoding: 'utf8' }
      );

    it('takes its provider list and their variables from the registry', () => {
      const providers = JSON.parse(
        run('[[k, v["env"]] for k, v in mod.catalogue_providers().items()]')
      );

      expect(providers).toEqual(BEFORE.CATALOGUE_PROVIDERS);
      expect(providers).toEqual(
        registry.CATALOGUE_PROVIDERS.map(({ id, envVar }) => [id, envVar])
      );
    });

    it('takes the shipped list display order from the registry', () => {
      expect(JSON.parse(run('mod.display_order()'))).toEqual(
        BEFORE.DISPLAY_ORDER
      );
    });

    it('keeps no provider list of its own', () => {
      const source = fs
        .readFileSync(path.join(ROOT, 'scripts/refresh_ai_models.py'), 'utf8')
        .replace(/^\s*#.*$/gm, '')
        .replace(/"""[\s\S]*?"""/g, '');

      // FETCHERS still maps an id to the call that reaches that provider's
      // endpoint, which is a function body and cannot be declared elsewhere.
      // Nothing else may name a provider.
      const named = source.match(
        /["'](openai|anthropic|gemini|nanobanana)["']/g
      );

      expect(named).toEqual(['"openai"', '"anthropic"', '"gemini"']);
    });
  });

  describe('every declaration is complete', () => {
    it.each(registry.PROVIDERS.map((entry) => [entry.id, entry]))(
      '%s declares everything the derived tables need',
      (id, entry) => {
        expect(id).toBe(id.toLowerCase());
        expect(entry.label).toBeTruthy();
        expect(registry.FAMILY_LABELS[entry.keyFamily]).toBeTruthy();
        expect(entry.envVar).toMatch(/^[A-Z0-9_]+$/);
        expect(typeof entry.capabilities.text).toBe('boolean');
        expect(typeof entry.capabilities.images).toBe('boolean');
      }
    );

    it('gives every provider that generates text a model pattern', () => {
      for (const entry of registry.PROVIDERS) {
        if (entry.capabilities.text) {
          expect(entry.modelPattern).toBeInstanceOf(RegExp);
        }
      }
    });

    it('offers only providers that generate text as the core provider', () => {
      for (const entry of registry.PROVIDERS) {
        if (entry.preferenceOrder !== null) {
          expect(entry.capabilities.text).toBe(true);
        }
      }
    });

    it('resolves a shared credential family to a provider that generates text', () => {
      // gemini and nanobanana share Google's key, so an AIza key has to pick
      // one; nanobanana generates nothing and would strand the run.
      expect(registry.providerForFamily('google')).toBe('gemini');
      expect(providerForKey('AIzaSyXXXX')).toBe('gemini');
    });

    it('gives every provider that generates text a tier vocabulary', () => {
      // A provider with no tier table cannot be ranked at all, which means the
      // shipped list silently falls back to "the three newest" for it - the
      // bug #636 exists to fix, reintroduced without a symptom.
      for (const entry of registry.PROVIDERS) {
        if (!entry.capabilities.text) continue;

        expect(Object.keys(entry.tiers)).toEqual(registry.TIER_IDS);
        expect(
          registry.TIER_IDS.flatMap((tier) => entry.tiers[tier]).length
        ).toBeGreaterThan(0);
      }
    });

    it('never files one tier word under two tiers', () => {
      // Tier terms are matched longest-first and the first hit wins, so a word
      // in two tiers would resolve by declaration order rather than by meaning.
      for (const entry of registry.PROVIDERS) {
        const words = registry.TIER_IDS.flatMap(
          (tier) => entry.tiers?.[tier] || []
        );

        expect(words).toEqual([...new Set(words)]);
        for (const word of words) {
          expect(word).toBe(word.toLowerCase());
        }
      }
    });

    it('treats a missing tier word as unrankable unless a provider says otherwise', () => {
      // untieredTier exists for exactly one reason: OpenAI leaves its middle
      // rung unnamed, so plain gpt-5.5 is the balanced model. Anywhere else an
      // unnamed model is a model this build cannot rank, and must say so.
      for (const entry of registry.PROVIDERS) {
        expect(
          entry.untieredTier === null ||
            registry.TIER_IDS.includes(entry.untieredTier)
        ).toBe(true);
      }
    });

    it('declares image model names separately from image capability', () => {
      // The two answer different questions and must not be folded together:
      // gemini and nanobanana name image models their adapters cannot run, and
      // deriving capability from those names is the #642 regression.
      const namesImageModels = registry.PROVIDERS.filter(
        (entry) => entry.imageModelPattern
      ).map((entry) => entry.id);

      expect(
        registry.IMAGE_MODEL_PATTERNS.map((entry) => entry.provider)
      ).toEqual(namesImageModels);
      expect(namesImageModels.length).toBeGreaterThan(
        IMAGE_CAPABLE_PROVIDERS.length
      );
    });

    it('carries the shared tier tables into the JSON Python reads', () => {
      const json = registry.registryAsJson();

      expect(json.tierIds).toEqual(registry.TIER_IDS);
      expect(json.neutralQualifiers).toEqual(registry.NEUTRAL_QUALIFIERS);
    });

    it('serialises to JSON without losing a field', () => {
      const json = registry.registryAsJson();

      expect(json.providers.map((entry) => entry.id)).toEqual(
        registry.PROVIDER_IDS
      );

      expect(json.providers.map(Object.keys)).toEqual(
        registry.PROVIDERS.map(Object.keys)
      );

      expect(
        json.providers.find((entry) => entry.id === 'openai').modelPattern
      ).toEqual({ source: '^(gpt[-.]|o\\d)', flags: 'i' });
    });
  });
});
