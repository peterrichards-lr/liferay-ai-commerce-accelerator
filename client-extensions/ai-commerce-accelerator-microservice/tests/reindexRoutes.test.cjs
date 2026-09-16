const reindexRoutes = require('../routes/reindex.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  MISSING_MESSAGE,
  SCOPE_DENIED_MESSAGE,
  getReindexStatus,
  reindexHealth,
  resetReindexStatus,
} = require('../utils/reindexStatus.cjs');

/**
 * What POST /reindex actually hands back on failure (#960).
 *
 * routes/reindex.cjs used to special-case ENDPOINT_MISSING and let every
 * other classified outcome fall through to a generic 500 built from
 * error.message - axios's "Request failed with status code 403" rather than
 * the message utils/reindexStatus.cjs composed. These tests drive the real
 * handler, the same way tests/deleteRoutes.test.cjs does, so a regression
 * shows up as a wrong status or body rather than a passing unit test of a
 * helper nobody calls.
 */
describe('Reindex Routes: failure status and body (#960)', () => {
  let registeredRoutes;
  let liferayService;

  const httpError = (status) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status },
    });

  const invoke = async (path, params = {}) => {
    const req = {
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'test-client',
        clientSecret: 'test-secret',
      },
      params,
      headers: { host: 'localhost:3000' },
      correlationId: 'test-cid',
      method: 'POST',
      url: path,
      ip: '127.0.0.1',
      get: () => 'vitest',
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await registeredRoutes[path](req, res);

    return res;
  };

  beforeEach(() => {
    resetReindexStatus();
    registeredRoutes = {};

    const appMock = {
      // The route registers input-validation middleware ahead of the
      // handler; Express resolves the last argument as the terminal handler
      // and so does this, matching tests/deleteRoutes.test.cjs.
      post: vi.fn((path, ...handlers) => {
        registeredRoutes[path] = handlers[handlers.length - 1];
      }),
    };

    liferayService = { rest: { triggerReindex: vi.fn() } };

    reindexRoutes(appMock, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
      liferayService,
      configService: {},
    });
  });

  describe.each([
    ['reindex-all', INTERNAL_API_PATHS.REINDEX, {}],
    [
      'reindex-class',
      INTERNAL_API_PATHS.REINDEX_CLASS,
      { className: 'com.liferay.commerce.product.model.CPDefinition' },
    ],
  ])('%s', (_name, path, params) => {
    it('reports a missing endpoint as 503 with the composed message', async () => {
      liferayService.rest.triggerReindex.mockRejectedValue(httpError(404));

      const res = await invoke(path, params);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false, error: MISSING_MESSAGE })
      );
    });

    // #960: not the 500 a caller used to see, and not the 4xx that would
    // point them at their own request either - see the rationale on
    // STATUS_BY_REINDEX_STATE in routes/reindex.cjs for why 502.
    it.each([401, 403])(
      'reports a scope denial (%s) as 502 with the composed message, not a 4xx',
      async (status) => {
        liferayService.rest.triggerReindex.mockRejectedValue(httpError(status));

        const res = await invoke(path, params);

        expect(res.status).toHaveBeenCalledWith(502);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: SCOPE_DENIED_MESSAGE,
          })
        );
      }
    );

    it('keeps an unclassified failure at 500, with the composed message rather than the raw axios string', async () => {
      liferayService.rest.triggerReindex.mockRejectedValue(httpError(500));

      const res = await invoke(path, params);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        'Search reindexing failed: Request failed with status code 500'
      );
      // The defect this closes: the body used to be exactly this raw string.
      expect(body.error).not.toBe('Request failed with status code 500');
    });

    it('agrees with reindexHealth() about why the same call failed', async () => {
      liferayService.rest.triggerReindex.mockRejectedValue(httpError(403));

      const res = await invoke(path, params);

      const body = res.json.mock.calls[0][0];
      expect(body.error).toBe(reindexHealth().message);
      expect(getReindexStatus().state).toBe('SCOPE_DENIED');
    });
  });
});
