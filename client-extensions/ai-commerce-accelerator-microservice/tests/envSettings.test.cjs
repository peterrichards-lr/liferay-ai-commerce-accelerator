/**
 * The ENV layer, exercised through a real module load.
 *
 * These helpers run once while `utils/constants.cjs` is being required, so a
 * test has to set the variable and then load the module fresh. `vi.resetModules`
 * is what makes each case independent.
 */
function loadConstants(env = {}) {
  // `vi.resetModules()` clears Vitest's registry, not Node's `require.cache`,
  // and this module is CommonJS - so without this the second load in a file
  // returns the first one's frozen ENV and every case after it reads the
  // previous case's environment.
  delete require.cache[require.resolve('../utils/constants.cjs')];

  const previous = {};

  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    return require('../utils/constants.cjs');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('ENV settings', () => {
  let saved;

  beforeEach(() => {
    saved = {
      AICA_MAX_TOKEN_LIMIT: process.env.AICA_MAX_TOKEN_LIMIT,
      ALLOW_LARGE_PROMPTS: process.env.ALLOW_LARGE_PROMPTS,
      IMPORT_MAX_BYTES: process.env.IMPORT_MAX_BYTES,
      LIFERAY_COMPANY_ID: process.env.LIFERAY_COMPANY_ID,
      REQUEST_MAX_BYTES: process.env.REQUEST_MAX_BYTES,
    };

    for (const key of Object.keys(saved)) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[require.resolve('../utils/constants.cjs')];
  });

  // #945. `Math.max(n, undefined)` is NaN, so a caller that omitted the minimum
  // got NaN for every *valid* value while the default path kept working. The
  // consequence was not cosmetic: `contentLength > NaN` is false, so setting
  // REQUEST_MAX_BYTES removed the request size limit instead of tightening it.
  describe('a setting whose caller omits a minimum (#945)', () => {
    const NO_MINIMUM = {
      IMPORT_MAX_BYTES: '104857600',
      LIFERAY_COMPANY_ID: '20999',
      REQUEST_MAX_BYTES: '5242880',
    };

    it('honours a supplied value rather than returning NaN', () => {
      const { ENV } = loadConstants(NO_MINIMUM);

      expect(ENV.LIFERAY_COMPANY_ID).toBe(20999);
      expect(ENV.REQUEST_MAX_BYTES).toBe(5242880);
      expect(ENV.IMPORT_MAX_BYTES).toBe(104857600);
    });

    it('keeps a size limit comparable, so it still rejects what it should', () => {
      // The defect in the terms that mattered: a NaN limit compares false
      // against every request size, so nothing is ever too large.
      const { ENV } = loadConstants({ REQUEST_MAX_BYTES: '5242880' });

      expect(Number.isFinite(ENV.REQUEST_MAX_BYTES)).toBe(true);
      expect(5242881 > ENV.REQUEST_MAX_BYTES).toBe(true);
    });

    it('still falls back when nothing is supplied', () => {
      const { ENV } = loadConstants({});

      expect(ENV.REQUEST_MAX_BYTES).toBe(10 * 1024 * 1024);
    });
  });

  // #934. Both settings lived only in process.env, read with a `||` default.
  describe('the prompt guardrail (#934)', () => {
    it('defaults when unset, and says nothing about it', () => {
      const { ENV, ENV_WARNINGS } = loadConstants({});

      expect(ENV.AICA_MAX_TOKEN_LIMIT).toBe(15000);
      expect(ENV.ALLOW_LARGE_PROMPTS).toBe(false);
      expect(ENV_WARNINGS).toEqual([]);
    });

    it('takes a configured value', () => {
      const { ENV } = loadConstants({
        AICA_MAX_TOKEN_LIMIT: '20000',
        ALLOW_LARGE_PROMPTS: 'true',
      });

      expect(ENV.AICA_MAX_TOKEN_LIMIT).toBe(20000);
      expect(ENV.ALLOW_LARGE_PROMPTS).toBe(true);
    });

    it('reports a value that is not a number instead of silently defaulting', () => {
      // `parseInt('20k', 10)` is NaN and `NaN || 15000` is 15000, so the
      // operator asked for something specific and got the default with nothing
      // said - then met a refusal naming a number they never set.
      const { ENV, ENV_WARNINGS } = loadConstants({
        AICA_MAX_TOKEN_LIMIT: '20k',
      });

      expect(ENV.AICA_MAX_TOKEN_LIMIT).toBe(15000);
      expect(ENV_WARNINGS).toHaveLength(1);
      expect(ENV_WARNINGS[0]).toContain('AICA_MAX_TOKEN_LIMIT');
      expect(ENV_WARNINGS[0]).toContain('20k');
    });

    it('reports a boolean that is neither true nor false', () => {
      const { ENV, ENV_WARNINGS } = loadConstants({
        ALLOW_LARGE_PROMPTS: 'yes',
      });

      expect(ENV.ALLOW_LARGE_PROMPTS).toBe(false);
      expect(ENV_WARNINGS).toHaveLength(1);
      expect(ENV_WARNINGS[0]).toContain('ALLOW_LARGE_PROMPTS');
    });

    it('reports a value clamped to the minimum', () => {
      // Zero used to reach the same place as a typo, because it is falsy. It
      // now clamps, and the clamp is announced rather than assumed.
      const { ENV, ENV_WARNINGS } = loadConstants({
        AICA_MAX_TOKEN_LIMIT: '0',
      });

      expect(ENV.AICA_MAX_TOKEN_LIMIT).toBe(1);
      expect(ENV_WARNINGS).toHaveLength(1);
      expect(ENV_WARNINGS[0]).toContain('minimum');
    });
  });
});

// The listener's host and port are deliberately absent from ENV. `server.cjs`
// resolves them through config-node, whose env-var provider uppercases the key
// and turns dots into underscores - so `server.port` reads SERVER_PORT and
// `server.host` reads SERVER_HOST.
//
// Declaring them in ENV as well produced a second copy that nothing read, and
// whose default (3001) disagreed with the fallback the listener actually used
// (3000). Nothing caught it because a grep for `SERVER_PORT` finds the unread
// declaration and not the live read, which never spells the name (#1058).
//
// These cases pin the mechanism that misled us, not the two call sites.
describe('the listener reads its host and port through config-node (#1058)', () => {
  const { defaultConfig, lookupConfig } = require('@rotty3000/config-node');
  const applicationJson = require('../application.json');

  let savedPort;
  let savedHost;

  beforeEach(() => {
    savedPort = process.env.SERVER_PORT;
    savedHost = process.env.SERVER_HOST;
    delete process.env.SERVER_PORT;
    delete process.env.SERVER_HOST;
    defaultConfig();
  });

  afterEach(() => {
    if (savedPort === undefined) delete process.env.SERVER_PORT;
    else process.env.SERVER_PORT = savedPort;
    if (savedHost === undefined) delete process.env.SERVER_HOST;
    else process.env.SERVER_HOST = savedHost;
  });

  it('reaches SERVER_PORT, which spells the key differently', () => {
    process.env.SERVER_PORT = '3005';

    expect(String(lookupConfig('server.port'))).toBe('3005');
  });

  it('reaches SERVER_HOST the same way, so the host is configurable at all', () => {
    process.env.SERVER_HOST = '127.0.0.1';

    expect(String(lookupConfig('server.host'))).toBe('127.0.0.1');
  });

  it("agrees with application.json's port, so the fallback is never reached in practice", () => {
    // server.cjs falls back to 3001. That number is only correct while
    // application.json says the same thing; if this drifts, the fallback
    // silently becomes a different port from the one everything documents.
    expect(String(applicationJson['server.port'])).toBe('3001');
  });
});
