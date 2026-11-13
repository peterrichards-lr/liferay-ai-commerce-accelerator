const getRoutes = require('../routes/get.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');

/**
 * The generator form counts the array under `warehouses` to say what a run
 * will create and to rule out "use existing" when there are none (#730,
 * #732). The route used to send the SDK's { items, totalCount, truncated }
 * object there instead, so the form never learned the count (#1420).
 */
describe('get-warehouses answers the array the form counts (#1420)', () => {
  let registeredRoutes;
  let liferayService;

  const invoke = async () => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        localeCode: 'en-US',
      },
      headers: { host: 'localhost:3000' },
      correlationId: 'test-cid',
      method: 'POST',
      url: INTERNAL_API_PATHS.GET_WAREHOUSES,
      ip: '127.0.0.1',
      get: () => 'vitest',
    };
    const res = {
      statusCode: 200,
      status: vi.fn(function status(code) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn().mockReturnThis(),
    };

    await registeredRoutes.get(INTERNAL_API_PATHS.GET_WAREHOUSES)(req, res);

    return res.json.mock.calls[0][0];
  };

  beforeEach(() => {
    registeredRoutes = new Map();

    const appMock = {
      post: vi.fn((path, ...handlers) => {
        registeredRoutes.set(path, handlers[handlers.length - 1]);
      }),
    };

    liferayService = { getWarehouses: vi.fn() };

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
    };

    getRoutes(appMock, { liferayService, logger });
  });

  it('sends the warehouses themselves, not the SDK envelope', async () => {
    const items = [
      { id: 1, name: 'North' },
      { id: 2, name: 'South' },
    ];
    liferayService.getWarehouses.mockResolvedValue({
      items,
      totalCount: 2,
      truncated: false,
    });

    const body = await invoke();

    expect(body.success).toBe(true);
    expect(body.warehouses).toEqual(items);
    expect(body.truncated).toBe(false);
  });

  it('sends an empty array for an instance with none, which the form reads as zero', async () => {
    liferayService.getWarehouses.mockResolvedValue({
      items: [],
      totalCount: 0,
      truncated: false,
    });

    const body = await invoke();

    expect(body.warehouses).toEqual([]);
  });

  it('says when the list was cut short, so the form does not count it', async () => {
    liferayService.getWarehouses.mockResolvedValue({
      items: [{ id: 1, name: 'North' }],
      totalCount: 1,
      truncated: true,
    });

    const body = await invoke();

    expect(body.truncated).toBe(true);
  });
});
