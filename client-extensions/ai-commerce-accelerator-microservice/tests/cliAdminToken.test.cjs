const {
  adminToken,
  parseControlOptions,
} = require('../../../scripts/aica-cli.cjs');

/**
 * `aica delete` and `aica config set` post to routes gated on an administrator
 * account, and the CLI has never sent a credential of its own - the client id
 * and secret it holds travel in the body, for the microservice to use against
 * Liferay. Both commands therefore could not work at all (#930).
 *
 * The refusal matters as much as the token: without it the operator sees a 401
 * about request-signing headers, which says nothing about why an operator
 * identity is required.
 */

describe('aica CLI: admin token for gated commands (#930)', () => {
  const original = process.env.AICA_ADMIN_TOKEN;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AICA_ADMIN_TOKEN;
    } else {
      process.env.AICA_ADMIN_TOKEN = original;
    }
  });

  describe('parsing', () => {
    it('reads --token <value>', () => {
      expect(parseControlOptions(['--all', '--token', 'abc123'])).toMatchObject(
        {
          all: true,
          token: 'abc123',
        }
      );
    });

    it('reads --token=<value>', () => {
      expect(parseControlOptions(['--token=abc123'])).toMatchObject({
        token: 'abc123',
      });
    });

    // The value must not be mistaken for a flag in its own right.
    it('does not treat the token value as another flag', () => {
      expect(parseControlOptions(['--token', '--all'])).toMatchObject({
        token: '--all',
      });
      expect(parseControlOptions(['--token', '--all']).all).toBeUndefined();
    });

    it('leaves the existing flags working', () => {
      expect(
        parseControlOptions(['--selected', '-y', '--bundle', '--instance'])
      ).toMatchObject({
        selected: true,
        nonInteractive: true,
        bundle: true,
        instance: true,
      });
    });
  });

  // The credential constants are read once, when the module loads, so setting
  // process.env inside a test cannot reach them. Re-importing with the
  // environment already in place is the only way to exercise those paths at all
  // - without this the precedence assertions pass whichever operand wins, which
  // is no test.
  const CRED_VARS = [
    'AICA_ADMIN_TOKEN',
    'AICA_ADMIN_CLIENT_ID',
    'AICA_ADMIN_CLIENT_SECRET',
  ];

  const loadCli = (env = {}) => {
    const previous = {};

    for (const key of CRED_VARS) {
      previous[key] = process.env[key];

      if (env[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = env[key];
      }
    }

    // vi.resetModules() does not clear Node's CJS require cache, so the module
    // would be returned with its constants already frozen from the first load.
    delete require.cache[require.resolve('../../../scripts/aica-cli.cjs')];
    const mod = require('../../../scripts/aica-cli.cjs');

    for (const key of CRED_VARS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }

    return mod;
  };

  describe('resolution', () => {
    it('uses AICA_ADMIN_TOKEN when no flag is given', async () => {
      const cli = loadCli({ AICA_ADMIN_TOKEN: 'from-env' });

      await expect(cli.adminToken({}, 'aica delete')).resolves.toBe('from-env');
    });

    it('prefers the flag over the environment', async () => {
      const cli = loadCli({ AICA_ADMIN_TOKEN: 'from-env' });

      await expect(
        cli.adminToken({ token: 'from-flag' }, 'aica delete')
      ).resolves.toBe('from-flag');
    });

    it('refuses when nothing is supplied, naming both paths', async () => {
      const cli = loadCli({});

      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /administrator accounts/
      );
      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /--token/
      );
      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /AICA_ADMIN_CLIENT_ID/
      );
    });

    // The refusal has to explain that the credentials the CLI already holds are
    // not an operator, or the obvious next move is to allowlist that client id -
    // which cannot work, because those credentials authenticate the microservice
    // to Liferay rather than the caller to the microservice.
    it('explains that the existing credentials are not an operator identity', async () => {
      const cli = loadCli({});

      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /not an operator identity/
      );
    });

    it('names the command that was refused', async () => {
      const cli = loadCli({});

      await expect(cli.adminToken({}, 'aica config set')).rejects.toThrow(
        /aica config set/
      );
    });
  });

  // Unattended callers exchange a dedicated application's credentials for a
  // token. The application must be named in AICA_ADMIN_CLIENTS on the service
  // (#988); the CLI's part is obtaining the token at all.
  describe('unattended: client-credentials exchange', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const stubToken = (body, ok = true, status = 200) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    };

    it('exchanges the application credentials for a token', async () => {
      const fetchMock = stubToken({ access_token: 'minted-token' });
      const cli = loadCli({
        AICA_ADMIN_CLIENT_ID: 'id-automation',
        AICA_ADMIN_CLIENT_SECRET: 'shh',
      });

      await expect(cli.adminToken({}, 'aica delete')).resolves.toBe(
        'minted-token'
      );

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain('/o/oauth2/token');
      expect(String(init.body)).toContain('grant_type=client_credentials');
      expect(String(init.body)).toContain('client_id=id-automation');
    });

    it('does not exchange when a token was supplied directly', async () => {
      const fetchMock = stubToken({ access_token: 'minted-token' });
      const cli = loadCli({
        AICA_ADMIN_TOKEN: 'already-have-one',
        AICA_ADMIN_CLIENT_ID: 'id-automation',
        AICA_ADMIN_CLIENT_SECRET: 'shh',
      });

      await expect(cli.adminToken({}, 'aica delete')).resolves.toBe(
        'already-have-one'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a rejected exchange rather than returning nothing', async () => {
      stubToken({ error: 'invalid_client' }, false, 401);
      const cli = loadCli({
        AICA_ADMIN_CLIENT_ID: 'id-automation',
        AICA_ADMIN_CLIENT_SECRET: 'wrong',
      });

      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /HTTP 401/
      );
    });

    // A 200 with no access_token would otherwise be sent as `Bearer undefined`.
    it('refuses a response carrying no access_token', async () => {
      stubToken({ token_type: 'Bearer' });
      const cli = loadCli({
        AICA_ADMIN_CLIENT_ID: 'id-automation',
        AICA_ADMIN_CLIENT_SECRET: 'shh',
      });

      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /no access_token/
      );
    });

    it('refuses when only one half of the pair is set', async () => {
      const cli = loadCli({ AICA_ADMIN_CLIENT_ID: 'id-automation' });

      await expect(cli.adminToken({}, 'aica delete')).rejects.toThrow(
        /administrator accounts/
      );
    });
  });
});
