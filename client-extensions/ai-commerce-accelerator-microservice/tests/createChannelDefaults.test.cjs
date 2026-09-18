const getRoutes = require('../routes/get.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');

/**
 * What the create-channel route is allowed to decide for the operator (#745).
 *
 * A channel's currency becomes the currency of every run that selects it, and
 * the route used to supply one when the request carried none: a run configured
 * as EUR produced a USD channel, and nothing reported the substitution. The
 * defect is not which currency was chosen - it is that the route chose at all,
 * so these tests assert a refusal rather than a better default.
 */
describe('Create Channel: the route substitutes nothing (#745)', () => {
  let registeredRoutes;
  let liferayService;
  let logger;

  const invoke = async (body) => {
    const req = {
      body,
      headers: { host: 'localhost:3000' },
      correlationId: 'test-cid',
      method: 'POST',
      url: INTERNAL_API_PATHS.CREATE_CHANNEL,
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

    await registeredRoutes[INTERNAL_API_PATHS.CREATE_CHANNEL](req, res);

    return res;
  };

  const bodyOf = (res) => res.json.mock.calls[0][0];

  beforeEach(() => {
    registeredRoutes = {};

    const appMock = {
      post: vi.fn((path, ...handlers) => {
        registeredRoutes[path] = handlers[handlers.length - 1];
      }),
    };

    liferayService = {
      createChannel: vi.fn().mockResolvedValue({
        id: 35094,
        name: 'Solara Moto Storefront',
        currencyCode: 'EUR',
        type: 'site',
      }),
    };

    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
      debug: vi.fn(),
    };

    getRoutes(appMock, { liferayService, logger });
  });

  const connection = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    localeCode: 'en-US',
  };

  it('creates the channel with exactly the currency and name it was given', async () => {
    const res = await invoke({
      ...connection,
      currencyCode: 'EUR',
      name: 'Solara Moto Storefront',
    });

    expect(liferayService.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ liferayUrl: 'http://localhost:8080' }),
      { currencyCode: 'EUR', name: 'Solara Moto Storefront', type: 'site' }
    );
    expect(bodyOf(res).success).toBe(true);
  });

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'refuses to create a channel when the currency is %s, rather than using USD',
    async (_label, currencyCode) => {
      const res = await invoke({
        ...connection,
        currencyCode,
        name: 'Solara Moto Storefront',
      });

      expect(liferayService.createChannel).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);

      const body = bodyOf(res);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/currencyCode is required/i);
      expect(body.error).not.toMatch(/USD/);
    }
  );

  it.each([
    ['omitted', undefined],
    ['null', null],
    ['empty', ''],
    ['whitespace', '   '],
  ])(
    'refuses to create a channel when the name is %s, rather than naming it itself',
    async (_label, name) => {
      const res = await invoke({ ...connection, currencyCode: 'EUR', name });

      expect(liferayService.createChannel).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);

      const body = bodyOf(res);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/name is required/i);
      expect(body.error).not.toMatch(/AI Commerce Storefront/);
    }
  );

  it('never sends USD to Liferay unless USD was asked for', async () => {
    await invoke({ ...connection, currencyCode: 'GBP', name: 'Anything' });
    await invoke({ ...connection, name: 'Anything' });
    await invoke({ ...connection, currencyCode: '', name: 'Anything' });

    const currenciesSent = liferayService.createChannel.mock.calls.map(
      ([, payload]) => payload.currencyCode
    );

    expect(currenciesSent).toEqual(['GBP']);
  });

  // Liferay's own Add Channel dialog offers Site and nothing else, so this is a
  // constant and not a default covering for an absent choice. A caller cannot
  // talk the route into another one.
  it('always creates a site channel, whatever type the caller asks for', async () => {
    await invoke({
      ...connection,
      currencyCode: 'EUR',
      name: 'Solara Moto Storefront',
      type: 'something-else',
    });

    expect(liferayService.createChannel).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'site' })
    );
  });
});
