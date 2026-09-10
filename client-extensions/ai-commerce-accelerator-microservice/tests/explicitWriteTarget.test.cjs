/**
 * explicitWriteTarget.test.cjs
 *
 * A write must say which Liferay it is for. See #815.
 *
 * `resolveEffectiveLiferayConnection` infers a target when the request carries
 * none - the OAuth default, then the colocated LXC routes, then
 * LIFERAY_API_URL, then the persisted `active_liferay_url`. That chain is what
 * makes a colocated deployment and the MCP tools work, so it stays. What must
 * not stay is inferring it for a *write*: run the microservice locally against
 * a remote instance and the client extension's own LXC environment names
 * localhost, so a generate request that omits liferayUrl builds a whole dataset
 * on the developer's laptop and reports success.
 *
 * Two guarantees are covered here:
 *   1. The routes that write refuse a request with no explicit target, the way
 *      routes/get.cjs and routes/delete.cjs already do.
 *   2. Wherever the fallback still applies - config reads, exports, MCP - it
 *      announces itself at WARN and names the link that supplied the target,
 *      instead of being discoverable only from a token log.
 */

const { logger } = require('../utils/logger.cjs');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  resolveEffectiveLiferayConnection,
} = require('../utils/liferayEnv.cjs');

const REMOTE_URL = 'https://webserver-project-uat.lfr.cloud';
const COLOCATED_URL = 'http://localhost:8080';

/**
 * Registers a route module against a stand-in `app` that keeps the whole
 * handler chain, not just the terminal handler: the guard under test is
 * middleware, so dropping the middlewares would drop the thing being tested.
 */
function registerRoutes(routeModule, context = {}) {
  const posts = {};

  const app = {
    get: () => {},
    post: (path, ...handlers) => {
      posts[path] = handlers;
    },
    delete: () => {},
    put: () => {},
    use: () => {},
  };

  routeModule(app, {
    logger,
    ...context,
  });

  return posts;
}

/**
 * Runs every middleware ahead of the terminal handler. The terminal handler is
 * deliberately never called - it would need the full service graph, and a
 * request that reaches it has already passed the guard, which is the only
 * thing this file asserts.
 */
async function runMiddlewares(handlers, req) {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  for (const handler of handlers.slice(0, -1)) {
    let advanced = false;

    await new Promise((resolve, reject) => {
      const next = (error) => {
        if (error) return reject(error);
        advanced = true;
        resolve();
      };

      const result = handler(req, res, next);

      if (result && typeof result.then === 'function') {
        result.then(resolve).catch(reject);
      } else {
        // A middleware that answered the request never calls next(), so
        // settling here is what lets the loop see that it stopped.
        resolve();
      }
    });

    if (!advanced) {
      return { res, reachedHandler: false };
    }
  }

  return { res, reachedHandler: true };
}

function writeRequest(body) {
  return {
    body,
    query: {},
    params: {},
    headers: { 'content-type': 'application/json', host: 'localhost:3000' },
    correlationId: 'test-correlation-id',
    method: 'POST',
    path: '/test',
  };
}

const WRITE_ROUTES = [
  {
    name: 'generate',
    module: require('../routes/generate.cjs'),
    path: INTERNAL_API_PATHS.GENERATE_WORKFLOW,
  },
  {
    name: 'import',
    module: require('../routes/import.cjs'),
    path: INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA,
  },
  {
    name: 'generateMedia',
    module: require('../routes/generateMedia.cjs'),
    path: INTERNAL_API_PATHS.GENERATE_MEDIA,
  },
  {
    name: 'reindex',
    module: require('../routes/reindex.cjs'),
    path: INTERNAL_API_PATHS.REINDEX,
  },
  {
    name: 'reindex/:className',
    module: require('../routes/reindex.cjs'),
    path: INTERNAL_API_PATHS.REINDEX_CLASS,
  },
];

