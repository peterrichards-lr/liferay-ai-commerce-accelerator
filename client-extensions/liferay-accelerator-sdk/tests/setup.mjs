import { beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers.mjs';

const server = setupServer(...handlers);

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

export { server };
