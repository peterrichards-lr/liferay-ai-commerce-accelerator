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
});
