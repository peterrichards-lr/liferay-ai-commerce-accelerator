import * as React from 'react';
import { normalizeConfig } from '../config/normalize.js';
import { createApiClient } from '../services/apiClient.js';

const AppContext = React.createContext(null);

export function AppProvider({ initialConfig, children }) {
  const [config, setConfig] = React.useState(() =>
    normalizeConfig(initialConfig)
  );

  const updateConfig = React.useCallback((patch) => {
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

  React.useEffect(() => {
    if (initialConfig) updateConfig(initialConfig);
  }, [initialConfig, updateConfig]);

  const api = React.useMemo(
    () => createApiClient({ baseUrl: config.microserviceUrl }),
    [config.microserviceUrl]
  );

  const value = React.useMemo(
    () => ({ config, setConfig: updateConfig, api }),
    [config, api, updateConfig]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = React.useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within <AppProvider>');
  return ctx;
}
export const useApi = () => useApp().api;
