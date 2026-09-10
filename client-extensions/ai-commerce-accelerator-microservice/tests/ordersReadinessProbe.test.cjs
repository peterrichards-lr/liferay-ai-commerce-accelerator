const OrderGenerator = require('../generators/orderGenerator.cjs');
const PersistenceService = require('../services/persistenceService.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

// #866: the probe asks whether any product has appeared yet. It called
// getProductsWithSkus, which was cheap only because that method's SKU half was
// broken and swallowed its own failure. SDK #199 fixed that, so the SKU half
// now sweeps every page of the catalogue - once per poll, for data discarded
// on the next line.

describe('The orders readiness probe', () => {
  let generator;
  let liferay;

  const buildCtx = () => {
    liferay = {
      getProducts: vi.fn().mockResolvedValue({ items: [{ id: 1 }] }),
      getProductsWithSkus: vi.fn().mockResolvedValue({ items: [{ id: 1 }] }),
    };

    return {
      persistence: new PersistenceService(':memory:'),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
      },
      liferay,
      progress: { stepCompleted: vi.fn(), stepWarning: vi.fn() },
    };
  };

  // The check is the third argument to _runAdaptiveSyncDelayStep, so capturing
  // it is the only way to exercise the probe without the SDK's delay machinery.
  const captureCheck = () => {
    let check;
    generator._runAdaptiveSyncDelayStep = vi
      .fn()
      .mockImplementation(async (_sessionId, _stepKey, checkFn) => {
        check = checkFn;
        return true;
      });

    // The arrow in the constructor calls this._runAdaptiveSyncDelayStep at
    // invocation, so replacing the method afterwards still intercepts it.
    generator.steps[WORKFLOW_STEPS.SYNC_DELAY_ORDERS]('S1');

    return check;
  };

  beforeEach(() => {
    generator = new OrderGenerator(buildCtx());
  });

  it('reads products, not products-with-their-SKUs', async () => {
    const check = captureCheck();

    await check({ catalogId: 46066 });

    expect(liferay.getProducts).toHaveBeenCalledTimes(1);
    // The SKU sweep is the cost this avoids: pageSize bounds the products call
    // and not the sweep, so a poll would page the whole catalogue's SKUs.
    expect(liferay.getProductsWithSkus).not.toHaveBeenCalled();
  });

  it('asks for one product, because it is counting not collecting', async () => {
    const check = captureCheck();

    await check({ catalogId: 46066 });

    expect(liferay.getProducts).toHaveBeenCalledWith(
      { catalogId: 46066 },
      { catalogId: 46066, pageSize: 1 }
    );
  });

  it('is not ready when the catalogue is still empty', async () => {
    liferay.getProducts.mockResolvedValue({ items: [] });
    const check = captureCheck();

    expect(await check({ catalogId: 46066 })).toBe(false);
  });

  it('is ready once a product exists', async () => {
    const check = captureCheck();

    expect(await check({ catalogId: 46066 })).toBe(true);
  });

  it('treats a missing items array as not ready rather than throwing', async () => {
    liferay.getProducts.mockResolvedValue({});
    const check = captureCheck();

    expect(await check({ catalogId: 46066 })).toBe(false);
  });
});
