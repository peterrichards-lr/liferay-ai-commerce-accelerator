export function createApiClient({ baseUrl, withCredentials = true }) {
  const base = (baseUrl || '').replace(/\/+$/, '');

  async function request(path, { method = 'GET', body, headers, signal } = {}) {
    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const res = await fetch(url, {
      method,
      credentials: withCredentials ? 'include' : 'same-origin',
      headers: {
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(headers || {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  return {
    get: (p, opts) => request(p, { ...opts, method: 'GET' }),
    post: (p, body, opts) => request(p, { ...opts, method: 'POST', body }),
    put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
    del: (p, opts) => request(p, { ...opts, method: 'DELETE' })
  };
}
