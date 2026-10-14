import { CORRELATION_ID_HEADER } from '../utils/sharedConstants';
import { acquireOAuth2AccessToken, NO_LIFERAY } from './oauth2Service';

/**
 * The credential, or an error that names what is actually missing (#1287).
 *
 * A failed acquisition used to remove the Authorization header and send the
 * request anyway, so the failure surfaced one layer down as `Unsigned request
 * rejected` - a true statement about a mechanism the browser was never meant
 * to use, and the reason #1109 spent its time on the signing gate.
 *
 * NO_LIFERAY is the one reason that is not a fault: the element renders
 * outside the portal during local development, against the mock handlers, and
 * must keep working. Every other reason means the page should have had a
 * token and does not, and continuing only moves the error somewhere less
 * informative.
 */
async function authorizationHeader() {
  const { token, reason, detail } = await acquireOAuth2AccessToken();

  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  if (reason === NO_LIFERAY) {
    return {};
  }

  throw new Error(
    `No OAuth2 access token for the microservice (${reason})` +
      (detail ? `: ${detail}` : '') +
      '. The request was not sent. See AICA#1287.'
  );
}

export function createApiClient({
  baseUrl,
  withCredentials = true,
  getCorrelationId,
  onCorrelationIdUpdate,
}) {
  const base = (typeof baseUrl === 'string' ? baseUrl : '').replace(/\/+$/, '');

  function toUrl(path) {
    if (/^https?:\/\//i.test(path)) return path;
    if (!base) {
      const msg = `[apiClient] Cannot construct URL for relative path "${path}". Base URL is ${
        baseUrl === undefined ? 'undefined' : `"${baseUrl}"`
      }.`;
      console.warn(msg);
      throw new Error(msg);
    }
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async function request(path, { method = 'GET', body, headers, signal } = {}) {
    const url = toUrl(path);
    const isFormData =
      typeof FormData !== 'undefined' && body instanceof FormData;

    const cid =
      typeof getCorrelationId === 'function'
        ? getCorrelationId()
        : (typeof window !== 'undefined' &&
            sessionStorage.getItem('correlationId')) ||
          null;

    const auth = await authorizationHeader();

    const h = {
      Accept: 'application/json, */*;q=0.1',
      ...auth,
      ...(!isFormData && body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
      ...(cid ? { [CORRELATION_ID_HEADER]: cid } : {}),
    };

    const res = await fetch(url, {
      method,
      credentials: withCredentials ? 'include' : 'same-origin',
      headers: h,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
      signal,
    });

    const serverCid = res.headers.get(CORRELATION_ID_HEADER);
    if (!cid && serverCid && typeof onCorrelationIdUpdate === 'function') {
      onCorrelationIdUpdate(serverCid);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const suffix = text ? ` — ${text}` : '';
      const cidInfo = cid ? ` [corrId=${cid}]` : '';
      throw new Error(
        `HTTP ${res.status} ${res.statusText}${suffix}${cidInfo}`
      );
    }

    // 204/304 have no body
    if (res.status === 204 || res.status === 304) return null;

    const ct = (res.headers.get('content-type') || '').toLowerCase();

    if (ct.includes('application/json') || ct.includes('+json')) {
      return res.json();
    }

    return res.text();
  }

  /**
   * A response that is a file rather than a payload.
   *
   * `request` decides what to return by content type and hands back parsed
   * JSON or text, which turns a zip into a mangled string. A package is a
   * zip, so it needs the body untouched - and it needs the headers, because
   * for extract and export the counts in the headers *are* the result: how
   * much media could not be resolved, and how many products are missing a
   * field the schema requires. Returning only the blob would drop exactly the
   * part that says the package is thinner than its source.
   *
   * An error is still JSON, so a failure is read as a message rather than
   * downloaded as a corrupt file named after the thing that did not happen.
   */
  async function download(
    path,
    { method = 'GET', body, headers, signal } = {}
  ) {
    const url = toUrl(path);
    const cid =
      typeof getCorrelationId === 'function'
        ? getCorrelationId()
        : (typeof window !== 'undefined' &&
            sessionStorage.getItem('correlationId')) ||
          null;

    const auth = await authorizationHeader();

    const res = await fetch(url, {
      method,
      credentials: withCredentials ? 'include' : 'same-origin',
      headers: {
        Accept: 'application/zip, application/json;q=0.9, */*;q=0.1',
        ...auth,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {}),
        ...(cid ? { [CORRELATION_ID_HEADER]: cid } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let message = text;

      try {
        message = JSON.parse(text).error || text;
      } catch {
        // Not JSON. The text, whatever it is, is more use than the status.
      }

      throw new Error(message || `HTTP ${res.status} ${res.statusText}`);
    }

    return { blob: await res.blob(), headers: res.headers };
  }

  return {
    download: (p, opts) => download(p, opts),
    get: (p, opts) => request(p, { ...opts, method: 'GET' }),
    post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
    put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
    del: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
  };
}
