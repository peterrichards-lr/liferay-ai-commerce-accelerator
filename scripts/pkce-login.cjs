#!/usr/bin/env node

/**
 * Signing in as yourself, from a terminal.
 *
 * `aica delete` and `aica config set` act on routes reserved for administrator
 * accounts. The credentials the CLI already holds authenticate the microservice
 * to Liferay - they are not an operator, and no allowlist entry can make them
 * one (#930). An operator therefore had no way to run these commands as
 * themselves.
 *
 * This is the flow RFC 8252 specifies for native applications, and the one gh,
 * aws and gcloud use: an authorization code with PKCE, redirected to a loopback
 * listener, through the system browser (#989).
 *
 * Three details are specified rather than chosen, and each closes something:
 *
 *   - **127.0.0.1, never `localhost`** (RFC 8252 s8.3). `localhost` resolves
 *     through DNS and the hosts file and can be pointed elsewhere; the IP
 *     literal cannot.
 *   - **The system browser, never an embedded view.** An embedded view can
 *     observe what the operator types, which is the thing this avoids.
 *   - **No client secret.** A secret shipped inside a distributed CLI is not a
 *     secret. PKCE is what replaces it: the code is bound to the process that
 *     asked for it, so an intercepted code is useless on its own.
 *
 * The token is returned, never written to disk. Re-authenticating costs one
 * browser round trip on a command this rare, and a token at rest is a
 * credential to look after.
 */

const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

// Registered with the OAuth2 application, so it cannot be arbitrary. RFC 8252
// s7.3 recommends servers accept any loopback port, but that is a
// recommendation, and an exact-match registration works whether or not a given
// server follows it. Failing loudly on a busy port beats depending on
// behaviour nobody measured.
const DEFAULT_PORT = 38017;

const base64url = (buffer) => buffer.toString('base64url');

/**
 * A verifier and the challenge derived from it.
 *
 * S256 rather than `plain`: the challenge is what travels through the browser
 * and the authorization server's logs, and a plain challenge is the verifier.
 */
function createPkcePair() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(
    crypto.createHash('sha256').update(verifier).digest()
  );

  return { verifier, challenge, method: 'S256' };
}

function buildAuthorizeUrl({
  liferayUrl,
  clientId,
  redirectUri,
  challenge,
  state,
  scopes,
}) {
  const url = new URL('/o/oauth2/authorize', liferayUrl);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  if (scopes) {
    url.searchParams.set('scope', scopes);
  }

  return url.toString();
}

/**
 * What came back on the redirect.
 *
 * The state check is the CSRF defence: without it a code from someone else's
 * authorization could be delivered to this listener and exchanged here.
 */
function readCallback(requestUrl, expectedState) {
  const params = new URL(requestUrl, 'http://127.0.0.1').searchParams;
  const error = params.get('error');

  if (error) {
    const description = params.get('error_description');

    return {
      error: description ? `${error}: ${description}` : error,
    };
  }

  const state = params.get('state');

  if (!state || state !== expectedState) {
    return { error: 'state did not match the one this login sent' };
  }

  const code = params.get('code');

  if (!code) {
    return { error: 'no authorization code in the redirect' };
  }

  return { code };
}

function openInBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';

  try {
    spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Waits for one redirect, then stops listening. */
function awaitRedirect(server, port, expectedState) {
  return new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const outcome = readCallback(req.url, expectedState);

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(
        outcome.error
          ? `Sign-in failed: ${outcome.error}\n\nYou can close this tab.`
          : 'Signed in. You can close this tab and return to the terminal.'
      );

      server.close();

      if (outcome.error) {
        reject(new Error(outcome.error));
      } else {
        resolve(outcome.code);
      }
    });

    server.on('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(
              `Port ${port} is in use, and it is the one registered as this ` +
                `CLI's redirect URI, so another port cannot be substituted. ` +
                `Close whatever is holding it and try again.`
            )
          : error
      );
    });

    // 127.0.0.1 rather than localhost, and rather than every interface: this
    // listener accepts an authorization code, and nothing off the machine
    // should be able to reach it.
    server.listen(port, '127.0.0.1');
  });
}

async function exchangeCode({
  liferayUrl,
  clientId,
  redirectUri,
  code,
  verifier,
}) {
  const res = await fetch(new URL('/o/oauth2/token', liferayUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `Could not exchange the authorization code: HTTP ${res.status}: ${await res.text()}`
    );
  }

  const body = await res.json();

  if (!body.access_token) {
    throw new Error(
      'Liferay returned no access_token for the authorization code.'
    );
  }

  return body.access_token;
}

async function login({
  liferayUrl,
  clientId,
  port = DEFAULT_PORT,
  scopes,
  log = console.error,
  open = openInBrowser,
  createServer = http.createServer,
} = {}) {
  if (!liferayUrl) throw new Error('No Liferay URL to sign in against.');
  if (!clientId) throw new Error('No OAuth2 client id for the CLI.');

  const { verifier, challenge } = createPkcePair();
  const state = base64url(crypto.randomBytes(16));
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const authorizeUrl = buildAuthorizeUrl({
    liferayUrl,
    clientId,
    redirectUri,
    challenge,
    state,
    scopes,
  });

  const server = createServer();
  const redirect = awaitRedirect(server, port, state);

  log(`\n🔐 Opening your browser to sign in to ${liferayUrl}`);
  log(`   If it does not open, visit:\n   ${authorizeUrl}\n`);
  open(authorizeUrl);

  const code = await redirect;

  return exchangeCode({ liferayUrl, clientId, redirectUri, code, verifier });
}

module.exports = {
  DEFAULT_PORT,
  buildAuthorizeUrl,
  createPkcePair,
  exchangeCode,
  login,
  readCallback,
};
