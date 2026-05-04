import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useMemo,
  useContext,
  useRef,
} from 'react';
import { ClayIconSpriteContext } from '@clayui/icon';
import { normalizeConfig } from '../config/normalize';
import { DEFAULTS } from '../config/defaults';
import { createApiClient } from '../services/apiClient';
import { GET_CURRENCIES, GET_LANGUAGES } from '../utils/microservicePaths';

const AppContext = createContext(null);

export function AppProvider({
  className = 'app-root',
  initialConfig,
  children,
}) {
  const rootRef = useRef(null);
  const cacheStore = useRef(new Map());
  const inflight = useRef(new Map());

  const [config, setConfig] = useState(() => {
    const filteredInitial = Object.entries(initialConfig || {}).reduce(
      (acc, [key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );
    return normalizeConfig({ ...DEFAULTS, ...filteredInitial });
  });
  const [correlationId, setCorrelationId] = useState(
    () => sessionStorage.getItem('correlationId') || null
  );

  const getCorrelationId = useCallback(
    () => correlationId || sessionStorage.getItem('correlationId') || null,
    [correlationId]
  );

  const updateConfig = useCallback((patch) => {
    setConfig((prev) => {
      const raw = typeof patch === 'function' ? patch(prev) : patch || {};
      const PROTECTED_KEYS = new Set(['siteGroupId', 'channelId', 'catalogId']);
      const safe = { ...raw };
      for (const k of PROTECTED_KEYS) {
        if (!(k in raw)) delete safe[k];
      }
      const merged = { ...prev, ...safe };
      return normalizeConfig(merged);
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialConfig) updateConfig(initialConfig);
  }, [initialConfig, updateConfig]);

  useEffect(() => {
    for (const k of cacheStore.current.keys()) {
      if (k.includes(`:${config.liferayUrl}`)) cacheStore.current.delete(k);
    }
  }, [config.liferayUrl]);

  function fetchWithCache(
    key,
    fetcher,
    { ttlMs = 5 * 60_000, force = false } = {}
  ) {
    const now = Date.now();

    if (!force) {
      const cached = cacheStore.current.get(key);
      if (cached && cached.expiresAt > now) {
        return Promise.resolve(cached.value);
      }
    }

    const existing = inflight.current.get(key);
    if (existing) return existing;

    const p = Promise.resolve()
      .then(fetcher)
      .then((value) => {
        cacheStore.current.set(key, { value, expiresAt: now + ttlMs });
        inflight.current.delete(key);
        return value;
      })
      .catch((err) => {
        inflight.current.delete(key);
        throw err;
      });

    inflight.current.set(key, p);
    return p;
  }

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.microserviceUrl,
        getCorrelationId,
        onCorrelationIdUpdate: (cid) => {
          setCorrelationId(cid);
          sessionStorage.setItem('correlationId', cid);
        },
      }),
    [config.microserviceUrl, getCorrelationId]
  );

  const getCurrencies = useCallback(
    (payload, { force = false } = {}) => {
      const key = `currencies:${config.microserviceUrl || ''}:${
        config.liferayUrl || ''
      }`;
      return fetchWithCache(key, () => api.post(GET_CURRENCIES, payload), {
        ttlMs: 60 * 60_000,
        force,
      });
    },
    [api, config.microserviceUrl, config.liferayUrl]
  );

  const getLanguages = useCallback(
    (payload, { force = false } = {}) => {
      if (!payload?.siteGroupId) return Promise.resolve([]);
      const key = `languages:${config.microserviceUrl || ''}:${
        config.liferayUrl || ''
      }:${payload.siteGroupId}`;
      return fetchWithCache(key, () => api.post(GET_LANGUAGES, payload), {
        ttlMs: 30 * 60_000,
        force,
      }).catch((err) => {
        console.warn('Failed to fetch languages, returning empty array:', err);
        return [];
      });
    },
    [api, config.microserviceUrl, config.liferayUrl]
  );

  const value = useMemo(
    () => ({
      config,
      setConfig: updateConfig,
      api,
      rootRef,
      getRoot: () => rootRef.current,
      getCorrelationId,
      getCurrencies,
      getLanguages,
    }),
    [config, api, updateConfig, getCorrelationId, getCurrencies, getLanguages]
  );

  return (
    <AppContext.Provider value={value}>
      <ClayIconSpriteContext.Provider value={config.spritemap}>
        <div ref={rootRef} className={className} id="app-root">
          {children}
        </div>
      </ClayIconSpriteContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}
export const useApi = () => useApp().api;
