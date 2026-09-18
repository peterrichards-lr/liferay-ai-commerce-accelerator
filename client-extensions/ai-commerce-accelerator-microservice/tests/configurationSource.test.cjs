const {
  CONFIGURATION_SOURCE,
  configurationUnavailable,
  describeConfigurationSource,
  normalizeConfigurationSource,
  resolveConfigurationSource,
} = require('../utils/configurationSource.cjs');
const { ENV } = require('../utils/constants.cjs');

/**
 * Where AICA reads its own configuration, as opposed to where it writes data.
 *
 * The assertions that matter here are the refusals. A configuration source that
 * repairs itself - by borrowing the target's credentials, or by quietly
 * reverting to the target when it cannot be used - is the #824 defect in a new
 * place: a second instance that appears to be in use while none of its settings
 * are.
 */
describe('resolveConfigurationSource (#824)', () => {
  const target = {
    liferayUrl: 'https://lctsolara-uat.lfr.cloud',
    clientId: 'target-id',
    clientSecret: 'target-secret',
  };

  const withoutEnv = (run) => {
    const saved = {
      url: ENV.AICA_CONFIG_SOURCE_URL,
      id: ENV.AICA_CONFIG_SOURCE_CLIENT_ID,
      secret: ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET,
    };
    ENV.AICA_CONFIG_SOURCE_URL = '';
    ENV.AICA_CONFIG_SOURCE_CLIENT_ID = '';
    ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = '';
    try {
      return run();
    } finally {
      ENV.AICA_CONFIG_SOURCE_URL = saved.url;
      ENV.AICA_CONFIG_SOURCE_CLIENT_ID = saved.id;
      ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = saved.secret;
    }
  };

  it('reads configuration over the target connection when none is stated', () => {
    withoutEnv(() => {
      const resolved = resolveConfigurationSource(target);

      expect(resolved.sameAsTarget).toBe(true);
      expect(resolved.source).toBe(CONFIGURATION_SOURCE.SAME_AS_TARGET);
      expect(resolved.connection).toBe(target);
      expect(resolved.liferayUrl).toBe(target.liferayUrl);
    });
  });

  it('reads configuration over the stated connection, not the target', () => {
    withoutEnv(() => {
      const resolved = resolveConfigurationSource({
        ...target,
        configSource: {
          liferayUrl: 'http://localhost:8080',
          clientId: 'local-id',
          clientSecret: 'local-secret',
        },
      });

      expect(resolved.sameAsTarget).toBe(false);
      expect(resolved.source).toBe(CONFIGURATION_SOURCE.STATED);
      expect(resolved.connection.liferayUrl).toBe('http://localhost:8080');
      expect(resolved.connection.clientId).toBe('local-id');
      expect(resolved.connection.clientSecret).toBe('local-secret');
    });
  });

  it('refuses a different instance with no credentials of its own', () => {
    withoutEnv(() => {
      expect(() =>
        resolveConfigurationSource({
          ...target,
          configSource: { liferayUrl: 'http://localhost:8080' },
        })
      ).toThrow(/needs its own client id and secret/i);
    });
  });

  it('refuses a different instance carrying only half a credential', () => {
    withoutEnv(() => {
      expect(() =>
        resolveConfigurationSource({
          ...target,
          configSource: {
            liferayUrl: 'http://localhost:8080',
            clientId: 'local-id',
          },
        })
      ).toThrow(/needs its own client id and secret/i);
    });
  });

  it('never lets the target credentials reach another instance', () => {
    withoutEnv(() => {
      let thrown = null;
      try {
        resolveConfigurationSource({
          ...target,
          configSource: { liferayUrl: 'http://localhost:8080' },
        });
      } catch (error) {
        thrown = error;
      }

      // The assertion is the absence of a connection at all, not the wording:
      // a resolver that returned `{ liferayUrl: localhost, clientId:
      // 'target-id' }` would have sent credentials minted for the UAT instance
      // to a different host.
      expect(thrown).not.toBeNull();
      expect(thrown.name).toBe('ConfigurationSourceError');
      expect(thrown.statusCode).toBe(400);
    });
  });

  it('refuses a configuration source URL that is not absolute', () => {
    withoutEnv(() => {
      expect(() =>
        resolveConfigurationSource({
          ...target,
          configSource: {
            liferayUrl: 'localhost:8080',
            clientId: 'a',
            clientSecret: 'b',
          },
        })
      ).toThrow(/not a valid absolute URL/i);
    });
  });

  it('treats a configuration source naming the target host as the target', () => {
    withoutEnv(() => {
      const stated = {
        ...target,
        configSource: { liferayUrl: 'https://lctsolara-uat.lfr.cloud/' },
      };
      const resolved = resolveConfigurationSource(stated);

      expect(resolved.sameAsTarget).toBe(true);
      expect(resolved.connection).toBe(stated);
      expect(resolved.connection.clientId).toBe('target-id');
    });
  });

  it('resolves from the environment when the request states nothing', () => {
    ENV.AICA_CONFIG_SOURCE_URL = 'http://config.example:8080';
    ENV.AICA_CONFIG_SOURCE_CLIENT_ID = 'env-id';
    ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = 'env-secret';

    try {
      const resolved = resolveConfigurationSource(target);

      expect(resolved.sameAsTarget).toBe(false);
      expect(resolved.source).toBe(CONFIGURATION_SOURCE.ENV);
      expect(resolved.connection.liferayUrl).toBe('http://config.example:8080');
      expect(resolved.connection.clientId).toBe('env-id');
    } finally {
      ENV.AICA_CONFIG_SOURCE_URL = '';
      ENV.AICA_CONFIG_SOURCE_CLIENT_ID = '';
      ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = '';
    }
  });

  it('lets the request outrank the environment', () => {
    ENV.AICA_CONFIG_SOURCE_URL = 'http://config.example:8080';
    ENV.AICA_CONFIG_SOURCE_CLIENT_ID = 'env-id';
    ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = 'env-secret';

    try {
      const resolved = resolveConfigurationSource({
        ...target,
        configSource: {
          liferayUrl: 'http://stated.example:8080',
          clientId: 'stated-id',
          clientSecret: 'stated-secret',
        },
      });

      // ENV is one value for every user of a shared server, so a per-run value
      // has to win. The same ordering getRuntimeAIConfig uses.
      expect(resolved.connection.liferayUrl).toBe('http://stated.example:8080');
      expect(resolved.source).toBe(CONFIGURATION_SOURCE.STATED);
    } finally {
      ENV.AICA_CONFIG_SOURCE_URL = '';
      ENV.AICA_CONFIG_SOURCE_CLIENT_ID = '';
      ENV.AICA_CONFIG_SOURCE_CLIENT_SECRET = '';
    }
  });
});

