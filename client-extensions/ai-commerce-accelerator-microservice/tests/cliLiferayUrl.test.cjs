const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const CLI = path.join(__dirname, '..', '..', '..', 'scripts', 'aica-cli.cjs');

/**
 * The CLI refuses rather than guessing which Liferay to act on.
 *
 * It used to fall back to `https://aica-e2e.demo` - the end-to-end suite's
 * hostname, which became a default in #456 and was never meant to be one. That
 * fires exactly when the operator has not said where their Liferay is, and
 * since #989 added browser sign-in it meant opening a window against a host
 * nobody named, carrying the client id and the loopback redirect URI (#1053).
 *
 * Driven as the real binary, as `cliResume.test.cjs` and `cliCounts.test.cjs`
 * are: the resolution happens at module load from the environment, so a test of
 * a function alone would not prove the binary refuses.
 *
 * Isolation needs AICA_IGNORE_DOTENV, not a working directory. Two of the CLI's
 * four `.env` search paths are relative to the script rather than to `cwd`
 * (`aica-cli.cjs`, `loadEnv`), so running from `/` does not escape the
 * repository's own `.env` - and deleting the variables here does not help
 * either, because the loader fills anything unset. Without the flag these cases
 * passed in CI, which has no `.env`, and failed on every machine that has one
 * (#1061).
 */
const NO_URL_ENV = () => {
  const env = { ...process.env, AICA_IGNORE_DOTENV: '1' };

  delete env.LIFERAY_PORTAL_URL;
  delete env.LIFERAY_URL;
  delete env.LIFERAY_API_URL;

  return env;
};

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: path.parse(process.cwd()).root,
      env,
    });

    let out = '';

    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('the CLI will not guess which Liferay to act on', () => {
  it('refuses, naming every variable that would answer it', async () => {
    const { out } = await runCli(['connect'], NO_URL_ENV());

    expect(out).toMatch(/LIFERAY_PORTAL_URL/);
    expect(out).toMatch(/LIFERAY_URL/);
    expect(out).toMatch(/LIFERAY_API_URL/);
  }, 30000);

  it('sends no target at all rather than a substituted one', async () => {
    // The specific regression, asserted on the wire rather than in the output.
    //
    // An earlier version of this test asserted the hostname was absent from
    // stdout. That passed with the fallback restored, because `connect` prints
    // the Liferay URL only on success - so it was asserting the absence of
    // something never present either way. The stub is what makes the
    // difference observable: with a fallback the payload carries a host the
    // operator never named; refusing means no request is made at all.
    const received = [];

    const server = http.createServer((req, res) => {
      let body = '';

      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          received.push(JSON.parse(body || '{}'));
        } catch {
          received.push({});
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'stub' }));
      });
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    const { port } = server.address();

    try {
      const env = NO_URL_ENV();

      env.AICA_MICROSERVICE_URL = `http://127.0.0.1:${port}`;

      await runCli(['connect'], env);

      expect(received).toEqual([]);
    } finally {
      server.close();
    }
  }, 30000);

  it('uses the target it was given', async () => {
    const env = NO_URL_ENV();

    env.LIFERAY_URL = 'http://liferay.example.test:8080';

    const { out } = await runCli(['connect'], env);

    // It gets as far as trying, which it could not do while refusing.
    expect(out).not.toMatch(/none is configured/);
  }, 30000);
});
