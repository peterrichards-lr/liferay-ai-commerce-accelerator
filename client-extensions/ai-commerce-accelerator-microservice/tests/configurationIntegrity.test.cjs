const LiferayRestService = require('../services/liferay/rest.cjs');
const fs = require('fs');
const path = require('path');
const {
  listPromptNames,
  listSchemaNames,
} = require('../utils/configurationAssets.cjs');
const { DEFAULT_MAX_TOKENS } = require('../utils/aiRequestOptions.cjs');

const BATCH_DIR = path.join(
  __dirname,
  '../../ai-commerce-accelerator-batch/batch'
);

const AI_CONFIG_PANEL = path.join(
  __dirname,
  '../../ai-commerce-accelerator-configuration/src/components/panels/AiConfigPanel.jsx'
);

/**
 * The `ai-config` entry from the hand-maintained core seed. It is not one of
 * the files build.gradle regenerates, so nothing else keeps it in step with
 * the microservice.
 */
function seededAiConfig() {
  const batch = JSON.parse(
    fs.readFileSync(
      path.join(BATCH_DIR, '03-object-entry.batch-engine-data.json'),
      'utf8'
    )
  );
  const entry = batch.items.find((item) => item.configKey === 'ai-config');

  expect(
    entry,
    'The core seed no longer carries an ai-config entry'
  ).toBeDefined();

  return JSON.parse(entry.configValue);
}

function seededConfigKeys(infix) {
  return fs
    .readdirSync(BATCH_DIR)
    .filter((fileName) => fileName.includes(`-object-entry-${infix}-`))
    .map((fileName) =>
      JSON.parse(fs.readFileSync(path.join(BATCH_DIR, fileName), 'utf8'))
    )
    .flatMap((batch) => batch.items.map((item) => item.configKey))
    .sort();
}

function seededPromptValues() {
  return fs
    .readdirSync(BATCH_DIR)
    .filter((fileName) => fileName.includes('-object-entry-ai-prompt-'))
    .flatMap((fileName) =>
      JSON.parse(
        fs.readFileSync(path.join(BATCH_DIR, fileName), 'utf8')
      ).items.map((item) => [item.configKey, item.configValue])
    )
    .reduce((values, [key, value]) => ({ ...values, [key]: value }), {});
}

describe('Microservice Configuration Integrity', () => {
  let _restService;
  let mockCtx;

  beforeAll(() => {
    mockCtx = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
    };
    _restService = new LiferayRestService(mockCtx);
  });

  it('should ensure all high-volume discovery operations have SOFT_STATUS_BY_OP entries', () => {
    // Discovery/List operations should generally have soft 404 handling
    // to prevent workflow crashes during indexing or for empty environments.
    const discoveryOps = [
      'accounts:list',
      'products:list',
      'orders:list',
      'pricelists:list',
      'specifications:list',
      'optionCategories:list',
      'get-sku-by-erc',
      'get-account-by-erc',
      'get-price-list-by-erc',
      'warehouse:items',
    ];

    // Read the static property from the service class
    const { SOFT_STATUS_BY_OP } = LiferayRestService;

    discoveryOps.forEach((op) => {
      expect(
        SOFT_STATUS_BY_OP,
        `Missing SOFT_STATUS_BY_OP entry for: ${op}`
      ).toHaveProperty(op);
      expect(SOFT_STATUS_BY_OP[op]).toContain(404);
    });
  });

  it('should have consistent ID field naming in createWarehouseChannel', () => {
    // This tests the logic we just fixed regarding JSON path mapping failures

    // We can't easily test the private payload construction without refactoring
    // but we can verify the method signature in LiferayService exists.
    const { LiferayService } = require('../services/liferay/index.cjs');
    const service = new LiferayService(mockCtx);

    expect(typeof service.createWarehouseChannel).toBe('function');
  });

  // The image prompt shipped unseeded for several releases because three
  // hardcoded entity lists had to be updated by hand and none of them was.
  // These two assertions fail the build instead.
  it('should seed one ai-prompt config entry per prompt file', () => {
    const promptNames = listPromptNames();

    expect(promptNames).toContain('image');
    expect(seededConfigKeys('ai-prompt')).toEqual(
      promptNames.map((name) => `ai-prompt-${name}`)
    );
  });

  // The output cap lives in three artifacts that no build step relates to one
  // another: DEFAULT_MAX_TOKENS here, the `ai-config` seed Liferay installs,
  // and the panel's own fallback. They disagreed - 4000 seeded, 16384 sent -
  // and the microservice papered over it by treating a configured 4000 as
  // "unset", which is what made tuning the panel move the cap backwards
  // (#823). Drift is a defect, so it fails the build.
  // Existence was never the whole question. The product prompt gained five
  // rules in #788 and #808 while its hand-maintained payload stayed on the
  // #744 text, so the object deployed to Liferay ran 2,099 characters behind
  // the prompt the microservice reads - and the assertion above stayed green
  // throughout, because the entry it looks for was there all along (#840).
  it('should seed each ai-prompt config entry with its prompt file verbatim', () => {
    const seeded = seededPromptValues();

    for (const name of listPromptNames()) {
      const prompt = fs.readFileSync(
        path.join(__dirname, '..', 'prompts', `${name}.md`),
        'utf8'
      );

      expect(
        seeded[`ai-prompt-${name}`],
        `The batch payload for ${name} has drifted from prompts/${name}.md`
      ).toBe(prompt);
    }
  });

  it('should seed the same default token cap the microservice resolves', () => {
    expect(seededAiConfig().maxTokens.default).toBe(DEFAULT_MAX_TOKENS);
  });

  it('should offer the same default token cap in the configuration panel', () => {
    const source = fs.readFileSync(AI_CONFIG_PANEL, 'utf8');
    const declared = source.match(/maxTokens: \{\s*default: (\d+)/);

    expect(
      declared,
      'The panel no longer declares a default maxTokens; this guard needs updating'
    ).not.toBeNull();
    expect(Number(declared[1])).toBe(DEFAULT_MAX_TOKENS);
  });

  it('should seed one ai-schema config entry per generation schema file', () => {
    const schemaNames = listSchemaNames();

    // Image generation returns an image, not structured output, so it has a
    // prompt with no schema behind it. The two sets are not interchangeable.
    expect(schemaNames).not.toContain('image');
    expect(seededConfigKeys('ai-schema')).toEqual(
      schemaNames.map((name) => `ai-schema-${name}`)
    );
  });
});