describe('write routes require an explicit Liferay target (#815)', () => {
  for (const route of WRITE_ROUTES) {
    it(`${route.name} refuses a request that omits liferayUrl`, async () => {
      const posts = registerRoutes(route.module);
      const handlers = posts[route.path];

      expect(
        handlers,
        `${route.name} did not register ${route.path}`
      ).toBeTruthy();

      const { res, reachedHandler } = await runMiddlewares(
        handlers,
        writeRequest({ productCount: 50 })
      );

      expect(
        reachedHandler,
        `${route.name} accepted a write with no stated target - it would have ` +
          'landed on whichever Liferay the environment happened to name'
      ).toBe(false);
      expect(res.statusCode).toBe(400);
      expect(String(res.body?.error)).toMatch(/liferayUrl/);
    });

    it(`${route.name} accepts a request that states its target`, async () => {
      const posts = registerRoutes(route.module);

      const { res, reachedHandler } = await runMiddlewares(
        posts[route.path],
        writeRequest({ liferayUrl: REMOTE_URL, productCount: 50 })
      );

      expect(res.statusCode, JSON.stringify(res.body)).toBe(null);
      expect(reachedHandler).toBe(true);
    });
  }
});

describe('an inferred Liferay target announces itself (#815)', () => {
  let warnings;
  let originalWarn;

  beforeEach(() => {
    warnings = [];
    originalWarn = logger.warn;
    logger.warn = (message, meta) => warnings.push({ message, meta });
  });

  afterEach(() => {
    logger.warn = originalWarn;
  });

  const colocatedOAuthService = {
    isLiferayRouteAvailable: () => true,
    getDefaultLiferayUrl: () => COLOCATED_URL,
    getDefaultClientId: () => 'id-colocated',
    getDefaultClientSecret: () => 'secret-colocated',
  };

  it('warns, and names the link that supplied the target', () => {
    const resolved = resolveEffectiveLiferayConnection(
      {},
      colocatedOAuthService,
      null
    );

    expect(resolved.liferayUrl).toBe(COLOCATED_URL);

    const warning = warnings.find((entry) =>
      /liferay/i.test(String(entry.message))
    );

    expect(
      warning,
      'the target was substituted with no warning - exactly the silence #815 reports'
    ).toBeTruthy();
    expect(warning.meta?.liferayUrl).toBe(COLOCATED_URL);
    expect(String(warning.meta?.source)).toMatch(/oauth/i);
  });

  it('stays quiet when the caller stated its target', () => {
    const resolved = resolveEffectiveLiferayConnection(
      {
        liferayUrl: REMOTE_URL,
        clientId: 'id-remote',
        clientSecret: 'secret-remote',
      },
      colocatedOAuthService,
      null
    );

    expect(resolved.liferayUrl).toBe(REMOTE_URL);
    expect(warnings).toEqual([]);
  });

  it('stays quiet for an ordinary colocated request', () => {
    // The colocated UI states its own portal URL and leaves clientId and
    // clientSecret blank for the routes tree to supply. That is the normal,
    // correct case and must not produce a warning on every request - a warning
    // nobody can act on is a warning nobody reads.
    const resolved = resolveEffectiveLiferayConnection(
      { liferayUrl: COLOCATED_URL },
      colocatedOAuthService,
      null
    );

    expect(resolved.clientId).toBe('id-colocated');
    expect(warnings).toEqual([]);
  });

  it('warns when credentials are inherited for a target the caller chose', () => {
    // The pair in the #815 token log: a request naming the remote instance,
    // authenticated with the client the colocated deployment registered. The
    // URL is right and the credentials belong to a different Liferay.
    const resolved = resolveEffectiveLiferayConnection(
      { liferayUrl: REMOTE_URL },
      colocatedOAuthService,
      null
    );

    expect(resolved.clientId).toBe('id-colocated');

    const warning = warnings.find((entry) =>
      /credential/i.test(String(entry.message))
    );

    expect(
      warning,
      'colocated credentials were used against a caller-chosen instance in silence'
    ).toBeTruthy();
    expect(warning.meta?.liferayUrl).toBe(REMOTE_URL);
  });
});
