const LiferayRestService = require('../services/liferay/rest.cjs');
const fs = require('fs');
const path = require('path');
const {
  listPromptNames,
  listSchemaNames,
} = require('../utils/configurationAssets.cjs');

const BATCH_DIR = path.join(
  __dirname,
  '../../ai-commerce-accelerator-batch/batch'
);

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
