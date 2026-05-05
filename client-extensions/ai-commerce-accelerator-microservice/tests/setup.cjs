process.env.PERSISTENCE_DB_PATH = ':memory:';

const { server } = require('./mocks/server.cjs');

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
