/**
 * A microservice on the CLI's own machine trusts a loopback caller. One
 * anywhere else - a remote node, behind its proxy - admits only a request with
 * a verified Liferay token, and answered every CLI request with `401 Missing
 * required request-signing headers` (#1405, #1109). So a remote target gets a
 * token on every request; a local one gets nothing it did not get before.
 */
describe('aica CLI: a remote microservice gets a token on every request (#1405)', () => {
  const VARS = [
    'AICA_MICROSERVICE_URL',
    'AICA_ADMIN_TOKEN',
    'AICA_ADMIN_CLIENT_ID',
    'AICA_ADMIN_CLIENT_SECRET',
    'AICA_CLI_CLIENT_ID',
    'LIFERAY_PORTAL_URL',
    'LIFERAY_URL',
    'LIFERAY_API_URL',
  ];

  const REMOTE = 'https://ai-commerce-accelerator-microservice.node.test';

  // The CLI reads its environment once, at load. Re-requiring with the
  // environment in place is the only way to reach each configuration, and the
  // .env it would otherwise find is ignored so this machine's own settings
  // cannot answer for the test (#1061).
  const loadCli = (env = {}) => {
    const previous = {};

    for (const key of [...VARS, 'AICA_IGNORE_DOTENV']) {
      previous[key] = process.env[key];
      delete process.env[key];
    }

    Object.assign(process.env, {
      LIFERAY_URL: 'http://liferay.test:8080',
      AICA_IGNORE_DOTENV: '1',
      ...env,
    });

    delete require.cache[require.resolve('../../../scripts/aica-cli.cjs')];
    const mod = require('../../../scripts/aica-cli.cjs');

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return mod;
  };

  const stubTokenEndpoint = () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'exchanged' }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('a local target needs nothing', () => {
    it.each([
      [undefined],
      ['http://localhost:3001'],
      ['http://127.0.0.1:3001'],
      ['http://[::1]:3001'],
    ])('sends no credential to %s', async (url) => {
      const fetchMock = stubTokenEndpoint();
      const cli = loadCli(url ? { AICA_MICROSERVICE_URL: url } : {});

      await expect(cli.authorizationHeaders()).resolves.toEqual({});
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('a remote target', () => {
    it('sends the token it was given', async () => {
      const cli = loadCli({
        AICA_MICROSERVICE_URL: REMOTE,
        AICA_ADMIN_TOKEN: 'from-env',
      });

      await expect(cli.authorizationHeaders()).resolves.toEqual({
        Authorization: 'Bearer from-env',
      });
    });

    it('exchanges the automation credentials once per run, not once per request', async () => {
      const fetchMock = stubTokenEndpoint();
      const cli = loadCli({
        AICA_MICROSERVICE_URL: REMOTE,
        AICA_ADMIN_CLIENT_ID: 'automation',
        AICA_ADMIN_CLIENT_SECRET: 'automation-secret', // pragma: allowlist secret
      });

      await cli.authorizationHeaders();
      const headers = await cli.authorizationHeaders();

      expect(headers).toEqual({ Authorization: 'Bearer exchanged' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'http://liferay.test:8080/o/oauth2/token'
      );
    });

    it('refuses with what to set, rather than sending a request that will be refused', async () => {
      const cli = loadCli({ AICA_MICROSERVICE_URL: REMOTE });

      const refusal = cli.authorizationHeaders();

      await expect(refusal).rejects.toThrow(/not this machine/);
      await expect(cli.authorizationHeaders()).rejects.toThrow(
        /AICA_ADMIN_TOKEN/
      );
    });

    // A hostname that merely starts with "localhost" is somewhere else.
    it('does not take a lookalike host for this machine', async () => {
      const cli = loadCli({
        AICA_MICROSERVICE_URL: 'http://localhost.node.test:3001',
      });

      await expect(cli.authorizationHeaders()).rejects.toThrow(
        /not this machine/
      );
    });
  });

  it('lets a token a route was given win, locally and remotely', async () => {
    for (const url of ['http://localhost:3001', REMOTE]) {
      const cli = loadCli({
        AICA_MICROSERVICE_URL: url,
        AICA_ADMIN_TOKEN: 'from-env',
      });

      await expect(cli.authorizationHeaders('administrator')).resolves.toEqual({
        Authorization: 'Bearer administrator',
      });
    }
  });
});
