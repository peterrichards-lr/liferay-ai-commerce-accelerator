const deleteRoutes = require('../routes/delete.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  AICA_OWNED,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
  OWNERSHIP_SCOPE_CONFIRMATION,
} = require('../utils/ownershipScope.cjs');

/**
 * What a delete request is allowed to ask for (#850).
 *
 * The scope objects exist so that widening a delete is an act rather than an
 * accident, and the route is where that claim is either true or worthless: it
 * is the only place a value someone typed into a browser becomes a scope. So
 * these drive the real handler rather than the helper it calls.
 */
describe('Delete Routes: ownership scope (#850)', () => {
  let registeredRoutes;
  let deleteCoordinatorService;

  const invoke = async (path, body) => {
    const req = {
      body,
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

  const scopePassedTo = (spy) => {
    expect(spy).toHaveBeenCalled();
    const lastArg = spy.mock.calls[0][spy.mock.calls[0].length - 1];
    return lastArg.ownershipScope;
  };

  beforeEach(() => {
    registeredRoutes = {};

    const appMock = {
      // The route registers middleware before the handler; Express resolves
      // the last argument as the terminal handler and so does this.
      post: vi.fn((path, ...handlers) => {
        registeredRoutes[path] = handlers[handlers.length - 1];
      }),
    };

    deleteCoordinatorService = {
      runDeleteAndMonitor: vi.fn().mockResolvedValue({ sessionId: 'sess-1' }),
      runDeleteSelectedAndMonitor: vi
        .fn()
        .mockResolvedValue({ sessionId: 'sess-2' }),
    };

    deleteRoutes(appMock, {
      deleteCoordinatorService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() },
      configService: {},
    });
  });

  // buildConfigAndOptions refuses to build a config without somewhere to
  // connect to, so every body carries a connection it will never use.
  const baseBody = {
    liferayUrl: 'http://localhost:8080',
    clientId: 'test-client',
    clientSecret: 'test-secret',
  };

  describe.each([
    [
      'full delete',
      INTERNAL_API_PATHS.DELETE_COMMERCE_DATA,
      'runDeleteAndMonitor',
    ],
    [
      'selected delete',
      INTERNAL_API_PATHS.DELETE_SELECTED_COMMERCE_DATA,
      'runDeleteSelectedAndMonitor',
    ],
  ])('%s', (_name, path, method) => {
    it('runs AICA-owned when the request says nothing about scope', async () => {
      await invoke(path, { ...baseBody, channelId: 1, catalogId: 2 });

      expect(scopePassedTo(deleteCoordinatorService[method])).toBe(AICA_OWNED);
    });

    // The point of the phrase. A flag would be one typo, one stale checkbox or
    // one over-eager client away from an unrecoverable delete on an instance
    // holding restored production data.
    it('stays AICA-owned for a truthy flag by any plausible name', async () => {
      const guesses = [
        { deleteEverything: true },
        { ownershipScope: 'everything' },
        { ownershipScopeConfirmation: true },
        { ownershipScopeConfirmation: 'true' },
        { ownershipScopeConfirmation: 1 },
        { ownershipScopeConfirmation: 'everything' },
        {
          ownershipScopeConfirmation:
            OWNERSHIP_SCOPE_CONFIRMATION.toLowerCase(),
        },
        { ownershipScopeConfirmation: `${OWNERSHIP_SCOPE_CONFIRMATION} ` },
      ];

      for (const guess of guesses) {
        deleteCoordinatorService[method].mockClear();

        await invoke(path, { ...baseBody, ...guess });

        expect(scopePassedTo(deleteCoordinatorService[method])).toBe(
          AICA_OWNED
        );
      }
    });

    it('widens only when the confirmation phrase is typed out in full', async () => {
      await invoke(path, {
        ...baseBody,
        ownershipScopeConfirmation: OWNERSHIP_SCOPE_CONFIRMATION,
      });

      expect(scopePassedTo(deleteCoordinatorService[method])).toBe(
        EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE
      );
    });

    it('hands over the scope object itself, never a value from the body', async () => {
      await invoke(path, {
        ...baseBody,
        ownershipScopeConfirmation: OWNERSHIP_SCOPE_CONFIRMATION,
      });

      // Identity is the guard: the coordinator rejects anything that is not
      // one of the two exported objects, and no JSON body can produce one.
      const scope = scopePassedTo(deleteCoordinatorService[method]);
      expect(Object.isFrozen(scope)).toBe(true);
      expect(typeof scope.owns).toBe('function');
    });
  });
});
