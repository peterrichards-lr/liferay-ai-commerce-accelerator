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
