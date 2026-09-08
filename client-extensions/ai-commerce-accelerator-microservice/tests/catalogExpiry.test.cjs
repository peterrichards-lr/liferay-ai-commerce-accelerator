const ConfigService = require('../services/configService.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');
const {
  catalogExpiryFields,
  normalizeCatalogExpiryConfig,
} = require('../utils/catalogExpiry.cjs');

const S = WORKFLOW_STEPS;

/**
 * SkuUtil reads an omitted neverExpire as false and then gives the SKU an
 * expiration date a month out, so every generated SKU used to stop being
 * purchasable about thirty days after the run. These pin the default down at
 * each layer that could reintroduce it. See #681.
 */
describe('catalog expiry configuration', () => {
  describe('normalizeCatalogExpiryConfig', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['an empty object, which is what a missing entry reads as', {}],
      ['a non-object', 'catalog-expiry-config'],
    ])('defaults to never expiring for %s', (_label, raw) => {
      expect(normalizeCatalogExpiryConfig(raw)).toEqual({
        neverExpire: true,
        expiryDays: 30,
      });
    });

    it('honours an explicit opt-in to expiry', () => {
      expect(
        normalizeCatalogExpiryConfig({ neverExpire: false, expiryDays: 90 })
      ).toEqual({ neverExpire: false, expiryDays: 90 });
    });

    it('reads the booleans an operator typed as JSON strings', () => {
      expect(normalizeCatalogExpiryConfig({ neverExpire: 'false' })).toEqual({
        neverExpire: false,
        expiryDays: 30,
      });
      expect(normalizeCatalogExpiryConfig({ neverExpire: 'true' })).toEqual({
        neverExpire: true,
        expiryDays: 30,
      });
    });

    it.each([0, -1, 'soon', null])(
      'falls back to the default window for an unusable expiryDays (%s)',
      (expiryDays) => {
        expect(
          normalizeCatalogExpiryConfig({ neverExpire: false, expiryDays })
            .expiryDays
        ).toBe(30);
      }
    );

    it('takes whole days only', () => {
      expect(
        normalizeCatalogExpiryConfig({ neverExpire: false, expiryDays: 90.7 })
          .expiryDays
      ).toBe(90);
    });
  });

  describe('catalogExpiryFields', () => {
    it('sends neverExpire and no expiration date by default', () => {
      expect(catalogExpiryFields(undefined)).toEqual({ neverExpire: true });
    });

    it('sends a real expiration date rather than leaving it to Liferay', () => {
      const now = new Date('2026-09-08T09:30:15.500Z');

      expect(
        catalogExpiryFields({ neverExpire: false, expiryDays: 90 }, now)
      ).toEqual({
        neverExpire: false,
        // Second precision, which is the format Liferay writes dates back in.
        expirationDate: '2026-12-07T09:30:15Z',
      });
    });
  });

  describe('ConfigService.getCatalogExpiryConfig', () => {
    let configService;

    beforeEach(() => {
      const store = new Map();
      configService = new ConfigService({
        cache: {
          get: vi.fn((key) => store.get(key)),
          set: vi.fn((key, value) => store.set(key, value)),
          delete: vi.fn((key) => store.delete(key)),
          clear: vi.fn(() => store.clear()),
        },
        logger: {
          info: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          errorWithStack: vi.fn(),
        },
      });
      configService.setLiferayService({
        getConfig: vi.fn(),
        updateConfig: vi.fn(),
      });
    });

    it('defaults when the entry does not exist, as on an instance provisioned before it did', async () => {
      configService.liferay.getConfig.mockResolvedValue({ items: [] });

      await expect(configService.getCatalogExpiryConfig({})).resolves.toEqual({
        neverExpire: true,
        expiryDays: 30,
      });
    });

    it('defaults when the read fails', async () => {
      configService.liferay.getConfig.mockRejectedValue(new Error('nope'));

      await expect(configService.getCatalogExpiryConfig({})).resolves.toEqual({
        neverExpire: true,
        expiryDays: 30,
      });
    });

    it('reads the configured window', async () => {
      configService.liferay.getConfig.mockResolvedValue({
        items: [
          {
            configValue: JSON.stringify({
              neverExpire: false,
              expiryDays: 365,
            }),
          },
        ],
      });

      await expect(configService.getCatalogExpiryConfig({})).resolves.toEqual({
        neverExpire: false,
        expiryDays: 365,
      });
    });

    it('defaults the cached accessor too', () => {
      expect(configService.getCatalogExpiryConfigCached()).toEqual({
        neverExpire: true,
        expiryDays: 30,
      });
    });
  });

  describe('generated payloads', () => {
    let generator;
    let liferay;
    let submitted;
    let session;

    const buildGenerator = (configService) => {
      liferay = {
        createProductsBatch: vi.fn().mockImplementation(async (_cfg, batch) => {
          submitted.push(...batch);
          return { batchId: 'b1' };
        }),
        getProductsByERC: vi.fn().mockResolvedValue({ items: [] }),
      };

      const persistence = {
        getSession: vi.fn().mockImplementation(async () => session),
        updateSessionContext: vi.fn().mockImplementation((_id, patch) => {
          Object.assign(session.context, patch);
        }),
        createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
        updateBatch: vi.fn().mockResolvedValue({}),
      };

      generator = new ProductGenerator({
        liferay,
        persistence,
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          trace: vi.fn(),
        },
        progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
        ...(configService ? { config: configService } : {}),
      });

      generator.completeSyncStep = vi.fn().mockResolvedValue({});
      generator.submitBatch = vi
        .fn()
        .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
          await send('BATCH-ERC');
        });
    };

    beforeEach(() => {
      vi.clearAllMocks();
      // Only the clock: create-skus waits on a real timer for Liferay's option
      // links to propagate, and faking that stalls the step.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-09-08T09:30:15.500Z'));
      submitted = [];
      session = {
        session_id: 'sess-1',
        correlationId: 'corr-1',
        context: {
          config: { catalogId: '123', batchSize: '10' },
          options: {},
          productDataList: [
            {
              externalReferenceCode: 'ERC1',
              name: { en_US: 'Trail Runner 500' },
              description: { en_US: 'A trail running shoe.' },
              shortDescription: { en_US: 'Trail running shoe' },
              skus: [
                { sku: 'TR500', externalReferenceCode: 'TR500', price: 120 },
              ],
            },
          ],
        },
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('never expires a SKU when no configuration service is wired up', async () => {
      buildGenerator(null);

      await generator.steps[S.CREATE_PRODUCT_SKUS]('sess-1');

      expect(submitted[0].neverExpire).toBe(true);
      expect(submitted[0].skus[0]).toMatchObject({
        neverExpire: true,
        published: true,
        purchasable: true,
      });
      expect(submitted[0].skus[0].expirationDate).toBeUndefined();
    });

    it('never expires a SKU when the configuration entry is missing', async () => {
      buildGenerator({ getCatalogExpiryConfig: vi.fn().mockResolvedValue({}) });

      await generator.steps[S.CREATE_PRODUCT_SKUS]('sess-1');

      expect(submitted[0].skus[0].neverExpire).toBe(true);
      expect(submitted[0].skus[0].expirationDate).toBeUndefined();
    });

    it('expires the product and its SKUs together when a window is configured', async () => {
      buildGenerator({
        getCatalogExpiryConfig: vi
          .fn()
          .mockResolvedValue({ neverExpire: false, expiryDays: 90 }),
      });

      await generator.steps[S.CREATE_PRODUCTS]('sess-1');
      await generator.steps[S.CREATE_PRODUCT_SKUS]('sess-1');

      for (const product of submitted) {
        expect(product).toMatchObject({
          neverExpire: false,
          expirationDate: '2026-12-07T09:30:15Z',
        });
        expect(product.skus[0]).toMatchObject({
          neverExpire: false,
          expirationDate: '2026-12-07T09:30:15Z',
        });
      }
    });
  });
});
