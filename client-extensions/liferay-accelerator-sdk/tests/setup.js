import { vi, beforeAll, afterEach, afterAll } from 'vitest';
const { server } = require('./mocks/server.cjs');

vi.mock('@rotty3000/config-node', () => {
  return {
    lxcConfig: {
      oauthApplication: vi.fn().mockReturnValue({}),
      userAgentApplication: vi.fn().mockReturnValue({}),
      dxpMainDomain: vi.fn().mockReturnValue('localhost'),
      dxpProtocol: vi.fn().mockReturnValue('http'),
    },
    lookupConfig: vi.fn().mockReturnValue(null),
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
