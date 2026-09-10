const OrderGenerator = require('../generators/orderGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');

describe('OrderGenerator', () => {
  let generator;
  let mockCtx;
  let persistence;

  beforeEach(() => {
    persistence = new PersistenceService(':memory:');

    mockCtx = {
      persistence,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
      generation: {
        generateData: vi.fn().mockResolvedValue([
          {
            externalReferenceCode: 'ORDER-1',
            orderNumber: 'ORD-100',
            accountId: 1001,
            channelId: 44207,
            currencyCode: 'USD',
            items: [{ sku: 'SKU-1', quantity: 1, unitPrice: 100 }],
          },
        ]),
      },
      liferay: {
        getProductsWithSkus: vi.fn().mockResolvedValue({
          items: [
            {
              id: 2001,
              externalReferenceCode: 'P-1',
              skus: [{ sku: 'SKU-1', purchasable: true }],
              productStatus: 0,
            },
          ],
        }),
        getAccounts: vi.fn().mockResolvedValue({
          items: [{ id: 1001, externalReferenceCode: 'ACC-1' }],
        }),
        createOrdersBatch: vi
          .fn()
          .mockResolvedValue({ batchId: 'order-batch' }),
        createOrder: vi.fn().mockResolvedValue({ id: 5001 }),
      },
      progress: {
        sessionStarted: vi.fn(),
        sessionCompleted: vi.fn(),
        sessionFailed: vi.fn(),
        stepStarted: vi.fn(),
        stepProgress: vi.fn(),
        stepCompleted: vi.fn(),
        stepFailed: vi.fn(),
        batchStarted: vi.fn(),
        batchProgress: vi.fn(),
        batchCompleted: vi.fn(),
        batchFailed: vi.fn(),
      },
      batchCallback: {
        _checkSessionCompletion: vi
          .fn()
          .mockImplementation((sid) => generator.executeNextStep(sid)),
      },
    };

    generator = new OrderGenerator(mockCtx);
  });

  afterEach(() => {
    persistence.close();
  });

  it('should start order generation workflow', async () => {
    const config = {
      liferayUrl: 'http://test',
      channelId: '44207',
      catalogId: '32693',
      currencyCode: 'USD',
    };
    const options = { orderCount: 1 };

    const result = await generator.runWorkflow(config, options);

    expect(result.sessionId).toBeDefined();
    expect(result.message).toContain('started');

    const session = await persistence.getSession(result.sessionId);
    expect(session).not.toBeNull();
    expect(session.flow_type).toBe('orders');
  });

  it('should run order data generation step', async () => {
    const sessionId = 'order-test-session';
    await persistence.createSession({
      sessionId,
      flowType: 'orders',
      status: 'STARTED',
      context: {
        config: { channelId: '44207', catalogId: '32693', currencyCode: 'USD' },
        options: { orderCount: 1 },
        steps: [{ name: 'generate-order-data' }],
      },
    });

    // Mock internal methods
    generator.getProductsAndAccounts = vi.fn().mockResolvedValue({
      products: [
        {
          id: 2001,
          skus: [{ sku: 'SKU-1', purchasable: true }],
          productStatus: 0,
        },
      ],
      accounts: [{ id: 1001 }],
    });

    generator._generateOrderData = vi
      .fn()
      .mockResolvedValue([{ externalReferenceCode: 'ORDER-1' }]);

    await generator._runOrderDataGenerationStep(sessionId);

    const session = await persistence.getSession(sessionId);
    expect(session.context.orderDataList).toHaveLength(1);
  });

  it('should handle order creation step (batch mode)', async () => {
    const sessionId = 'test-session-batch';
    await persistence.createSession({
      sessionId,
      flowType: 'orders',
      status: 'STARTED',
      context: {
        config: {
          channelId: '44207',
          catalogId: '32693',
          currencyCode: 'USD',
          batchSize: 2,
        },
        options: { orderCount: 2 },
        products: [
          {
            id: 2001,
            externalReferenceCode: 'P1',
            skus: [{ sku: 'S1', purchasable: true }],
            productStatus: 0,
          },
        ],
        accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
        steps: [{ name: 'create-orders' }],
        orderDataList: [
          { externalReferenceCode: 'O1', accountId: 1001 },
          { externalReferenceCode: 'O2', accountId: 1001 },
        ],
      },
    });

    generator.getProductsAndAccounts = vi.fn().mockResolvedValue({
      products: [
        {
          id: 2001,
          skus: [{ sku: 'S1', purchasable: true }],
          productStatus: 0,
          externalReferenceCode: 'P1',
        },
      ],
      accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
    });

    await generator._runOrderCreationStep(sessionId);

    expect(mockCtx.liferay.createOrdersBatch).toHaveBeenCalled();
  });

  it('should handle order creation step (individual mode)', async () => {
    const sessionId = 'test-session-individual';
    await persistence.createSession({
      sessionId,
      flowType: 'orders',
      status: 'STARTED',
      context: {
        config: {
          channelId: '44207',
          catalogId: '32693',
          currencyCode: 'USD',
          batchSize: 1,
        },
        options: { orderCount: 1 },
        products: [
          {
            id: 2001,
            externalReferenceCode: 'P1',
            skus: [{ sku: 'S1', purchasable: true }],
            productStatus: 0,
          },
        ],
        accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
        steps: [{ name: 'create-orders' }],
        orderDataList: [{ externalReferenceCode: 'O1', accountId: 1001 }],
      },
    });

    generator.getProductsAndAccounts = vi.fn().mockResolvedValue({
      products: [
        {
          id: 2001,
          skus: [{ sku: 'S1', purchasable: true }],
          productStatus: 0,
          externalReferenceCode: 'P1',
        },
      ],
      accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
    });

    await generator._runOrderCreationStep(sessionId);

    expect(mockCtx.liferay.createOrder).toHaveBeenCalled();
  });

  // The split was read off `config`, which nothing ever put it on, so every
  // order took the default status regardless of what the operator set. See #696.
  it('applies the operator order status distribution from options', async () => {
    const sessionId = 'test-session-distribution';
    const orderDataList = Array.from({ length: 10 }, (_unused, index) => ({
      externalReferenceCode: `O${index}`,
      accountId: 1001,
    }));

    await persistence.createSession({
      sessionId,
      flowType: 'orders',
      status: 'STARTED',
      context: {
        config: {
          channelId: '44207',
          catalogId: '32693',
          currencyCode: 'USD',
          batchSize: 10,
        },
        options: {
          orderCount: 10,
          orderDistribution: { open: 40, completed: 60 },
        },
        products: [],
        accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
        steps: [{ name: 'create-orders' }],
        orderDataList,
      },
    });

    generator.getProductsAndAccounts = vi.fn().mockResolvedValue({
      products: [
        {
          id: 2001,
          skus: [{ sku: 'S1', purchasable: true }],
          productStatus: 0,
          externalReferenceCode: 'P1',
        },
      ],
      accounts: [{ id: 1001, externalReferenceCode: 'A1' }],
    });

    await generator._runOrderCreationStep(sessionId);

    const session = await persistence.getSession(sessionId);
    const statuses = session.context.orderDataList.map(
      (order) => order.orderStatus
    );

    expect(statuses.filter((status) => status === 0)).toHaveLength(4);
    expect(statuses.filter((status) => status === 10)).toHaveLength(6);
  });

  describe('account eligibility for orders', () => {
    const config = { channelId: 44207, catalogId: 1, currencyCode: 'USD' };

    beforeEach(() => {
      // getProductsAndAccounts fetches products via getProducts and SKUs via
      // rest._get, and retries 5 times with a 5s delay while products is empty.
      mockCtx.liferay.getProducts = vi.fn().mockResolvedValue({
        items: [{ id: 2001, externalReferenceCode: 'P-1', name: 'Widget' }],
      });
      mockCtx.liferay.rest = {
        _get: vi.fn().mockResolvedValue({
          items: [
            {
              sku: 'SKU-1',
              purchasable: true,
              productName: { en_US: 'Widget' },
            },
          ],
        }),
      };
    });

    const withAccounts = (items) => {
      mockCtx.liferay.getAccounts = vi.fn().mockResolvedValue({ items });
    };

    it('never assigns orders to guest or supplier accounts', async () => {
      withAccounts([
        { id: 1, externalReferenceCode: 'A1', type: 'business' },
        { id: 2, externalReferenceCode: 'A2', type: 'guest' },
        { id: 3, externalReferenceCode: 'A3', type: 'supplier' },
      ]);

      const { accounts } = await generator.getProductsAndAccounts(config, {
        options: {},
      });

      expect(accounts.map((a) => a.id)).toEqual([1]);
    });

    it('narrows to the requested account type', async () => {
      withAccounts([
        { id: 1, externalReferenceCode: 'A1', type: 'business' },
        { id: 2, externalReferenceCode: 'A2', type: 'person' },
      ]);

      const { accounts } = await generator.getProductsAndAccounts(config, {
        options: { orderAccountType: 'person' },
      });

      expect(accounts.map((a) => a.id)).toEqual([2]);
    });

    it('requests the type field so the filter has something to act on', async () => {
      withAccounts([{ id: 1, externalReferenceCode: 'A1', type: 'business' }]);

      await generator.getProductsAndAccounts(config, { options: {} });

      // getAccounts is (config, options). Asserting on a third positional
      // argument is what let the real defect through: the field list was
      // passed there, discarded, and `fields` fell back to a default with no
      // `type` - the very field the filter below acts on. A `null` second
      // argument then threw outright, because a `= {}` parameter default
      // applies to `undefined` and not to `null`.
      const [, options] = mockCtx.liferay.getAccounts.mock.calls[0];
      expect(options).toBeTypeOf('object');
      expect(options).not.toBeNull();
      expect(options.fields).toContain('type');
    });

    it('fails with a 400 naming the type when none are eligible', async () => {
      withAccounts([{ id: 2, externalReferenceCode: 'A2', type: 'person' }]);

      await expect(
        generator.getProductsAndAccounts(config, {
          options: { orderAccountType: 'business' },
        })
      ).rejects.toThrow(/No business accounts/);
    });

    it('still uses newly created accounts without filtering them', async () => {
      // The combined flow creates accounts of the configured type already, so
      // the eligibility filter must not second-guess them.
      const created = [{ id: 9, externalReferenceCode: 'NEW-1' }];

      const { accounts } = await generator.getProductsAndAccounts(config, {
        accountsToCreate: created,
        options: { orderAccountType: 'business' },
      });

      expect(accounts).toEqual(created);
      expect(mockCtx.liferay.getAccounts).not.toHaveBeenCalled();
    });
  });

  // A `generateSkuVariants: false` run creates the base SKU and nothing else -
  // `products.cjs` omits it only when variants are being created, and
  // `skus.cjs` replaces `lp.skus` with the variants under the same condition.
  // The product data does not say so: `prompts/product.md` asks for
  // `skuVariants` and `skuContributor` whatever the run, and `generation.cjs`
  // keeps what the model returns. Read alone, that product looks like a variant
  // product, and the pool ends up naming variants Liferay never created - the
  // #747 failure with the two SKU lists the other way round. See #810.
  describe('the SKU pool on a run that is not creating variants', () => {
    const config = { channelId: 44207, catalogId: 1, currencyCode: 'USD' };

    const productData = {
      externalReferenceCode: 'AICA-PRD-1',
      name: { en_US: 'Widget' },
      options: [
        {
          name: 'Color',
          fieldType: 'select',
          productOptionValues: ['Red', 'Blue'],
          skuContributor: true,
        },
      ],
      skus: [{ sku: 'SKU-ELE-001', externalReferenceCode: 'SKU-ELE-001' }],
      skuVariants: [
        { sku: 'SKU-ELE-001-RED', externalReferenceCode: 'SKU-ELE-001-RED' },
        { sku: 'SKU-ELE-001-BLUE', externalReferenceCode: 'SKU-ELE-001-BLUE' },
      ],
    };

    beforeEach(() => {
      mockCtx.liferay.getProducts = vi.fn().mockResolvedValue({
        items: [
          { id: 2001, externalReferenceCode: 'AICA-PRD-1', name: 'Widget' },
        ],
      });
      // The SKUs have not reached the index yet, which is the case the merge
      // from `productDataList` exists for.
      mockCtx.liferay.rest = { _get: vi.fn().mockResolvedValue({ items: [] }) };
      mockCtx.liferay.getAccounts = vi.fn().mockResolvedValue({
        items: [{ id: 1, externalReferenceCode: 'A1', type: 'business' }],
      });
    });

    it('merges the base SKU rather than uncreated variants', async () => {
      const { products } = await generator.getProductsAndAccounts(config, {
        options: { generateSkuVariants: false },
        productDataList: [productData],
      });

      expect(products[0].skus.map((sku) => sku.sku)).toEqual(['SKU-ELE-001']);
    });

    it('draws order items from the SKU Liferay actually created', () => {
      const payload = generator.buildOrderPayload(
        config,
        { accountId: 1, items: [{ quantity: 1, sku: 'SKU-ELE-001' }] },
        [{ id: 1, externalReferenceCode: 'A1' }],
        [productData],
        [],
        { generateSkuVariants: false }
      );

      expect(payload.orderItems.map((item) => item.sku)).toEqual([
        'SKU-ELE-001',
      ]);
    });

    it('still orders the variants when the run created them', () => {
      const payload = generator.buildOrderPayload(
        config,
        { accountId: 1, items: [{ quantity: 1, sku: 'SKU-ELE-001-RED' }] },
        [{ id: 1, externalReferenceCode: 'A1' }],
        [productData],
        [],
        { generateSkuVariants: true }
      );

      expect(payload.orderItems.map((item) => item.sku)).toEqual([
        'SKU-ELE-001-RED',
      ]);
    });
  });
});
