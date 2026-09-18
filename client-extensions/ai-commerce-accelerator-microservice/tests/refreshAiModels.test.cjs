const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts/refresh_ai_models.py');
const MICROSERVICE_CATALOG = path.join(
  __dirname,
  '..',
  'utils',
  'modelCatalog.cjs'
);

/**
 * The selection scripts/refresh_ai_models.py makes, exercised on fixtures.
 *
 * Every model list here is a literal. No provider is called, no key is read and
 * no tokens are spent - which is also why the fixtures carry the ids the issues
 * actually name (`gpt-6-astra`, `claude-fable-5-1`, `nano-banana-pro-preview`)
 * rather than invented ones: the point is that this build ranks *those*
 * correctly, and a made-up id would prove nothing about the vocabulary.
 *
 * The script is Python and the vocabulary it reads is declared in a CommonJS
 * module, so the two are bridged the way providerRegistry.test.cjs already
 * bridges them - node evaluates the declaration, python3 evaluates the script.
 */
const FIXTURES = {
  // Newest first; the harness turns the position into a `created` timestamp.
  tierProbe: {
    openai: [
      'gpt-6-astra',
      'gpt-5.6-luna',
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-5.5-mini',
      'gpt-4o-mini',
      'gpt-live-1',
      'o3-mini',
      'gpt-4.1-nano',
    ],
    anthropic: [
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ],
    gemini: [
      'gemini-3.8-flash',
      'gemini-3-pro',
      'gemini-2.5-flash-lite',
      'gemini-3.8-flash-preview',
      'gemini-3-ultra',
    ],
  },
  imageProbe: [
    'gpt-image-2',
    'dall-e-3',
    'imagen-3.0-generate-002',
    'gemini-3-pro-image',
    'nano-banana-pro-preview',
    'gpt-5.5',
    'claude-opus-5',
    'gemini-3.8-flash',
  ],
  unusableProbe: [
    'text-embedding-3-large',
    'whisper-1',
    'sora-2',
    'gpt-4o-vision',
    'gpt-image-2',
    'imagen-3.0-generate-002',
    'nano-banana-pro-preview',
    'gemini-3-pro-image',
  ],
  // A provider whose vendor ships a ladder this build can read.
  ladder: {
    provider: 'gemini',
    ids: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3-pro',
      'gemini-2.5-flash-lite',
    ],
  },
  // A provider whose vendor ships names this build cannot rank at all.
  unrankable: {
    provider: 'openai',
    ids: ['gpt-6-astra', 'gpt-5.6-luna', 'gpt-5.5-sol'],
  },
  // OpenAI's live catalogue as #636 recorded it on 2026-09-07, which is where
  // the complaint comes from: recency alone picked gpt-6-astra, gpt-5.6-luna
  // and gpt-5.5-pro, the priciest rung of that release, and dropped
  // gpt-4o-mini entirely.
  issue636: {
    provider: 'openai',
    ids: [
      'gpt-6-astra',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.5-pro',
      'gpt-5.5',
      'gpt-4o-mini',
    ],
  },
  // Image models from a provider whose adapter cannot return an image.
  unrunnable: {
    provider: 'gemini',
    ids: [
      'gemini-3.8-flash',
      'gemini-3-pro-image',
      'imagen-3.0-generate-002',
      'nano-banana-pro-preview',
    ],
  },
  // Image models from a provider whose adapter can.
  runnable: {
    provider: 'openai',
    ids: ['gpt-5.5', 'gpt-5.5-mini', 'gpt-5.5-pro', 'gpt-image-2', 'dall-e-3'],
  },
};

const HARNESS = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("refresh", sys.argv[1])',
  'mod = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(mod)',
  'fixtures = json.loads(sys.argv[2])',
  'catalogue = json.loads(sys.argv[3])',
  'def models(ids):',
  '    return [',
  '        {"id": i, "label": None, "created": 10000 - n}',
  '        for n, i in enumerate(ids)',
  '    ]',
  'def assess(case):',
  '    return mod.assess(case["provider"], models(case["ids"]), today=0)',
  'cases = ["ladder", "unrankable", "unrunnable", "runnable", "issue636"]',
  'reports = {name: assess(fixtures[name]) for name in cases}',
  'print(json.dumps({',
  '    "tiers": {',
  '        p: {i: mod.tier_of(p, i) for i in ids}',
  '        for p, ids in fixtures["tierProbe"].items()',
  '    },',
  '    "unknownWords": {',
  '        p: {i: mod.unknown_tier_words(p, i) for i in ids}',
  '        for p, ids in fixtures["tierProbe"].items()',
  '    },',
  '    "images": {i: mod.generates_images(i) for i in fixtures["imageProbe"]},',
  '    "unusable": {',
  '        i: bool(mod.UNUSABLE_HINT.search(i))',
  '        for i in fixtures["unusableProbe"]',
  '    },',
  '    "adapterImages": {',
  '        p: mod.can_generate_images(p) for p in mod.declared_providers()',
  '    },',
  '    "reports": reports,',
  '    "rendered": mod.render_report(reports),',
  '    "catalogue": mod.render_js_array(catalogue, "  "),',
  '}))',
].join('\n');

