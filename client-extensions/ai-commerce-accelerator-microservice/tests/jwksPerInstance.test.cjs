const axios = require('axios');
const { fetchLiferayJwks } = require('../middleware/loggingMiddleware.cjs');

/**
 * One signing-key cache per instance (#824).
 *
 * A single slot was harmless while there was exactly one Liferay in the system.
 * Once a configuration source can name a second, the first instance's keys
 * would be used to verify the second instance's tokens - rejecting valid
 * tokens, and doing so in a way that reads as a broken login.
 *
 * `axios.get` is replaced on the shared module object rather than through
 * `vi.mock`: both this file and the middleware reach axios by `require`, so
 * they hold the same object and the substitution is what the middleware calls.
 */
describe('fetchLiferayJwks keys its cache by instance', () => {
  let realGet;
  let httpGet;

  beforeEach(() => {
    realGet = axios.get;
    httpGet = vi.fn(async (url) => ({
      data: { keys: [{ kid: url.includes('localhost') ? 'local' : 'uat' }] },
    }));
    axios.get = httpGet;
  });

  afterEach(() => {
    axios.get = realGet;
  });

  it('fetches each instance separately', async () => {
    const local = await fetchLiferayJwks('http://localhost:8080');
    const uat = await fetchLiferayJwks('https://uat.example');

    expect(local.keys[0].kid).toBe('local');
    expect(uat.keys[0].kid).toBe('uat');
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('still caches within one instance', async () => {
    await fetchLiferayJwks('https://cached.example');
    const again = await fetchLiferayJwks('https://cached.example');

    expect(again.keys[0].kid).toBe('uat');
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('keeps one instance cached while another is fetched', async () => {
    await fetchLiferayJwks('http://localhost:8080');
    await fetchLiferayJwks('https://other.example');
    httpGet.mockClear();

    const local = await fetchLiferayJwks('http://localhost:8080');

    expect(local.keys[0].kid).toBe('local');
    expect(httpGet).not.toHaveBeenCalled();
  });
});
