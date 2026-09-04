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

/**
 * Returns an absolute URL to the Commerce Channels screen, or null when the
 * configured base URL is missing or unusable.
 *
 * Callers should render plain text rather than a dead link when this is null.
 */
export function commerceChannelsUrl(liferayUrl) {
  const base = normalizeBase(liferayUrl);
  if (!base) return null;

  const params = new URLSearchParams({
    p_p_id: CHANNELS_PORTLET_ID,
    p_p_lifecycle: '0',
    p_p_state: 'maximized',
  });

  return `${base}${CONTROL_PANEL_PATH}?${params.toString()}`;
}

export { CHANNELS_PORTLET_ID, CONTROL_PANEL_PATH };
