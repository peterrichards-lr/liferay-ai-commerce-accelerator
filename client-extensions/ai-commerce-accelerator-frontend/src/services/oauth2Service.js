/**
 * Why this returns a reason rather than `null` (#1287).
 *
 * It used to have four `return null` paths for four different causes, and the
 * API client treated that null as an optional credential:
 *
 *     ...(oauthToken ? { Authorization: `Bearer ${oauthToken}` } : {}),
 *
 * So a refused handshake became a request with no credential, which the
 * microservice answered truthfully about what it received - `Unsigned request
 * rejected`, seventy times in run 38410417089. True, and a misdirection: a
 * browser holds no secret and was never meant to sign. It is meant to arrive
 * authenticated. #1109 spent its time on the signing gate because of it.
 *
 * The distinction that matters is between "this page is not running inside
 * Liferay", which is ordinary during local development against the mock
 * handlers, and "Liferay refused the handshake", which is a deployment fault
 * and was the whole of #1283. Those were indistinguishable, so no caller
 * could act on either.
 */

/** No Liferay on the page at all - local dev, or the element rendered alone. */
export const NO_LIFERAY = 'no-liferay';
/** Liferay is present but neither provider yielded an OAuth2 client. */
export const NO_CLIENT = 'no-client';
/** A client without the accessor we read the token through. */
export const NO_TOKEN_ACCESSOR = 'no-token-accessor';
/** The accessor answered, without an access token in it. */
export const NO_ACCESS_TOKEN = 'no-access-token';
/** Liferay refused. This is the one that means the deployment is wrong. */
export const HANDSHAKE_REFUSED = 'handshake-refused';

/**
 * Acquires an OAuth2 access token (JWT) from Liferay's User Agent Application.
 *
 * @param {string} userAgentERC - ERC of the oAuthApplicationUserAgent extension.
 * @returns {Promise<{token: string|null, reason: string|null, detail?: string}>}
 *   `token` set and `reason` null on success; otherwise `reason` is one of the
 *   constants above and `token` is null.
 */
export async function acquireOAuth2AccessToken(
  userAgentERC = 'ai-commerce-accelerator-microservice-user-agent'
) {
  if (typeof window === 'undefined' || typeof Liferay === 'undefined') {
    return { token: null, reason: NO_LIFERAY };
  }

  try {
    let client = null;

    // 1. Try modern ESM import map first (@liferay/oauth2-provider-web/client)
    try {
      const moduleName = '@liferay/oauth2-provider-web/client';
      const OAuth2 = await import(/* @vite-ignore */ moduleName);
      if (OAuth2 && typeof OAuth2.FromUserAgentApplication === 'function') {
        client = await OAuth2.FromUserAgentApplication(userAgentERC);
      }
    } catch {
      // Import map not resolved; proceed to fallback
    }

    // 2. Fall back to legacy window.Liferay.OAuth2Client
    if (
      !client &&
      typeof window.Liferay?.OAuth2Client?.FromUserAgentApplication ===
        'function'
    ) {
      client =
        await window.Liferay.OAuth2Client.FromUserAgentApplication(
          userAgentERC
        );
    }

    if (!client) {
      return { token: null, reason: NO_CLIENT };
    }

    // 3. Extract access token via client._getOrRequestToken()
    if (typeof client._getOrRequestToken !== 'function') {
      return { token: null, reason: NO_TOKEN_ACCESSOR };
    }

    const tokenData = await client._getOrRequestToken();

    return tokenData?.access_token
      ? { token: tokenData.access_token, reason: null }
      : { token: null, reason: NO_ACCESS_TOKEN };
  } catch (err) {
    // Kept, and now not the only trace: #1286 routes this into the artifact,
    // and the caller is told enough to fail by name rather than by symptom.
    console.warn('[AICA OAuth2] Could not acquire OAuth2 access token:', err);

    return {
      token: null,
      reason: HANDSHAKE_REFUSED,
      detail: err?.message ? String(err.message) : String(err),
    };
  }
}

/**
 * The token alone, for callers that genuinely treat it as optional.
 *
 * `useRealtimeWebSocket` is one: it appends the token as a query parameter
 * when it has one. Anything calling the microservice's authenticated API is
 * not, and should use `acquireOAuth2AccessToken` so it can act on the reason.
 */
export async function getOAuth2AccessToken(userAgentERC) {
  const { token } = await acquireOAuth2AccessToken(userAgentERC);

  return token;
}
