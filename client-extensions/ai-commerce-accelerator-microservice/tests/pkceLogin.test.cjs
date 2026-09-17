const crypto = require('crypto');

const {
  DEFAULT_PORT,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  login,
  readCallback,
} = require('../../../scripts/pkce-login.cjs');

/**
 * RFC 8252, the flow gh/aws/gcloud use: an authorization code with PKCE,
 * redirected to a loopback listener, through the system browser (#989).
 *
 * The properties under test are the ones the specification exists to protect -
 * that the challenge is a digest rather than the verifier, that a code from
 * another authorization cannot be exchanged here, and that the listener is not
 * reachable from off the machine. A flow that merely returns a token while
 * failing these would look identical in use.
 */

describe('PKCE loopback login (#989)', () => {
  describe('the PKCE pair', () => {
    it('derives the challenge as base64url(sha256(verifier))', () => {
      const { verifier, challenge, method } = createPkcePair();
      const expected = crypto
        .createHash('sha256')
        .update(verifier)
        .digest('base64url');

      expect(challenge).toBe(expected);
      expect(method).toBe('S256');
    });

    // `plain` would put the verifier through the browser and the authorization
    // server's logs, which is the thing the digest avoids.
    it('never sends the verifier as the challenge', () => {
      const { verifier, challenge } = createPkcePair();

      expect(challenge).not.toBe(verifier);
    });

    it('is different every time', () => {
      expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
    });

    // 32 bytes base64url-encoded: comfortably inside the 43-128 character range
    // RFC 7636 requires, with no padding to be mangled in a query string.
    it('produces a verifier of usable length and alphabet', () => {
      const { verifier } = createPkcePair();

      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('the authorize URL', () => {
    const url = () =>
      new URL(
        buildAuthorizeUrl({
          liferayUrl: 'http://localhost:8080',
          clientId: 'id-cli',
          redirectUri: `http://127.0.0.1:${DEFAULT_PORT}/callback`,
          challenge: 'the-challenge',
          state: 'the-state',
          scopes: 'Liferay.Headless.Admin.User.everything.read',
        })
      );

    it('asks for a code, with the challenge and its method', () => {
      const p = url().searchParams;

      expect(p.get('response_type')).toBe('code');
      expect(p.get('code_challenge')).toBe('the-challenge');
      expect(p.get('code_challenge_method')).toBe('S256');
      expect(p.get('client_id')).toBe('id-cli');
      expect(p.get('state')).toBe('the-state');
    });

    // Passing a redirect_uri through is not worth asserting - that would test
    // the fixture. The one login() builds is asserted in the login tests below,
    // where it is the code's choice rather than the test's.
    it('passes the redirect_uri through unchanged', () => {
      expect(url().searchParams.get('redirect_uri')).toBe(
        `http://127.0.0.1:${DEFAULT_PORT}/callback`
      );
    });

    it('carries no client secret', () => {
      expect(url().searchParams.get('client_secret')).toBeNull();
    });

    it('targets the Liferay authorize endpoint', () => {
      expect(url().pathname).toBe('/o/oauth2/authorize');
    });
  });

  describe('the redirect', () => {
    it('returns the code when the state matches', () => {
      expect(readCallback('/callback?code=abc&state=xyz', 'xyz')).toEqual({
        code: 'abc',
      });
    });

    // Without this, a code from someone else's authorization could be
    // delivered to this listener and exchanged here.
    it('refuses a mismatched state', () => {
      expect(
        readCallback('/callback?code=abc&state=attacker', 'xyz').error
      ).toMatch(/state did not match/);
    });

    it('refuses a missing state', () => {
      expect(readCallback('/callback?code=abc', 'xyz').error).toMatch(
        /state did not match/
      );
    });

    it('surfaces an error the authorization server returned', () => {
      const result = readCallback(
        '/callback?error=access_denied&error_description=User+said+no&state=xyz',
        'xyz'
      );

      expect(result.error).toMatch(/access_denied/);
      expect(result.error).toMatch(/User said no/);
      expect(result.code).toBeUndefined();
    });

    // An error arrives without state; refusing it for that reason would report
    // the wrong cause.
    it('reports the server error rather than the absent state', () => {
      expect(
        readCallback('/callback?error=access_denied', 'xyz').error
      ).toMatch(/access_denied/);
    });

    it('refuses a redirect carrying neither code nor error', () => {
      expect(readCallback('/callback?state=xyz', 'xyz').error).toMatch(
        /no authorization code/
      );
    });
  });

  describe('the exchange', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stub = (body, ok = true, status = 200) => {
      const f = vi.fn().mockResolvedValue({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      });
      vi.stubGlobal('fetch', f);
      return f;
    };

    it('sends the verifier, not the challenge', async () => {
      const f = stub({ access_token: 'the-token' });

      await exchangeCode({
        liferayUrl: 'http://localhost:8080',
        clientId: 'id-cli',
        redirectUri: 'http://127.0.0.1:38017/callback',
        code: 'the-code',
        verifier: 'the-verifier',
      });

      const body = String(f.mock.calls[0][1].body);

      expect(body).toContain('grant_type=authorization_code');
      expect(body).toContain('code_verifier=the-verifier');
      expect(body).toContain('code=the-code');
    });

    it('returns the access token', async () => {
      stub({ access_token: 'the-token' });

      await expect(
        exchangeCode({
          liferayUrl: 'http://localhost:8080',
          clientId: 'id-cli',
          redirectUri: 'http://127.0.0.1:38017/callback',
          code: 'c',
          verifier: 'v',
        })
      ).resolves.toBe('the-token');
    });

    it('surfaces a rejected exchange', async () => {
      stub({ error: 'invalid_grant' }, false, 400);

      await expect(
        exchangeCode({
          liferayUrl: 'http://localhost:8080',
          clientId: 'id-cli',
          redirectUri: 'http://127.0.0.1:38017/callback',
          code: 'c',
          verifier: 'v',
        })
      ).rejects.toThrow(/HTTP 400/);
    });

    // A 200 with no token would otherwise be sent as `Bearer undefined`.
    it('refuses a response with no access_token', async () => {
      stub({ token_type: 'Bearer' });

      await expect(
        exchangeCode({
          liferayUrl: 'http://localhost:8080',
          clientId: 'id-cli',
          redirectUri: 'http://127.0.0.1:38017/callback',
          code: 'c',
          verifier: 'v',
        })
      ).rejects.toThrow(/no access_token/);
    });
  });

  describe('login', () => {
    afterEach(() => vi.unstubAllGlobals());

    // A fake server that hands the flow one redirect, so the whole login can be
    // driven without a browser or a real socket.
    const fakeServer = (requestUrl) => {
      const handlers = {};
      return {
        on: (event, handler) => {
          handlers[event] = handler;
        },
        listen: () => {
          setImmediate(() =>
            handlers.request?.(
              { url: requestUrl },
              { writeHead() {}, end() {} }
            )
          );
        },
        close: () => {},
      };
    };

    it('binds the loopback interface only', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 't' }),
          text: async () => '',
        })
      );

      let boundHost;
      const server = {
        on: (event, handler) => {
          if (event === 'request') server._request = handler;
        },
        listen: (_port, host) => {
          boundHost = host;
          setImmediate(() =>
            server._request?.(
              { url: '/callback?code=c&state=' + server._state },
              { writeHead() {}, end() {} }
            )
          );
        },
        close: () => {},
      };

      // The state is generated inside login, so capture it from the URL it
      // opens rather than guessing.
      await login({
        liferayUrl: 'http://localhost:8080',
        clientId: 'id-cli',
        log: () => {},
        open: (url) => {
          server._state = new URL(url).searchParams.get('state');
        },
        createServer: () => server,
      });

      expect(boundHost).toBe('127.0.0.1');
    });

    // RFC 8252 s8.3: `localhost` resolves through DNS and the hosts file and
    // can be pointed elsewhere; the IP literal cannot. This asserts the URI
    // login() constructs, not one handed to it.
    it('builds a redirect to the loopback IP literal, never localhost', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ access_token: 't' }),
          text: async () => '',
        })
      );

      let opened;
      const server = {
        on: (event, handler) => {
          if (event === 'request') server._request = handler;
        },
        listen: () => {
          setImmediate(() =>
            server._request?.(
              { url: '/callback?code=c&state=' + server._state },
              { writeHead() {}, end() {} }
            )
          );
        },
        close: () => {},
      };

      await login({
        liferayUrl: 'http://localhost:8080',
        clientId: 'id-cli',
        log: () => {},
        open: (url) => {
          opened = url;
          server._state = new URL(url).searchParams.get('state');
        },
        createServer: () => server,
      });

      const redirectUri = new URL(opened).searchParams.get('redirect_uri');

      expect(redirectUri).toContain('127.0.0.1');
      expect(redirectUri).not.toContain('localhost');
    });

    it('refuses without a Liferay URL or client id', async () => {
      await expect(
        login({
          clientId: 'id',
          log: () => {},
          createServer: () => fakeServer(''),
        })
      ).rejects.toThrow(/Liferay URL/);
      await expect(
        login({
          liferayUrl: 'http://x',
          log: () => {},
          createServer: () => fakeServer(''),
        })
      ).rejects.toThrow(/client id/);
    });
  });
});
