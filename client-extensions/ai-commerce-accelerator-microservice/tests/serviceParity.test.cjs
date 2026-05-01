const { LiferayService } = require('../services/liferay/index.cjs');

describe('LiferayService Parity', () => {
  const mockCtx = {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      trace: vi.fn(),
    },
    cache: { get: vi.fn(), set: vi.fn() },
    oauth: { getToken: vi.fn() },
  };

  const service = new LiferayService(mockCtx);

  it('should ensure all public methods in LiferayService bridge to existing implementation methods', () => {
    const publicMethods = Object.getOwnPropertyNames(
      LiferayService.prototype
    ).filter((m) => m !== 'constructor' && !m.startsWith('_'));

    for (const methodName of publicMethods) {
      const method = service[methodName];
      if (typeof method !== 'function') continue;

      // Extract the body of the function to see if it calls this.rest or this.graphql
      const body = method.toString();

      if (body.includes('this.rest.')) {
        const restMatch = body.match(/this\.rest\.([a-zA-Z0-9_]+)/);
        if (restMatch) {
          const restMethodName = restMatch[1];
          expect(
            typeof service.rest[restMethodName],
            `Method '${methodName}' in index.cjs tries to call 'this.rest.${restMethodName}', but that method does not exist in rest.cjs!`
          ).toBe('function');
        }
      }

      if (body.includes('this.graphql.')) {
        const gqlMatch = body.match(/this\.graphql\.([a-zA-Z0-9_]+)/);
        if (gqlMatch) {
          const gqlMethodName = gqlMatch[1];
          expect(
            typeof service.graphql[gqlMethodName],
            `Method '${methodName}' in index.cjs tries to call 'this.graphql.${gqlMethodName}', but that method does not exist in graphql.cjs!`
          ).toBe('function');
        }
      }
    }
  });
});
