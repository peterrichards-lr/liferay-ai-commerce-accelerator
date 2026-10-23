const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const { resolveLiferayUrl } = require('../middleware/loggingMiddleware.cjs');
const { ENV } = require('../utils/constants.cjs');

const request = (body) => ({
  body,
  headers: { host: 'localhost:3001' },
  correlationId: 'test-correlation',
  app: { locals: {} },
});

describe('a configuration source arriving on a request (#824)', () => {
  const base = {
    liferayUrl: 'https://lctsolara-uat.lfr.cloud',
    clientId: 'target-id',
    clientSecret: 'target-secret',
    catalogId: 1,
  };

  it('carries the three connection fields and drops the rest', () => {
    const { config } = buildConfigAndOptions(
      request({
        ...base,
        configSource: {
          liferayUrl: 'http://localhost:8080',
          clientId: 'local-id',
          clientSecret: 'local-secret',
          isAdmin: true,
        },
      })
    );

    expect(config.configSource).toEqual({
      liferayUrl: 'http://localhost:8080',
      clientId: 'local-id',
      clientSecret: 'local-secret',
    });
  });

  it('is absent when the request names no configuration source', () => {
    const { config } = buildConfigAndOptions(request({ ...base }));

    expect(config.configSource).toBeUndefined();
  });

  it('does not let a configuration source displace the write target', () => {
    const { config } = buildConfigAndOptions(
      request({
        ...base,
        configSource: {
          liferayUrl: 'http://localhost:8080',
          clientId: 'local-id',
          clientSecret: 'local-secret',
        },
      })
    );

    // Reading configuration is what moves. Where the data lands does not.
    expect(config.liferayUrl).toBe('https://lctsolara-uat.lfr.cloud');
    expect(config.clientId).toBe('target-id');
  });
});

describe('sanitizedObject and a second credential set (#824, #820)', () => {
  it('redacts a client secret nested under the configuration source', () => {
    const sanitized = sanitizedObject({
      clientSecret: 'target-secret',
      configSource: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'local-id',
        clientSecret: 'local-secret',
      },
    });

    expect(JSON.stringify(sanitized)).not.toContain('local-secret');
    expect(sanitized.configSource.liferayUrl).toBe('http://localhost:8080');
    expect(sanitized.configSource.clientId).toBe('local-id');
  });

  it('redacts a short secret too', () => {
    // maskMiddle leaves a string of nine characters or fewer untouched, and
    // this is the line that logs every request body.
    const sanitized = sanitizedObject({
      configSource: { clientSecret: 'abc' },
    });

    expect(JSON.stringify(sanitized)).not.toContain('abc');
  });

  it('does not mutate the object it was handed', () => {
    const body = { configSource: { clientSecret: 'local-secret' } };

    sanitizedObject(body);

    expect(body.configSource.clientSecret).toBe('local-secret');
  });
});

describe('bearer token verification follows the configuration source (#824)', () => {
  let saved;

  beforeEach(() => {
    saved = ENV.LIFERAY_URL;
    ENV.LIFERAY_URL = 'https://lctsolara-uat.lfr.cloud';
  });

  afterEach(() => {
    ENV.LIFERAY_URL = saved;
  });

  it('verifies against the instance that minted the token', () => {
    // A user-context token comes from the instance the operator signed in to,
    // which is the configuration source when one is named. Verifying it
    // against the write target's JWKS rejects a perfectly good token.
    expect(
      resolveLiferayUrl({
        body: { configSource: { liferayUrl: 'http://localhost:8080' } },
      })
    ).toBe('http://localhost:8080');
  });

  it('falls back to the target when no configuration source is named', () => {
    expect(resolveLiferayUrl({ body: {} })).toBe(
      'https://lctsolara-uat.lfr.cloud'
    );
  });

  it('ignores a configuration source URL that is not absolute', () => {
    expect(
      resolveLiferayUrl({ body: { configSource: { liferayUrl: 'localhost' } } })
    ).toBe('https://lctsolara-uat.lfr.cloud');
  });
});

// A browser request names no configuration source and carries no config, so
// the JWKS URL fell through to `ENV.LIFERAY_URL`'s localhost default: inside a
// colocated container that is the container itself, and every browser call
// failed with "Internal identity verification failure". See #1378.
describe('the JWKS URL follows the DXP tree when colocated (#1378)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const jwt = require('jsonwebtoken');
  const { clearCache } = require('@rotty3000/config-node');
  const { verifyBearerToken } = require('../middleware/loggingMiddleware.cjs');

  const saved = {};
  let tree;

  // Paths under this test's own mkdtemp, never input.
  const writeTree = (domain, protocol = 'https') => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(
      path.join(tree, 'com.liferay.lxc.dxp.main.domain'),
      domain
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(
      path.join(tree, 'com.liferay.lxc.dxp.server.protocol'),
      protocol
    );
    clearCache();
  };

  beforeEach(() => {
    tree = fs.mkdtempSync(path.join(os.tmpdir(), 'dxp-tree-'));
    saved.routes = ENV.LIFERAY_ROUTES_DXP;
    saved.url = ENV.LIFERAY_URL;
    saved.trees = process.env.CONFIG_NODE_CONFIG_TREES;
    ENV.LIFERAY_URL = 'http://localhost:8080';
    process.env.CONFIG_NODE_CONFIG_TREES = tree;
    clearCache();
  });

  afterEach(() => {
    ENV.LIFERAY_ROUTES_DXP = saved.routes;
    ENV.LIFERAY_URL = saved.url;
    if (saved.trees === undefined) delete process.env.CONFIG_NODE_CONFIG_TREES;
    else process.env.CONFIG_NODE_CONFIG_TREES = saved.trees;
    clearCache();
    fs.rmSync(tree, { recursive: true, force: true });
  });

  it('uses the tree, not localhost, for a browser request in a container', () => {
    ENV.LIFERAY_ROUTES_DXP = tree; // mounted: colocated
    writeTree('aica-e2e.demo');

    expect(resolveLiferayUrl({ body: {} })).toBe('https://aica-e2e.demo');
    // The WebSocket handshake calls it with no request at all.
    expect(resolveLiferayUrl()).toBe('https://aica-e2e.demo');
  });

  it('never answers with a loopback URL in a container', () => {
    ENV.LIFERAY_ROUTES_DXP = tree; // colocated, but nothing written yet

    expect(resolveLiferayUrl({ body: {} })).toBeUndefined();
  });

  it('still allows localhost in local development', () => {
    ENV.LIFERAY_ROUTES_DXP = path.join(tree, 'not-mounted');

    expect(resolveLiferayUrl({ body: {} })).toBe('http://localhost:8080');
  });

  it('keeps an explicit configuration source first (#824)', () => {
    ENV.LIFERAY_ROUTES_DXP = tree;
    writeTree('aica-e2e.demo');

    expect(
      resolveLiferayUrl({
        body: { configSource: { liferayUrl: 'https://uat.example.com' } },
      })
    ).toBe('https://uat.example.com');
  });

  it('names the missing URL rather than fetching from localhost', async () => {
    const token = jwt.sign({ sub: 'u' }, 'not-the-real-key');

    await expect(verifyBearerToken(token, undefined)).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/Liferay URL unresolved/),
    });
  });
});
