import { CORRELATION_ID_HEADER } from '../utils/sharedConstants';
import { getOAuth2AccessToken } from './oauth2Service';

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

    const oauthToken = await getOAuth2AccessToken();

    const h = {
      Accept: 'application/json, */*;q=0.1',
      ...(oauthToken ? { Authorization: `Bearer ${oauthToken}` } : {}),
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

    const oauthToken = await getOAuth2AccessToken();

    const res = await fetch(url, {
      method,
      credentials: withCredentials ? 'include' : 'same-origin',
      headers: {
        Accept: 'application/zip, application/json;q=0.9, */*;q=0.1',
        ...(oauthToken ? { Authorization: `Bearer ${oauthToken}` } : {}),
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
