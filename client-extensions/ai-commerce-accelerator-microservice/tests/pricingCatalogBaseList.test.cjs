const ProductGenerator = require('../generators/productGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

// Liferay creates "<catalog> Base Price List" and "<catalog> Base Promotion"
// when a catalog is created, and files Sku.price into whichever list carries
// catalogBasePriceList for that type. AICA adopts those lists rather than
// standing up a competing pair, so a SKU has one price in every view.
describe('Pricing steps: catalog base price list adoption', () => {
  const CATALOG_ID = '123';

  let productGenerator;
  let mockLiferay;
  let mockSession;

  const liferayBasePriceList = () => ({
    catalogBasePriceList: true,
    catalogId: CATALOG_ID,
    externalReferenceCode: null,
    id: 'base-pl',
    name: 'Master Base Price List',
    type: 'price-list',
  });

  const liferayBasePromotion = () => ({
    catalogBasePriceList: true,
    catalogId: CATALOG_ID,
    externalReferenceCode: null,
    id: 'base-promo',
    name: 'Master Base Promotion',
    type: 'promotion',
  });

  const productWithPrice = () => ({
    externalReferenceCode: 'ERC1',
    name: { en_US: 'Product 1' },
    priceEntries: [
      { price: 99.99, promoPrice: 79.99, skuExternalReferenceCode: 'SKU1' },
    ],
    skus: [{ externalReferenceCode: 'SKU1', id: 'sku-123' }],
  });

  const submittedEntries = () =>
    mockLiferay.createPriceEntriesBatch.mock.calls.map(([, entries, opts]) => ({
      entries,
      opts,
    }));

  beforeEach(() => {
    vi.clearAllMocks();

    mockLiferay = {
      createPriceEntriesBatch: vi.fn().mockResolvedValue({ batchId: 'b-1' }),
      createPriceList: vi
        .fn()
        .mockImplementation((_config, data) =>
          Promise.resolve({ ...data, id: `created-${data.type}` })
        ),
      getPriceEntries: vi.fn().mockResolvedValue({ items: [] }),
      getPriceListByERC: vi.fn().mockResolvedValue(null),
      getPriceLists: vi
        .fn()
        .mockResolvedValue({ items: [liferayBasePriceList()] }),
      patchPriceList: vi.fn().mockResolvedValue({}),
      rest: { _delete: vi.fn().mockResolvedValue({}) },
    };

    productGenerator = new ProductGenerator({
      liferay: mockLiferay,
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        trace: vi.fn(),
        warn: vi.fn(),
      },
      persistence: {
        createBatch: vi.fn().mockResolvedValue({}),
        getSession: vi.fn(),
        updateBatch: vi.fn().mockResolvedValue({}),
      },
      progress: { batchCompleted: vi.fn(), batchStarted: vi.fn() },
    });

    productGenerator.completeSyncStep = vi.fn().mockResolvedValue({});
    productGenerator.submitBatch = vi
      .fn()
      .mockImplementation(async (_s, _k, _e, _o, fn) => fn('batch-erc'));

    mockSession = {
      correlationId: 'corr-1',
      session_id: 'sess-1',
      context: {
        config: { catalogId: CATALOG_ID, currencyCode: 'USD' },
        options: { generatePriceLists: true },
        productDataList: [productWithPrice()],
      },
    };
    productGenerator.persistence.getSession.mockResolvedValue(mockSession);
  });

  const runPricing = () =>
    productGenerator.steps[WORKFLOW_STEPS.GENERATE_PRICE_LISTS]('sess-1');

  const runCatalogConfig = () =>
    productGenerator.steps[WORKFLOW_STEPS.UPDATE_CATALOG_CONFIG]('sess-1');

  it('writes standard prices into the catalog base list instead of creating one', async () => {
    await runPricing();

    expect(mockLiferay.createPriceList).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'price-list' })
    );

    const [standard] = submittedEntries();
    expect(standard.entries).toHaveLength(1);
    expect(standard.entries[0].priceListId).toBe('base-pl');
    expect(standard.opts.priceListId).toBe('base-pl');
    expect(standard.opts.priceListExternalReferenceCode).toBeNull();
  });

  it('creates its own list only for a purpose the catalog has no list for', async () => {
    await runPricing();

    expect(mockLiferay.createPriceList).toHaveBeenCalledTimes(1);
    const [, promotionPayload] = mockLiferay.createPriceList.mock.calls[0];
    expect(promotionPayload.type).toBe('promotion');
    expect(promotionPayload.name).toBe(`AICA - Promotions (${CATALOG_ID})`);
    expect(promotionPayload.neverExpire).toBe(true);
  });

  it('updates the entry Liferay already filed from Sku.price rather than adding a second', async () => {
    mockLiferay.getPriceLists.mockResolvedValue({
      items: [liferayBasePriceList(), liferayBasePromotion()],
    });
    mockLiferay.getPriceEntries.mockImplementation((_config, priceListId) =>
      Promise.resolve({
        items:
          priceListId === 'base-pl'
            ? [
                {
                  price: 0,
                  priceEntryId: 8801,
                  skuExternalReferenceCode: 'SKU1',
                  skuId: 'sku-123',
                },
              ]
            : [],
      })
    );

    await runPricing();

    const [standard, promotion] = submittedEntries();
    expect(standard.entries[0].priceEntryId).toBe(8801);
    expect(standard.entries[0].price).toBe(99.99);
    expect(promotion.entries[0].priceEntryId).toBeUndefined();
  });

  it('never asks for entries of a list it has just created', async () => {
    await runPricing();

    expect(mockLiferay.getPriceEntries).toHaveBeenCalledTimes(1);
    expect(mockLiferay.getPriceEntries).toHaveBeenCalledWith(
      expect.anything(),
      'base-pl',
      expect.anything()
    );
  });

  it('ignores a price list left flagged by an earlier AICA run', async () => {
    mockLiferay.getPriceLists.mockResolvedValue({
      items: [
        {
          catalogBasePriceList: true,
          catalogId: CATALOG_ID,
          externalReferenceCode: 'AICA-PL-GENERAL-123-abcd1234',
          id: 'stale-aica-pl',
          name: `AICA - Standard Prices (${CATALOG_ID})`,
          type: 'price-list',
        },
        { ...liferayBasePriceList(), catalogBasePriceList: false },
      ],
    });

    await runPricing();

    expect(mockLiferay.rest._delete).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('stale-aica-pl')
    );
    expect(submittedEntries()[0].entries[0].priceListId).toBe('base-pl');
  });

  describe('update-catalog-config', () => {
    it('leaves the catalog base lists alone once they are the targets', async () => {
      mockLiferay.getPriceLists.mockResolvedValue({
        items: [liferayBasePriceList(), liferayBasePromotion()],
      });

      await runCatalogConfig();

      expect(mockLiferay.patchPriceList).not.toHaveBeenCalled();
      expect(productGenerator.completeSyncStep).toHaveBeenCalledWith(
        'sess-1',
        WORKFLOW_STEPS.UPDATE_CATALOG_CONFIG,
        'SYNCHRONOUS',
        2,
        2
      );
    });

    it('restores the base flag onto the catalog list a previous run took it from', async () => {
      mockLiferay.getPriceLists.mockResolvedValue({
        items: [
          {
            catalogBasePriceList: true,
            catalogId: CATALOG_ID,
            externalReferenceCode: 'AICA-PL-GENERAL-123-abcd1234',
            id: 'stale-aica-pl',
            name: `AICA - Standard Prices (${CATALOG_ID})`,
            type: 'price-list',
          },
          { ...liferayBasePriceList(), catalogBasePriceList: false },
        ],
      });

      await runCatalogConfig();

      expect(mockLiferay.patchPriceList).toHaveBeenCalledWith(
        expect.anything(),
        'stale-aica-pl',
        { catalogBasePriceList: false }
      );
      expect(mockLiferay.patchPriceList).toHaveBeenCalledWith(
        expect.anything(),
        'base-pl',
        { catalogBasePriceList: true }
      );
    });
  });
});
