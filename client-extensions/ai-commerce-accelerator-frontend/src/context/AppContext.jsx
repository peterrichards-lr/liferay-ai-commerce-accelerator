import * as React from 'react';
import { normalizeConfig } from '../config/normalize.js';
import { createApiClient } from '../services/apiClient.js';

const AppContext = React.createContext(null);

export function AppProvider({ initialConfig, children }) {
  const [config, setConfig] = React.useState(() =>
    normalizeConfig(initialConfig)
  );

  React.useEffect(() => {
    setConfig((prev) => normalizeConfig({ ...prev, ...(initialConfig || {}) }));
  }, [initialConfig]);

  const api = React.useMemo(
    () => createApiClient({ baseUrl: config.microserviceUrl }),
    [config.microserviceUrl]
  );

  const updateConfig = React.useCallback((patch) => {
    setConfig((prev) => {
      const next =
        typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      return normalizeConfig(next);
    });
  }, []);

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
