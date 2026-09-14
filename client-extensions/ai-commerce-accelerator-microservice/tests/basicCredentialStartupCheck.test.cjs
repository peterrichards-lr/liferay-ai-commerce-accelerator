/**
 * basicCredentialStartupCheck.test.cjs
 *
 * `resolveEffectiveLiferayConnection` has always accepted LIFERAY_API_USERNAME
 * and LIFERAY_API_PASSWORD as sufficient to proceed and never exercised them.
 * On a colocated deployment OAuth resolves through the routes tree, so a wrong
 * Basic password stays invisible until the one day OAuth is unavailable and a
 * request actually needs Basic - the worst possible day to learn it. See #950,
 * and #714/#934/#945 for the same shape.
 *
 * `verifyBasicCredentialAtStartup` closes that gap with a single authenticated
 * call, made once at startup, and only when the default resolution is
 * genuinely going to use Basic.
 */

const { verifyBasicCredentialAtStartup } = require('../utils/liferayEnv.cjs');
const { ENV } = require('../utils/constants.cjs');

// Set on ENV, not process.env - see explicitWriteTarget.test.cjs for why:
// constants.cjs resolves these once while it loads, so process.env would not
// reach resolveEffectiveLiferayConnection.
const saved = {};

beforeEach(() => {
  for (const key of ['LIFERAY_API_USERNAME', 'LIFERAY_API_PASSWORD']) {
    saved[key] = ENV[key];
    ENV[key] = undefined;
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) ENV[key] = value;
});

// A URL has to resolve before authentication is even considered.
// getDefaultLiferayUrl is stubbed on every oauthService below rather than
// left to fall through to the LXC-routes/ENV/persisted chain, so a test
// exercises the auth-resolution branch under test regardless of what
// @rotty3000/config-node resolves to in whatever environment the suite runs
// in.
const LIFERAY_URL = 'http://liferay:8080';

describe('verifyBasicCredentialAtStartup', () => {
  it('does nothing when OAuth is what will actually be used', async () => {
    ENV.LIFERAY_API_USERNAME = 'someone';
    ENV.LIFERAY_API_PASSWORD = 'secret';

    const oauthService = {
      isLiferayRouteAvailable: () => true,
      getDefaultLiferayUrl: () => LIFERAY_URL,
      getDefaultClientId: () => 'route-client-id',
      getDefaultClientSecret: () => 'route-client-secret',
    };
    const testConnection = vi.fn();

    const result = await verifyBasicCredentialAtStartup(oauthService, null, {
      testConnection,
    });

    expect(result).toBeNull();
    // The whole point: an OAuth-authenticated deployment must never pay for
    // this probe. A call here would be a request nothing needs, on every boot.
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('does nothing when no authentication is configured at all', async () => {
    // Neither OAuth nor Basic - a different, already-surfaced problem
    // (resolveEffectiveLiferayConnection throws for it on the request path).
    const oauthService = {
      isLiferayRouteAvailable: () => false,
      getDefaultLiferayUrl: () => LIFERAY_URL,
    };
    const testConnection = vi.fn();

    const result = await verifyBasicCredentialAtStartup(oauthService, null, {
      testConnection,
    });

    expect(result).toBeNull();
    expect(testConnection).not.toHaveBeenCalled();
  });

  it('probes with Basic and returns null when the credential works', async () => {
    ENV.LIFERAY_API_USERNAME = 'someone';
    ENV.LIFERAY_API_PASSWORD = 'secret';

    const oauthService = {
      isLiferayRouteAvailable: () => false,
      getDefaultLiferayUrl: () => LIFERAY_URL,
    };
    const testConnection = vi.fn().mockResolvedValue({ status: 'connected' });

    const result = await verifyBasicCredentialAtStartup(oauthService, null, {
      testConnection,
    });

    expect(result).toBeNull();
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenCalledWith({ authMethod: 'basic' });
  });

  it('names the variables in a warning when the credential does not authenticate', async () => {
    ENV.LIFERAY_API_USERNAME = 'someone';
    ENV.LIFERAY_API_PASSWORD = 'wrong-password';

    const oauthService = {
      isLiferayRouteAvailable: () => false,
      getDefaultLiferayUrl: () => LIFERAY_URL,
    };
    const testConnection = vi
      .fn()
      .mockRejectedValue(new Error('Request failed with status code 401'));

    const result = await verifyBasicCredentialAtStartup(oauthService, null, {
      testConnection,
    });

    expect(result).toMatch(/LIFERAY_API_USERNAME/);
    expect(result).toMatch(/LIFERAY_API_PASSWORD/);
    expect(result).toMatch(/401/);
  });
});
