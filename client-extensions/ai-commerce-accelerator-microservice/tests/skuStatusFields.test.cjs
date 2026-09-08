const fs = require('fs');
const path = require('path');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

const MICROSERVICE_DIR = path.join(__dirname, '..');

/**
 * `published`, `purchasable` and `neverExpire` are decided here, not by the
 * model, so the schema and the prompt must not ask for them.
 *
 * `published` and `purchasable` are hardcoded true in both SKU payload paths
 * and have to be: SkuUtil defaults both to false when they are omitted, which
 * produces an unpublished, unpurchasable SKU under a product that looks
 * complete. `neverExpire` comes from the `catalog-expiry-config` entry (#688),
 * because how long a generated catalogue stays purchasable is a property of the
 * environment rather than something a model has a view on.
 *
 * So every run used to spend tokens on three booleans that
 * `generators/product-steps/skus.cjs` discarded. See #689.
 */
describe('SKU status fields are the payload builder’s, not the model’s', () => {
  const OVERRIDDEN_FIELDS = ['neverExpire', 'published', 'purchasable'];

  describe('the generation contract does not ask for them', () => {
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(MICROSERVICE_DIR, 'generation-schemas/product.json'),
        'utf8'
      )
    );
    const productItem = schema.properties.products.items;

    it.each(['skus', 'skuVariants'])(
      'declares none of them on %s',
      (collection) => {
        const item = productItem.properties[collection].items;

        for (const field of OVERRIDDEN_FIELDS) {
          expect(Object.keys(item.properties)).not.toContain(field);
          expect(item.required || []).not.toContain(field);
        }
      }
    );

    it.each(OVERRIDDEN_FIELDS)('never mentions %s in the prompt', (field) => {
      const prompt = fs.readFileSync(
        path.join(MICROSERVICE_DIR, 'prompts/product.md'),
        'utf8'
      );

      expect(prompt).not.toContain(field);
    });
  });

  describe('the payload overrides whatever the model returned', () => {
    let generator;
    let session;
    let submitted;

    const runStep = async (step) => {
      const running = generator.steps[step]('sess-1');
      // create-skus waits on a real timer for Liferay's option links to
      // propagate; nothing asserted here depends on the wait.
      await vi.advanceTimersByTimeAsync(2000);
      return running;
    };

    beforeEach(() => {
      vi.clearAllMocks();
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      submitted = [];

      const liferay = {
        createProductsBatch: vi.fn().mockImplementation(async (_cfg, batch) => {
          submitted.push(...batch);
          return { batchId: 'b1' };
        }),
      };

      generator = new ProductGenerator({
        liferay,
        persistence: {
          getSession: vi.fn().mockImplementation(async () => session),
          updateSessionContext: vi.fn(),
          createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
          updateBatch: vi.fn().mockResolvedValue({}),
        },
        logger: {
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          trace: vi.fn(),
        },
        progress: { batchStarted: vi.fn(), batchCompleted: vi.fn() },
      });

      generator.completeSyncStep = vi.fn().mockResolvedValue({});
      generator.submitBatch = vi
        .fn()
        .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
          await send('BATCH-ERC');
        });

      session = {
        session_id: 'sess-1',
        correlationId: 'corr-1',
        context: {
          config: { batchSize: '10', catalogId: '123' },
          options: {},
          productDataList: [
            {
              externalReferenceCode: 'ERC1',
              name: { en_US: 'Trail Runner 500' },
              description: { en_US: 'A trail running shoe.' },
              shortDescription: { en_US: 'Trail running shoe' },
              // What a model would have to invent for these to matter. The
              // schema no longer asks, but a response is free to volunteer.
              skus: [
                {
                  externalReferenceCode: 'TR500',
                  neverExpire: false,
                  price: 120,
                  published: false,
                  purchasable: false,
                  sku: 'TR500',
                },
              ],
            },
          ],
        },
      };
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each([S.CREATE_PRODUCTS, S.CREATE_PRODUCT_SKUS])(
      '%s publishes the SKU whatever the generated data said',
      async (step) => {
        await runStep(step);

        expect(submitted[0].skus[0]).toMatchObject({
          neverExpire: true,
          published: true,
          purchasable: true,
        });
      }
    );
  });
});