const SHIPPED = require('../utils/modelCatalog.cjs').DEFAULT_MODEL_OPTIONS;

const python = JSON.parse(
  execFileSync(
    'python3',
    ['-c', HARNESS, SCRIPT, JSON.stringify(FIXTURES), JSON.stringify(SHIPPED)],
    { encoding: 'utf8' }
  )
);

const values = (name) => python.reports[name].entries.map((e) => e.value);
const tierOf = (name, value) =>
  python.reports[name].entries.find((e) => e.value === value)?.tier;

describe('refresh_ai_models', () => {
  describe('ranks a model by the vendor own tier vocabulary', () => {
    it.each([
      ['openai', 'gpt-5.5-pro', 'premium'],
      ['openai', 'gpt-5.5-mini', 'cheap'],
      ['openai', 'gpt-4.1-nano', 'cheap'],
      ['openai', 'o3-mini', 'cheap'],
      ['anthropic', 'claude-opus-5', 'premium'],
      ['anthropic', 'claude-sonnet-5', 'mid'],
      ['anthropic', 'claude-haiku-4-5', 'cheap'],
      ['gemini', 'gemini-3-pro', 'premium'],
      ['gemini', 'gemini-3-ultra', 'premium'],
      ['gemini', 'gemini-3.8-flash', 'mid'],
    ])('%s %s is %s', (provider, id, tier) => {
      expect(python.tiers[provider][id]).toBe(tier);
    });

    it('prefers the longer tier phrase where two could match', () => {
      // gemini-2.5-flash-lite contains `flash`, which is the mid tier. It is
      // the cheap one, and only the longer term says so.
      expect(python.tiers.gemini['gemini-2.5-flash-lite']).toBe('cheap');
    });

    it('treats an unqualified name as the tier the vendor leaves unnamed', () => {
      // OpenAI names neither of its middle models: gpt-5.5 *is* the balanced
      // one, and gpt-5.5-pro the premium one.
      expect(python.tiers.openai['gpt-5.5']).toBe('mid');
    });

    it('ignores a release channel when ranking', () => {
      expect(python.tiers.gemini['gemini-3.8-flash-preview']).toBe('mid');
      expect(python.unknownWords.gemini['gemini-3.8-flash-preview']).toEqual(
        []
      );
    });
  });

  describe('reports a tier word it does not know rather than guessing one', () => {
    it.each([
      ['openai', 'gpt-6-astra', 'astra'],
      ['openai', 'gpt-5.6-luna', 'luna'],
      ['openai', 'gpt-live-1', 'live'],
      ['anthropic', 'claude-fable-5-1', 'fable'],
    ])('%s %s is unrankable, reporting %s', (provider, id, word) => {
      // The load-bearing requirement of #636. Ranking one of these as
      // mid-range would put a model of unknown price in front of an operator
      // with no trace, which is worse than the bug being fixed.
      expect(python.tiers[provider][id]).toBeNull();
      expect(python.unknownWords[provider][id]).toEqual([word]);
    });

    it('carries every unknown word into the report the workflow publishes', () => {
      expect(python.rendered).toMatch(/Unrecognised tier words/);
      for (const word of ['astra', 'luna', 'sol', 'terra']) {
        expect(python.rendered).toContain(word);
      }
    });

    it('says which tiers it could not fill', () => {
      expect(python.reports.unrankable.unfilled_tiers).toEqual([
        'cheap',
        'mid',
        'premium',
      ]);
      expect(python.rendered).toMatch(/Tiers no model could be found for/);
    });

    it('still offers three models when it can rank none of them', () => {
      // The backfill is the old "three newest families" rule, unchanged. A
      // vocabulary this build cannot read must leave an operator no worse off
      // than before.
      expect(values('unrankable')).toEqual([
        'gpt-6-astra',
        'gpt-5.6-luna',
        'gpt-5.5-sol',
      ]);
      expect(
        python.reports.unrankable.entries.every((e) => e.tier === null)
      ).toBe(true);
    });
  });

  describe('offers one model per tier rather than the three newest', () => {
    it('spans the ladder instead of taking three of one rung', () => {
      // Recency alone picks the three newest flash models and drops both the
      // cheap and the premium option. This is the bug #636 reports.
      expect(values('ladder').sort()).toEqual([
        'gemini-2.5-flash-lite',
        'gemini-3-pro',
        'gemini-3.8-flash',
      ]);
      expect(tierOf('ladder', 'gemini-2.5-flash-lite')).toBe('cheap');
      expect(tierOf('ladder', 'gemini-3.8-flash')).toBe('mid');
      expect(tierOf('ladder', 'gemini-3-pro')).toBe('premium');
    });

    it('still ships newest first, so the preselected model is unchanged', () => {
      // defaultModelForProvider takes a provider's first text option. Widening
      // what is offered and changing what is preselected are separate
      // decisions, and #636 asks only for the first.
      expect(values('ladder')[0]).toBe('gemini-3.8-flash');
    });

    it('fixes the selection #636 recorded from the live catalogue', () => {
      // Before: gpt-6-astra, gpt-5.6-luna, gpt-5.5-pro - every cheap option
      // dropped. After: a rung each, with the unrankable names reported rather
      // than filling the list.
      expect(values('issue636').sort()).toEqual([
        'gpt-4o-mini',
        'gpt-5.5',
        'gpt-5.5-pro',
      ]);
      expect(tierOf('issue636', 'gpt-4o-mini')).toBe('cheap');
      expect(tierOf('issue636', 'gpt-5.5')).toBe('mid');
      expect(tierOf('issue636', 'gpt-5.5-pro')).toBe('premium');
      expect(python.reports.issue636.unknown_tier_words).toEqual([
        'astra',
        'luna',
        'sol',
        'terra',
      ]);
    });

    it('takes cheap, mid and premium from one release when that is the ladder', () => {
      expect(values('runnable').slice(0, 3)).toEqual([
        'gpt-5.5',
        'gpt-5.5-mini',
        'gpt-5.5-pro',
      ]);
    });
  });

  describe('classifies output modality instead of dropping image models', () => {
    it.each([
      'gpt-image-2',
      'dall-e-3',
      'imagen-3.0-generate-002',
      'gemini-3-pro-image',
      'nano-banana-pro-preview',
    ])('reads %s as an image model', (id) => {
      expect(python.images[id]).toBe(true);
    });

    it.each(['gpt-5.5', 'claude-opus-5', 'gemini-3.8-flash'])(
      'leaves %s as a text model',
      (id) => expect(python.images[id]).toBe(false)
    );

    it('no longer excludes an image model by kind', () => {
      for (const id of [
        'gpt-image-2',
        'imagen-3.0-generate-002',
        'nano-banana-pro-preview',
        'gemini-3-pro-image',
      ]) {
        expect(python.unusable[id]).toBe(false);
      }
    });

    it('still excludes what no adapter can drive', () => {
      for (const id of ['text-embedding-3-large', 'whisper-1', 'sora-2']) {
        expect(python.unusable[id]).toBe(true);
      }
      // Vision is a model that *accepts* images, which is the field #637 warns
      // is most easily mistaken for image generation. It stays excluded.
      expect(python.unusable['gpt-4o-vision']).toBe(true);
    });

    it('tags what it keeps with what the model produces', () => {
      const image = python.reports.runnable.entries.find((e) => e.images);

      expect(image.value).toBe('gpt-image-2');
      expect(image.text).toBe(false);
      expect(image.tier).toBeNull();
      expect(
        python.reports.runnable.entries
          .filter((e) => e.text)
          .every((e) => !e.images)
      ).toBe(true);
    });
  });

  describe('admits an image model only where an adapter can run it', () => {
    it('knows which adapters actually return an image', () => {
      // The #642 rule, one level down. This is a fact about this codebase, not
      // about how many image models a vendor publishes.
      expect(python.adapterImages).toEqual({
        anthropic: false,
        gemini: false,
        nanobanana: false,
        openai: true,
      });
    });

    it('drops an image model whose provider generateImage returns nothing', () => {
      expect(values('unrunnable')).toEqual(['gemini-3.8-flash']);
      expect(python.reports.unrunnable.unrunnable_images).toEqual([
        'gemini-3-pro-image',
        'imagen-3.0-generate-002',
        'nano-banana-pro-preview',
      ]);
    });

    it('never lets a nano-banana model into the catalogue', () => {
      // #637 as filed proposed deriving image capability from names including
      // nano-banana, which would restore exactly what #642 removed: its adapter
      // returned BASE64_PLACEHOLDER_FOR_NANOBANANA and produced nothing usable.
      expect(python.rendered).toMatch(
        /Image models excluded because no adapter here can run them/
      );
      for (const report of Object.values(python.reports)) {
        expect(report.entries.map((e) => e.value)).not.toContain(
          'nano-banana-pro-preview'
        );
      }
    });

    it('keeps one from a provider that can', () => {
      expect(values('runnable')).toContain('gpt-image-2');
      expect(values('runnable')).not.toContain('dall-e-3');
    });
  });

  describe('writes what the catalogue already holds', () => {
    it('renders the shipped list exactly as the file carries it', () => {
      // Proves the checked-in catalogue is what this script would write, so a
      // scheduled refresh produces a diff of models rather than of formatting.
      const block = fs
        .readFileSync(MICROSERVICE_CATALOG, 'utf8')
        .match(/const DEFAULT_MODEL_OPTIONS = \[\n([\s\S]*?)\n\];/);

      expect(block[1]).toBe(python.catalogue);
    });

    it('writes each entry across several lines, which Prettier leaves alone', () => {
      // The workflow runs `prettier --write .` and then opens a pull request
      // whose format check would fail on this script's own output. Prettier
      // keeps an object expanded once its first property is on a new line.
      expect(python.catalogue.split('\n')[0].trim()).toBe('{');
    });
  });

  describe('runs end to end without reaching a provider', () => {
    it('reports no change against the list it already wrote', () => {
      const output = execFileSync('python3', [SCRIPT, '--check'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: '',
          OPENAI_API_KEY: '',
        },
      });

      expect(output).toMatch(/No change\./);
    });
  });
});
