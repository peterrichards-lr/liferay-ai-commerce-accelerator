const ContractValidator = require('../services/contractValidator.cjs');
const MockDataGenerator = require('../generators/mockDataGenerator.cjs');
const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;
const CATALOG_SPEC = 'headless-commerce-admin-catalog-v1.0-openapi.json';

/**
 * What create-products actually POSTs, asserted against Liferay's DTO.
 *
 * `contractCompliance` validates `MockDataGenerator` output, which is the
 * wrong end of the pipeline: the mock stands in for the AI, so what it emits
 * is generation-schema shaped and the product step still has to derive
 * Liferay's payload from it. That derivation is where #648 and #651 both
 * failed, and the specification assertion there passes only by coincidence -
 * `ProductSpecification` happens to declare the same three properties the
 * generation schema requires. See #698.
 *
 * So these drive the real steps, on the real ProductGenerator, and assert the
 * chunk handed to `liferay.createProductsBatch`.
 */
const SPECIFICATION_CATEGORY_ID = 909;

/**
 * The generation schema requires a name, a description and a short
 * description, and the product step throws without them - so a fixture that
 * leaves them out is not a product any run could produce.
 */
const aProduct = (overrides = {}) => ({
  description: { en_US: 'A trail running shoe built for wet ground.' },
  name: { en_US: 'Trail Runner 500' },
  shortDescription: { en_US: 'Trail running shoe' },
  ...overrides,
});

const silentLogger = () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
});

/**
 * Runs the steps that build the create-products payload and returns it.
 *
 * `steps` is the list actually executed, so a test can leave a step out the
 * way a run with the toggle off does.
 */
async function prepareProducts({
  generated,
  options = {},
  config = {},
  context = {},
  steps = [
    S.GENERATE_PRODUCT_DATA,
    S.ENSURE_SPECIFICATION_CATEGORIES,
    S.ENSURE_SPECIFICATIONS,
    S.ENSURE_OPTIONS,
    S.CREATE_PRODUCTS,
  ],
} = {}) {
  const submitted = [];
  const logger = silentLogger();
  let nextSpecificationId = 5000;
  let nextOptionId = 6000;

  const session = {
    session_id: 'sess-1',
    correlationId: 'corr-1',
    context: {
      config: { batchSize: '10', catalogId: '123', channelId: '77', ...config },
      options,
      ...context,
    },
  };

  const persistence = {
    createBatch: vi.fn().mockResolvedValue({ id: 'batch-1' }),
    getSession: vi.fn().mockImplementation(async () => session),
    updateBatch: vi.fn().mockResolvedValue({}),
    updateSessionContext: vi.fn().mockImplementation(async (_id, patch) => {
      Object.assign(session.context, patch);
    }),
  };

  const liferay = {
    createOptionWithReuse: vi.fn().mockImplementation(async (_cfg, option) => ({
      externalReferenceCode: option.externalReferenceCode,
      id: nextOptionId++,
      key: option.key,
    })),
    createProductsBatch: vi.fn().mockImplementation(async (_cfg, chunk) => {
      submitted.push(...chunk);

      return { batchId: 'b1' };
    }),
    createSpecificationCategoryWithReuse: vi
      .fn()
      .mockImplementation(async (_cfg, category) => ({
        id: SPECIFICATION_CATEGORY_ID,
        key: category.key,
        title: category.title,
      })),
    createSpecificationWithReuse: vi
      .fn()
      .mockImplementation(async (_cfg, specification) => ({
        externalReferenceCode: specification.externalReferenceCode,
        id: nextSpecificationId++,
        key: specification.key,
      })),
  };

  const generator = new ProductGenerator({
    generation: { generateData: vi.fn().mockResolvedValue(generated) },
    liferay,
    logger,
    persistence,
    progress: { batchCompleted: vi.fn(), batchStarted: vi.fn() },
  });

  generator.completeSyncStep = vi.fn().mockResolvedValue({});
  generator.submitBatch = vi
    .fn()
    .mockImplementation(async (_sessionId, _step, _kind, _op, send) => {
      await send('BATCH-ERC');
    });

  for (const step of steps) {
    await generator.steps[step]('sess-1');
  }

  return {
    logger,
    productDataList: session.context.productDataList,
    submitted,
  };
}

