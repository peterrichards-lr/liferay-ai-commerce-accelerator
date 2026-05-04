import { CORRELATION_ID_HEADER } from '../utils/sharedConstants';

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

    const res = await fetch(url, {
      method,
      credentials: withCredentials ? 'include' : 'same-origin',
      headers: {
        Accept: 'application/json, */*;q=0.1',
        ...(!isFormData && body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {}),
        ...(cid ? { [CORRELATION_ID_HEADER]: cid } : {}),
      },
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

  return {
    get: (p, opts) => request(p, { ...opts, method: 'GET' }),
    post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
    put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
    del: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
  };
}
