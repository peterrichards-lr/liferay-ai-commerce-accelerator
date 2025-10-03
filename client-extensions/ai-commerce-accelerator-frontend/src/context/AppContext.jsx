import React, {
  useState,
  useEffect,
  useCallback,
  createContext,
  useMemo,
  useContext,
  useRef,
} from 'react';
import { normalizeConfig } from '../config/normalize.js';
import { createApiClient } from '../services/apiClient.js';

const AppContext = createContext(null);

export function AppProvider({
  className = 'app-root',
  initialConfig,
  children,
}) {
  const rootRef = useRef(null);
  const [correlationId, setCorrelationId] = useState();
  const [config, setConfig] = useState(() => normalizeConfig(initialConfig));
  const getCorrelationId = useCallback(() => correlationId, [correlationId]);

  const updateConfig = useCallback((patch) => {
    setConfig((prev) => {
      const raw = typeof patch === 'function' ? patch(prev) : patch || {};
      const PROTECTED_KEYS = new Set(['siteGroupId', 'channelId', 'catalogId']);
      const safe = { ...raw };
      for (const k of PROTECTED_KEYS) {
        if (safe[k] == null) delete safe[k];
      }
      const merged = { ...prev, ...safe };
      return normalizeConfig(merged);
    });
  }, []);

  useEffect(() => {
    if (initialConfig) updateConfig(initialConfig);
  }, [initialConfig, updateConfig]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: config.microserviceUrl,
        getCorrelationId,
        setCorrelationId,
      }),
    [config.microserviceUrl, getCorrelationId]
  );

  const value = useMemo(
    () => ({
      config,
      setConfig: updateConfig,
      api,
      rootRef,
      getRoot: () => rootRef.current,
      getCorrelationId,
    }),
    [config, api, updateConfig]
  );

  return (
    <AppContext.Provider value={value}>
      <div ref={rootRef} className={className} id="app-root">
        {children}
      </div>
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}
export const useApi = () => useApp().api;