describe('describeConfigurationSource (#824)', () => {
  it('never carries a client secret', () => {
    const described = describeConfigurationSource({
      liferayUrl: 'https://uat.example',
      clientId: 'target-id',
      clientSecret: 'target-secret',
      configSource: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'local-id',
        clientSecret: 'local-secret',
      },
    });

    expect(JSON.stringify(described)).not.toContain('local-secret');
    expect(JSON.stringify(described)).not.toContain('target-secret');
    expect(described.liferayUrl).toBe('http://localhost:8080');
    expect(described.sameAsTarget).toBe(false);
  });

  it('describes a configuration source it cannot resolve rather than throwing', () => {
    const described = describeConfigurationSource({
      liferayUrl: 'https://uat.example',
      configSource: { liferayUrl: 'http://localhost:8080' },
    });

    expect(described.error).toMatch(/client id and secret/i);
    expect(described.sameAsTarget).toBe(false);
  });
});

describe('normalizeConfigurationSource (#824)', () => {
  it('keeps only the three fields a connection has', () => {
    const normalized = normalizeConfigurationSource({
      liferayUrl: ' http://localhost:8080 ',
      clientId: 'id',
      clientSecret: 'secret',
      authMethod: 'basic',
      somethingElse: 'dropped',
    });

    expect(normalized).toEqual({
      liferayUrl: 'http://localhost:8080',
      clientId: 'id',
      clientSecret: 'secret',
    });
  });

  it('is undefined when no URL was stated, so the target still answers', () => {
    expect(normalizeConfigurationSource(undefined)).toBeUndefined();
    expect(normalizeConfigurationSource({})).toBeUndefined();
    expect(normalizeConfigurationSource({ liferayUrl: '   ' })).toBeUndefined();
    expect(normalizeConfigurationSource('not json')).toBeUndefined();
  });

  it('accepts the JSON string a multipart caller sends', () => {
    expect(
      normalizeConfigurationSource(
        JSON.stringify({ liferayUrl: 'http://localhost:8080' })
      )
    ).toEqual({ liferayUrl: 'http://localhost:8080' });
  });
});

describe('configurationUnavailable (#824)', () => {
  it('names the instance that could not be read', () => {
    const error = configurationUnavailable(new Error('ECONNREFUSED'), {
      liferayUrl: 'http://localhost:8080',
      sameAsTarget: false,
    });

    expect(error.name).toBe('ConfigurationSourceUnavailableError');
    expect(error.message).toContain('http://localhost:8080');
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.userMessage).toMatch(/No default has been substituted/i);
  });

  it('says target rather than configuration source when they are the same', () => {
    const error = configurationUnavailable(new Error('boom'), {
      liferayUrl: 'https://uat.example',
      sameAsTarget: true,
    });

    expect(error.message).toContain('the target instance');
  });
});
