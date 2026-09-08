/**
 * Deep links into a Liferay instance, built from the configured base URL so
 * they work against localhost, PaaS or any other host without special casing.
 */

/**
 * The Commerce Channels admin screen.
 *
 * A **portal** URL, not a site one: commerce channels are administered at
 * instance level, so there is no site segment and no site to resolve. The
 * portlet id comes from com.liferay.commerce.channel.web.
 */
const CHANNELS_PORTLET_ID =
  'com_liferay_commerce_channel_web_internal_portlet_CommerceChannelsPortlet';

/**
 * The Client Extensions listing in the Control Panel.
 *
 * Its portlet id carries no instance-specific segment, unlike the per-entry
 * portlet ids, so this link always resolves. It is the fallback whenever the
 * configuration extension's own portlet id cannot be read - see #660.
 */
const CLIENT_EXTENSIONS_PORTLET_ID =
  'com_liferay_client_extension_web_internal_portlet_ClientExtensionAdminPortlet';

const CONTROL_PANEL_PATH = '/group/control_panel/manage';

function normalizeBase(liferayUrl) {
  const base = String(liferayUrl || '').trim();
  if (!base) return null;

  try {
    const url = new URL(base);
    if (!/^https?:$/.test(url.protocol)) return null;
    return base.replace(/\/+$/, '');
  } catch {
    // Not an absolute URL - nothing safe to build a link from.
    return null;
  }
}

function controlPanelUrl(liferayUrl, portletId, hash = '') {
  const base = normalizeBase(liferayUrl);
  if (!base || !portletId) return null;

  const params = new URLSearchParams({
    p_p_id: portletId,
    p_p_lifecycle: '0',
    p_p_state: 'maximized',
  });

  return `${base}${CONTROL_PANEL_PATH}?${params.toString()}${hash}`;
}

/**
 * Returns an absolute URL to the Commerce Channels screen, or null when the
 * configured base URL is missing or unusable.
 *
 * Callers should render plain text rather than a dead link when this is null.
 */
export function commerceChannelsUrl(liferayUrl) {
  return controlPanelUrl(liferayUrl, CHANNELS_PORTLET_ID);
}

/**
 * Returns an absolute URL to a client extension's own Control Panel screen.
 *
 * The portlet id has to be supplied because it embeds the company id, which
 * Liferay assigns per database and publishes nowhere a browser can read. The
 * microservice reads it from the `client-extension-entry` module and reports
 * it on the config health payload; null here means it could not be read, and
 * the caller falls back to `clientExtensionsUrl`.
 */
export function clientExtensionPortletUrl(liferayUrl, portletId, hash = '') {
  return controlPanelUrl(liferayUrl, portletId, hash);
}

/**
 * Returns an absolute URL to the Client Extensions listing, which resolves on
 * every instance because its portlet id carries no per-instance segment.
 */
export function clientExtensionsUrl(liferayUrl) {
  return controlPanelUrl(liferayUrl, CLIENT_EXTENSIONS_PORTLET_ID);
}

export {
  CHANNELS_PORTLET_ID,
  CLIENT_EXTENSIONS_PORTLET_ID,
  CONTROL_PANEL_PATH,
};