describe('the payload create-products sends', () => {
  let validator;

  beforeAll(() => {
    validator = new ContractValidator({ DEBUG: true, logger: silentLogger() });
  });

  it('is validated against a real Liferay spec, not a placeholder', () => {
    // A hand-written stand-in asserts almost nothing, so a pass against one
    // would carry no information and every test below would be theatre.
    expect(validator.isPlaceholderSpec(CATALOG_SPEC)).toBe(false);
    expect(
      validator.describeSchema(CATALOG_SPEC, 'Product').properties
    ).toEqual(expect.arrayContaining(['productSpecifications', 'skus']));
  });

  it('matches the Product DTO for a full generated catalogue', async () => {
    const mock = new MockDataGenerator({
      DEBUG: false,
      logger: silentLogger(),
    });
    const { submitted } = await prepareProducts({
      generated: mock.generateProductData(
        'Electronics',
        3,
        {},
        null,
        ['en-US'],
        {
          generateSkuVariants: true,
        }
      ),
      options: { generateSkuVariants: true, generateSpecifications: true },
    });

    expect(submitted).toHaveLength(3);
    expect(() =>
      validator.validateArray(CATALOG_SPEC, 'Product', submitted)
    ).not.toThrow();
  });

  it('derives Liferay specifications from the generation schema names alone', async () => {
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          specifications: [
            {
              label: { en_US: 'Material' },
              specificationKey: 'Outer Material',
              value: { en_US: 'Ripstop' },
            },
          ],
        }),
      ],
      options: { generateSpecifications: true, productCount: 1 },
    });

    expect(submitted[0].productSpecifications).toEqual([
      {
        // Liferay normalizes only on lookup, never on write, so the key has to
        // arrive normalized or ensure-specifications' row is never matched.
        specificationKey: 'outer-material',
        label: { en_US: 'Material' },
        value: { en_US: 'Ripstop' },
        optionCategoryId: SPECIFICATION_CATEGORY_ID,
        specificationId: 5000,
        specificationExternalReferenceCode:
          expect.stringContaining('AICA-SPEC'),
      },
    ]);
    expect(() =>
      validator.validate(CATALOG_SPEC, 'Product', submitted[0])
    ).not.toThrow();
  });

  it('normalizes the specification key whatever route reached the step', async () => {
    // Liferay normalizes a specification key on lookup but stores it verbatim,
    // so a raw key writes a row ensure-specifications can never match again.
    // Generation normalizes on the way through; this asserts the step does not
    // rely on that, because the context can be seeded by an import or a resume.
    const { submitted } = await prepareProducts({
      context: {
        defaultSpecificationCategoryId: SPECIFICATION_CATEGORY_ID,
        productDataList: [
          aProduct({
            externalReferenceCode: 'AICA-PRD-SEEDED',
            productSpecifications: [
              {
                label: { en_US: 'Material' },
                specificationKey: 'Outer Material',
                value: { en_US: 'Ripstop' },
              },
            ],
          }),
        ],
      },
      options: { generateSpecifications: true, productCount: 1 },
      steps: [S.CREATE_PRODUCTS],
    });

    expect(submitted[0].productSpecifications[0].specificationKey).toBe(
      'outer-material'
    );
  });

  it('never carries an external reference code on a nested specification', async () => {
    // Liferay reads one there as the ProductSpecification's own code and
    // rejects the product. See #652.
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          specifications: [
            {
              externalReferenceCode: 'AICA-SPEC-OWN',
              label: { en_US: 'Brand' },
              specificationKey: 'brand',
              value: { en_US: 'AICA' },
            },
          ],
        }),
      ],
      options: { generateSpecifications: true, productCount: 1 },
    });

    expect(submitted[0].productSpecifications[0]).not.toHaveProperty(
      'externalReferenceCode'
    );
    expect(
      submitted[0].productSpecifications[0].specificationExternalReferenceCode
    ).toEqual(expect.stringContaining('AICA-SPEC'));
  });

  it('sends the ids ensure-specifications resolved, whichever name is read', async () => {
    // The step deep-clones the session context, which splits `specifications`
    // and `productSpecifications` into two independent arrays. Only one used
    // to be resolved, and the payload was correct only because every reader
    // happened to check that one first. See #698.
    const { productDataList, submitted } = await prepareProducts({
      generated: [
        aProduct({
          specifications: [
            {
              label: { en_US: 'Brand' },
              specificationKey: 'brand',
              value: { en_US: 'AICA' },
            },
          ],
        }),
      ],
      options: { generateSpecifications: true, productCount: 1 },
    });

    expect(productDataList[0].specifications).toEqual(
      productDataList[0].productSpecifications
    );
    expect(productDataList[0].specifications[0].specificationId).toBe(5000);
    expect(submitted[0].productSpecifications[0].specificationId).toBe(5000);
  });

  it('sends the option ids ensure-options resolved, whichever name is read', async () => {
    // A product carrying both names is what an imported dataset looks like.
    // ensure-options deep-clones the context, which splits them, and then
    // resolves only the copy its read picked.
    const colour = {
      fieldType: 'select',
      name: 'Colour',
      productOptionValues: ['Red'],
      skuContributor: true,
    };
    const { productDataList } = await prepareProducts({
      generated: [
        aProduct({
          options: [{ ...colour }],
          productOptions: [{ ...colour }],
          skuVariants: [{ options: { Colour: 'Red' }, sku: 'TR500-RED' }],
        }),
      ],
      options: {
        generateSkuVariants: true,
        generateSpecifications: true,
        productCount: 1,
      },
    });

    expect(productDataList[0].productOptions[0].optionId).toBe(6000);
    expect(productDataList[0].options).toEqual(
      productDataList[0].productOptions
    );
  });

  it('writes option value coverage back under the name the product carries', async () => {
    // An extracted dataset arrives under Liferay's names. The coverage pass
    // used to write its result to `options` whatever it read, so a product
    // carrying `productOptions` kept the uncovered list under the name every
    // downstream reader consults first - the value was declared and then
    // thrown away, and the SKU using it stayed inactive. See #698 and #754.
    const { productDataList } = await prepareProducts({
      generated: [
        aProduct({
          productOptions: [
            {
              fieldType: 'select',
              name: 'Colour',
              productOptionValues: ['Red'],
              skuContributor: true,
            },
          ],
          skuVariants: [{ options: { Colour: 'Blue' }, sku: 'TR500-BLUE' }],
        }),
      ],
      options: { generateSkuVariants: true, productCount: 1 },
      steps: [S.GENERATE_PRODUCT_DATA],
    });

    expect(productDataList[0].productOptions[0].productOptionValues).toContain(
      'Blue'
    );
    expect(productDataList[0].options).toBeUndefined();
  });

  it('omits the base SKU when SKU-contributing options will replace it', async () => {
    // create-skus sends the variants instead, and they can only carry the
    // right skuOptions once link-product-options has run.
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          options: [
            {
              fieldType: 'select',
              name: 'Colour',
              productOptionValues: ['Red'],
              skuContributor: true,
            },
          ],
          skus: [{ externalReferenceCode: 'TR500', sku: 'TR500' }],
          skuVariants: [{ options: { Colour: 'Red' }, sku: 'TR500-RED' }],
        }),
      ],
      options: { generateSkuVariants: true, productCount: 1 },
    });

    expect(submitted[0].skus).toBeUndefined();
  });

  it('sends the base SKU when the run creates no variants', async () => {
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          skus: [{ externalReferenceCode: 'TR500', sku: 'TR500' }],
        }),
      ],
      options: { generateSkuVariants: false, productCount: 1 },
    });

    expect(submitted[0].skus).toEqual([
      {
        externalReferenceCode: 'TR500',
        neverExpire: true,
        published: true,
        purchasable: true,
        sku: 'TR500',
      },
    ]);
    expect(() =>
      validator.validate(CATALOG_SPEC, 'Product', submitted[0])
    ).not.toThrow();
  });

  it('sends no specifications at all when the run disabled them', async () => {
    // Nothing registers a definition on such a run, so a specification sent
    // here would have nothing to resolve against. See #647.
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          specifications: [
            {
              label: { en_US: 'Brand' },
              specificationKey: 'brand',
              value: { en_US: 'AICA' },
            },
          ],
        }),
      ],
      options: { generateSpecifications: false, productCount: 1 },
      steps: [S.GENERATE_PRODUCT_DATA, S.CREATE_PRODUCTS],
    });

    // Empty rather than absent: the field is always sent, and what matters is
    // that it names nothing Liferay would have to resolve.
    expect(submitted[0].productSpecifications).toEqual([]);
  });

  it('drops an unresolved category rather than the whole product', async () => {
    // `{ id: undefined }` serialises to `{}`, which Liferay rejects for the
    // entire product. See #651.
    const { submitted } = await prepareProducts({
      generated: [
        aProduct({
          categories: [{ id: 42 }, { id: undefined }, { id: 0 }],
        }),
      ],
      options: { productCount: 1 },
    });

    expect(submitted[0].categories).toEqual([{ id: 42 }]);
    expect(() =>
      validator.validate(CATALOG_SPEC, 'Product', submitted[0])
    ).not.toThrow();
  });
});
