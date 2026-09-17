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

  // ADMIN_TOKEN is read once, when the module loads, so setting process.env
  // inside a test cannot reach it. Re-importing with the environment already in
  // place is the only way to exercise the env path at all - without this the
  // precedence assertion passes whichever operand wins, which is no test.
  const loadCli = (env) => {
    const previous = process.env.AICA_ADMIN_TOKEN;

    if (env === undefined) {
      delete process.env.AICA_ADMIN_TOKEN;
    } else {
      process.env.AICA_ADMIN_TOKEN = env;
    }

    // vi.resetModules() does not clear Node's CJS require cache, so the
    // module would be returned with ADMIN_TOKEN already frozen from the first
    // load.
    delete require.cache[require.resolve('../../../scripts/aica-cli.cjs')];
    const mod = require('../../../scripts/aica-cli.cjs');

    if (previous === undefined) {
      delete process.env.AICA_ADMIN_TOKEN;
    } else {
      process.env.AICA_ADMIN_TOKEN = previous;
    }

    return mod;
  };

  describe('resolution', () => {
    it('uses AICA_ADMIN_TOKEN when no flag is given', () => {
      const cli = loadCli('from-env');

      expect(cli.adminToken({}, 'aica delete')).toBe('from-env');
    });

    it('prefers the flag over the environment', () => {
      const cli = loadCli('from-env');

      expect(cli.adminToken({ token: 'from-flag' }, 'aica delete')).toBe(
        'from-flag'
      );
    });

    it('refuses when neither is supplied, naming the policy', () => {
      const cli = loadCli(undefined);

      expect(() => cli.adminToken({}, 'aica delete')).toThrow(
        /administrator accounts/
      );
      expect(() => cli.adminToken({}, 'aica delete')).toThrow(/--token/);
    });

    // The refusal has to explain that the credentials the CLI already holds are
    // not an operator, or the obvious next move is to add the client id to
    // AICA_ADMINS - which cannot work, because no token is sent at all.
    it('explains that the client credentials are not an operator identity', () => {
      const cli = loadCli(undefined);

      expect(() => cli.adminToken({}, 'aica delete')).toThrow(
        /not an operator identity/
      );
    });

    it('names the command that was refused', () => {
      const cli = loadCli(undefined);

      expect(() => cli.adminToken({}, 'aica config set')).toThrow(
        /aica config set/
      );
    });
  });
});
