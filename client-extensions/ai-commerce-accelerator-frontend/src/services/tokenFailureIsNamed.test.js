import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from './apiClient';
import { HANDSHAKE_REFUSED, NO_CLIENT, NO_LIFERAY } from './oauth2Service';

/**
 * A failed token acquisition must fail by name, not by symptom (#1287).
 *
 * Run 38410417089 sent seventy requests with no credential because
 * `getOAuth2AccessToken` returned null and the client treated the header as
 * optional. The microservice then reported `Unsigned request rejected`
 * seventy times - true about what it received, and a misdirection about why.
 *
 * The acceptance criterion is that a refused handshake and a page loaded
 * outside Liferay produce different, identifiable outcomes, and it is proved
 * here by forcing each failure rather than by reading the code.
 */
vi.mock('./oauth2Service', async (importOriginal) => {
  const actual = await importOriginal();

  return { ...actual, acquireOAuth2AccessToken: vi.fn() };
});

const { acquireOAuth2AccessToken } = await import('./oauth2Service');

function clientWith(result) {
  acquireOAuth2AccessToken.mockResolvedValue(result);

  return createApiClient({ baseUrl: 'https://microservice.example' });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a refused handshake fails by name (#1287)', () => {
  it('does not send the request at all', async () => {
    // The whole point: the error has to arrive before the network, or the
    // microservice answers about signing and the reader is sent to #1109.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const api = clientWith({
      token: null,
      reason: HANDSHAKE_REFUSED,
      detail: 'No redirectURI in http://localhost/o/oauth2/redirect',
    });

    await expect(api.get('/api/v1/test-connection')).rejects.toThrow(
      /No OAuth2 access token/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('carries the reason and the refusal detail', async () => {
    vi.stubGlobal('fetch', vi.fn());

    const api = clientWith({
      token: null,
      reason: HANDSHAKE_REFUSED,
      detail: 'No redirectURI in http://localhost/o/oauth2/redirect',
    });

    await expect(api.get('/api/v1/test-connection')).rejects.toThrow(
      /handshake-refused.*No redirectURI/s
    );
  });

  it('names the missing token, never the missing signature', async () => {
    // The failure that cost nine days was named `Unsigned request rejected`,
    // which describes a mechanism a browser cannot use.
    vi.stubGlobal('fetch', vi.fn());

    const api = clientWith({ token: null, reason: NO_CLIENT });

    await expect(api.get('/api/v1/get-channels')).rejects.toThrow(
      /No OAuth2 access token/
    );
    await expect(api.get('/api/v1/get-channels')).rejects.not.toThrow(/sign/i);
  });

  it('applies to downloads as well as requests', async () => {
    // Two call sites held the same ternary; fixing one would have left the
    // other reporting the old symptom.
    vi.stubGlobal('fetch', vi.fn());

    const api = clientWith({ token: null, reason: HANDSHAKE_REFUSED });

    await expect(api.download('/api/v1/export-commerce-data')).rejects.toThrow(
      /No OAuth2 access token/
    );
  });
});

describe('a page outside Liferay still works (#1287)', () => {
  it('sends the request unauthenticated rather than failing', async () => {
    // Local development against the mock handlers has no Liferay global, and
    // that is not a fault. If this fails, the fix has broken `yarn dev`.
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const api = clientWith({ token: null, reason: NO_LIFERAY });

    await api.get('/api/v1/test-connection');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

describe('a token that arrives is used (#1287)', () => {
  it('sends it as a bearer credential', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    });
    vi.stubGlobal('fetch', fetchSpy);

    const api = clientWith({ token: 'a-jwt', reason: null });

    await api.get('/api/v1/test-connection');

    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer a-jwt'
    );
  });
});
