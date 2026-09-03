/**
 * Retrieves a real OAuth2 access token (JWT) from Liferay's User Agent Application.
 *
 * @param {string} userAgentERC - The ERC of the oAuthApplicationUserAgent client extension.
 * @returns {Promise<string|null>} The access token string (JWT) or null if unavailable.
 */
export async function getOAuth2AccessToken(
  userAgentERC = 'ai-commerce-accelerator-microservice-user-agent'
) {
  if (typeof window === 'undefined' || typeof Liferay === 'undefined') {
    return null;
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
      return null;
    }

    // 3. Extract access token via client._getOrRequestToken()
    if (typeof client._getOrRequestToken === 'function') {
      const tokenData = await client._getOrRequestToken();
      return tokenData?.access_token || null;
    }

    return null;
  } catch (err) {
    console.warn('[AICA OAuth2] Could not acquire OAuth2 access token:', err);
    return null;
  }
}
