import { vi, describe, it, expect } from 'vitest';

// We must use doMock because we are using require() in the SDK
// and we need to ensure the mock is active before the first require.
vi.doMock('@rotty3000/config-node', () => ({
  lxcConfig: {
    oauthApplication: vi.fn().mockReturnValue({}),
    userAgentApplication: vi.fn().mockReturnValue({}),
  },
  lookupConfig: vi.fn().mockReturnValue(null),
}));

const sdk = require('../src/index.js');

describe('Liferay Accelerator SDK', () => {
  it('should export the core services', () => {
    expect(sdk.LiferayService).toBeDefined();
    expect(sdk.LiferayRestService).toBeDefined();
    expect(sdk.LiferayGraphQLService).toBeDefined();
    expect(sdk.OAuthService).toBeDefined();
    expect(sdk.GeneratedLiferayClient).toBeDefined();
    expect(sdk.ContractValidator).toBeDefined();
  });

  it('should expose namespaced versioning in the generated client', () => {
    const mockRest = { _request: vi.fn() };
    const client = new sdk.GeneratedLiferayClient(mockRest);

    // Check if some common namespaces exist
    expect(client.headlessCommerceAdminCatalog).toBeDefined();
    expect(client.headlessAdminUser).toBeDefined();

    // Check if versions are namespaced correctly (v1_0)
    expect(client.headlessCommerceAdminCatalog.v1_0).toBeDefined();
  });

  it('should expose utilities', () => {
    expect(sdk.utils).toBeDefined();
    expect(sdk.utils.PATH).toBeDefined();
  });

  it('should resolve callback URL from LIFERAY_BATCH_CALLBACK_URL override', () => {
    const rest = new sdk.LiferayRestService({});
    process.env.LIFERAY_BATCH_CALLBACK_URL = 'http://test-env-override/cb';
    expect(rest._getBaseCallbackUrl({})).toBe('http://test-env-override/cb');
    delete process.env.LIFERAY_BATCH_CALLBACK_URL;
  });
});
