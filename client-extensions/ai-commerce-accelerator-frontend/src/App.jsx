import React, {
  useState,
  useEffect,
  useCallback,
  useReducer,
  useRef,
  useMemo,
} from 'react';
import ClayLayout from '@clayui/layout';
import ClayButton from '@clayui/button';
import ClayLabel from '@clayui/label';
import ClayIcon from '@clayui/icon';
import { AppProvider, useApp, useApi } from './context/AppContext';
import { progressReducer, initialProgress } from './state/progressReducer';

import useActivityLog from './hooks/useActivityLog';
import useRealtimeWebSocket from './hooks/useRealtimeWebSocket';
import useValidation from './hooks/useValidation';
import useCommerceData from './hooks/useCommerceData';
import useGeneration from './hooks/useGeneration';

import notifyUser from './utils/notifications';

import { flattenErrorsMap } from './utils/validation';

import ConfigurationPanel from './components/config/ConfigurationPanel';
import DataGeneratorForm from './components/data-generator/DataGeneratorForm';
import HelpSection from './components/dashboard/HelpSection';
import Dashboard from './components/dashboard/Dashboard';
import ActivityLog from './components/dashboard/ActivityLog';
import SessionSelectorModal from './components/ui/SessionSelectorModal';
import LogConsole from './components/data-generator/LogConsole';

import useAppConfigIO from './hooks/useAppConfigIO';
import useLogExport from './hooks/useLogExport';
import useDatasetIO from './hooks/useDatasetIO';

import {
  AI_CONFIG,
  BATCH_SIZES,
  CONFIG_GENERATION_LIMITS,
} from './utils/microservicePaths';

const initialGenerationConfig = {
  sessionName: '',
  brandName: '',
  seedPack: '',
  productCount: 10,
  accountCount: 10,
  orderCount: 50,
  orderDistribution: { open: 10, processing: 10, shipped: 20, completed: 60 },
  categories: [],
  generatePriceLists: true,
  generateBulkPricing: true,
  generateTierPricing: true,
  generatePromotions: true,
  generateSpecifications: true,
  generateSkuVariants: true,
  imageMode: 'placeholder',
  imageRatio: 100,
  imageStyle: 'photographic',
  pdfMode: 'placeholder',
  pdfRatio: 100,
  pdfContentType: 'product_info',
  createWarehouses: true,
  reuseExistingWarehouses: true,
  warehouseCount: 5,
  inventoryMin: 0,
  inventoryMax: 1000,
  inventoryAssignmentRatio: 100,
  enableBackorders: true,
  backorderAssignmentRatio: 50,
  demoMode: true,
};

function AppUI() {
  const { config, setConfig } = useApp();
  const api = useApi();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [generationConfig, setGenerationConfig] = useState(
    initialGenerationConfig
  );

  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(true);
  const [aiKeyAvailable, setAiKeyAvailable] = useState(false);
  const [aiMediaKeyAvailable, setAiMediaKeyAvailable] = useState(false);
  const [batchErrors, setBatchErrors] = useState([]);
  const [showSessionSelector, setShowSessionSelector] = useState(false);
  const [batchSizes, setBatchSizes] = useState([1, 10, 25, 50]); // Default values

  const [generationLimits, setGenerationLimits] = useState({
    maxProducts: 10000,
    maxAccounts: 5000,
    maxOrders: 50000,
  });

  const { connectionErrors, setConnectionErrors, generationErrors } =
    useValidation(
      config,
      generationConfig,
      connectionEstablished,
      generationLimits
    );

  const [availableCategories, setAvailableCategories] = useState([]);
  const [aiConfig, setAiConfig] = useState(null);

  const {
    logs,
    addLog: baseAddLog,
    clearLogs,
  } = useActivityLog({
    level: config?.wsLoggingLevel || 'info',
    maxEntries: 500,
    dedupeWindowMs: 1000,
    mirrorToConsole: true,
    storageKey: 'aica_activity_log',
  });

  const addLog = useCallback(
    (message, type = 'info', source) => {
      baseAddLog(message, type, source);
      if (type === 'error' || type === 'danger') {
        notifyUser(message, 'danger');
      } else if (type === 'warning' || type === 'warn') {
        notifyUser(message, 'warning');
      }
    },
    [baseAddLog]
  );

  const [progress, dispatch] = useReducer(
    progressReducer,
    initialProgress,
    (initial) => {
      const savedState = localStorage.getItem('aica_progress_state');
      if (savedState) {
        try {
          return { ...initial, ...JSON.parse(savedState) };
        } catch (e) {
          console.error('Failed to parse saved progress state', e);
        }
      }
      return initial;
    }
  );

  useEffect(() => {
    localStorage.setItem('aica_progress_state', JSON.stringify(progress));
  }, [progress]);

  const setProgress = useCallback((arg) => {
    if (typeof arg === 'function') {
      dispatch({ type: 'APPLY_UPDATER', updater: arg });
    } else if (arg && arg.type) {
      dispatch(arg);
    }
  }, []);

  const [logEntries, setLogEntries] = useState([]);

  useEffect(() => {
    const handleWSEvent = (event) => {
      const data = event.detail;
      if (data && data.type === 'LOG_ENTRY' && data.logEntry) {
        setLogEntries((prev) => {
          const next = [...prev, data.logEntry];
          if (next.length > 500) {
            return next.slice(next.length - 500);
          }
          return next;
        });
      }
    };
    window.addEventListener('liferay-ai-ws-event', handleWSEvent);
    return () => {
      window.removeEventListener('liferay-ai-ws-event', handleWSEvent);
    };
  }, []);

  const onBatchErrorDetails = useCallback((details) => {
    setBatchErrors((prev) => [...prev, details]);
  }, []);

  const { ping, wsConnected, reconnect } = useRealtimeWebSocket({
    enabled: connectionEstablished,
    microserviceUrl: config.microserviceUrl,
    loggingLevel: config?.wsLoggingLevel ?? 'off',
    onLog: addLog,
    onProgress: setProgress,
    activeSessionId: progress.activeSessionId,
    onBatchErrorDetails,
  });

  const {
    catalogs,
    channels,
    languages,
    currencies,
    categories: fetchCategories,
    selectChannel,
    selectCatalog,
    testConnection,
    loadRootLists,
    isCreatingChannel,
    createDefaultChannel,
    handleDeleteAllCommerceData,
    handleDeleteSelectedCommerceData,
  } = useCommerceData({
    addLog,
    setConnectionEstablished,
    setAiKeyAvailable,
    setAiMediaKeyAvailable,
    setConnectionErrors,
    setProgress,
    ping,
  });

  const {
    isSubmitting,
    generateData,
    cancelWorkflow: baseCancelWorkflow,
  } = useGeneration({
    addLog,
    buildPayload,
    api,
    config,
    dispatch,
    forceDemoMode:
      connectionEstablished && (!aiKeyAvailable || !aiMediaKeyAvailable),
    generationConfig,
    mountedRef,
    progress,
    setProgress,
    connectionEstablished,
  });

  useEffect(() => {
    if (connectionEstablished) {
      localStorage.setItem('aica_has_connected_once', 'true');
    }
  }, [connectionEstablished]);

  useEffect(() => {
    const hasConnectedOnce =
      localStorage.getItem('aica_has_connected_once') === 'true';

    if (hasConnectedOnce && !connectionEstablished) {
      const checkConn = async () => {
        setIsCheckingConnection(true);
        testConnection({ silent: true })
          .catch(() => {})
          .finally(() => {
            setIsCheckingConnection(false);
          });
      };
      checkConn();
    } else {
      setIsCheckingConnection(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetStatus = useCallback(() => {
    dispatch({ type: 'RESET' });
    notifyUser('Workflow status reset.');
  }, []);

  const handleResetAll = useCallback(() => {
    dispatch({ type: 'RESET' });
    clearLogs();
    notifyUser('Dashboard status and logs reset.');
  }, [clearLogs]);

  const cancelWorkflow = useCallback(async () => {
    await baseCancelWorkflow();
  }, [baseCancelWorkflow]);

  const isGenerating = isSubmitting || !!progress.activeSessionId;

  const commerceConfigured =
    !!config.catalogId &&
    !!config.channelId &&
    !!config.currencyCode &&
    Array.isArray(config.selectedLanguages) &&
    config.selectedLanguages.length > 0;

  const firstConnectionError = flattenErrorsMap(connectionErrors)[0];

  const isFormLocked = isGenerating || !connectionEstablished;
  const isSubmitDisabled =
    isFormLocked ||
    !commerceConfigured ||
    flattenErrorsMap(generationErrors).length > 0;

  const disabledReason = useMemo(() => {
    if (!connectionEstablished) {
      if (firstConnectionError) return firstConnectionError;
      return 'Check the system connectivity to enable generation.';
    }

    if (!commerceConfigured) {
      return 'Select a Catalog, Channel, and at least one Language.';
    }

    const genErrors = flattenErrorsMap(generationErrors);
    if (genErrors.length > 0) {
      return genErrors[0];
    }

    return null;
  }, [
    connectionEstablished,
    firstConnectionError,
    commerceConfigured,
    generationErrors,
  ]);

  const { exportConfiguration, importConfiguration } = useAppConfigIO({
    config,
    setConfig,
    generationConfig,
    setGenerationConfig,
    connectionEstablished,
    setConnectionEstablished,
    setOpenAiKeyAvailable: setAiKeyAvailable,
    setAiMediaKeyAvailable,
    availableCategories,
    mountedRef,
    selectChannel,
  });

  const { exportLogs } = useLogExport({
    logs,
    progress,
    config,
    generationConfig,
  });

  const { exportSession, importDataset } = useDatasetIO({
    api,
    addLog,
    isGenerating,
  });

  const handleSettingsReset = () => {
    setGenerationConfig(initialGenerationConfig);
    notifyUser('Generator settings restored to defaults.');
  };

  useEffect(() => {
    if (!connectionEstablished) return;
    (async () => {
      try {
        const fetched = await fetchCategories();
        if (mountedRef.current) {
          setAvailableCategories(fetched);

          // Auto-select first category if none are selected
          if (fetched.length > 0) {
            setGenerationConfig((prev) => {
              if (!prev.categories || prev.categories.length === 0) {
                const firstKey =
                  typeof fetched[0] === 'string' ? fetched[0] : fetched[0].key;
                return {
                  ...prev,
                  categories: [firstKey],
                };
              }
              return prev;
            });
          }
        }
      } catch {
        // silently fail
      }

      try {
        const fullAiConfig = await api.get(AI_CONFIG);
        if (mountedRef.current && fullAiConfig?.success) {
          setAiConfig(fullAiConfig.config);
        }
      } catch {
        // Silently fail
      }

      try {
        const res = await api.get(BATCH_SIZES);
        if (mountedRef.current && res?.success) {
          setBatchSizes(res.batchSizes || [1, 10, 25, 50]);
        }
      } catch {
        // Silently fail
      }

      try {
        const res = await api.get(CONFIG_GENERATION_LIMITS);
        if (mountedRef.current && res?.success) {
          setGenerationLimits(res.limits);

          // Update initial configuration with default distribution if not already set
          if (res.limits.defaultOrderDistribution) {
            setGenerationConfig((prev) => {
              if (prev.orderCount === 50) {
                // If it's the initial default
                return {
                  ...prev,
                  orderDistribution: res.limits.defaultOrderDistribution,
                };
              }
              return prev;
            });
          }
        }
      } catch {
        // Silently fail
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionEstablished, api]);

  const clearBatchErrors = useCallback(() => {
    setBatchErrors([]);
  }, []);

  const appTopRef = useRef(null);

  function buildPayload() {
    return {
      ...config,
      ...generationConfig,
      correlationId: config.correlationId,
    };
  }

  return (
    <div className="ai-commerce-dashboard" ref={appTopRef}>
      {/* HEADER / NAVIGATION BAR */}
      <div
        className="dashboard-nav-container py-3 border-bottom bg-white sticky-top"
        style={{
          top: 'calc(var(--control-menu-height, 0px))',
          zIndex: 10,
        }}
      >
        <div className="container-fluid px-4">
          <nav className="navbar navbar-expand-md navbar-light p-0">
            <div className="navbar-brand d-flex align-items-center">
              <div
                className="brand-icon-wrapper mr-3 bg-primary text-white d-flex align-items-center justify-content-center"
                style={{ width: '40px', height: '40px', borderRadius: '10px' }}
              >
                <ClayIcon symbol="magic" />
              </div>
              <div className="d-flex flex-column">
                <span className="h5 mb-0 font-weight-bold d-block">
                  {config.title || 'Liferay AI Commerce Accelerator'}
                </span>
                <div className="d-flex align-items-center">
                  <button
                    className="btn btn-unstyled p-0"
                    onClick={() => testConnection()}
                    disabled={isGenerating}
                    title="Click to re-initialize the accelerator connection"
                  >
                    <ClayLabel
                      className="mb-0"
                      displayType={
                        connectionEstablished ? 'success' : 'warning'
                      }
                      style={{
                        cursor: isGenerating ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {connectionEstablished
                        ? 'Connected to Liferay'
                        : 'Disconnected'}
                    </ClayLabel>
                  </button>
                  <small
                    className="text-muted ml-2"
                    style={{ fontSize: '0.7rem' }}
                  >
                    (Click to re-initialise)
                  </small>
                </div>
              </div>
            </div>

            <ul className="navbar-nav ml-auto">
              <li className="nav-item mr-3 d-flex align-items-center">
                <span
                  className="text-secondary small mr-2 font-weight-bold"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
                >
                  Params:
                </span>
                <div className="btn-group">
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={() =>
                      document.getElementById('configImport').click()
                    }
                    disabled={isGenerating}
                    title="Import generation parameters from JSON"
                  >
                    Import
                  </ClayButton>
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={exportConfiguration}
                    disabled={isGenerating}
                    title="Export current generation parameters"
                  >
                    Export
                  </ClayButton>
                </div>
              </li>

              <li className="nav-item mr-3 d-flex align-items-center">
                <span
                  className="text-secondary small mr-2 font-weight-bold"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}
                >
                  Dataset:
                </span>
                <div className="btn-group">
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={() =>
                      document.getElementById('datasetImport').click()
                    }
                    disabled={isGenerating}
                    title="Import mock dataset from JSON"
                  >
                    Import
                  </ClayButton>
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={() => setShowSessionSelector(true)}
                    disabled={isGenerating}
                    title="Choose a successful generation run to export"
                  >
                    Export
                  </ClayButton>
                </div>
              </li>

              <li className="nav-item d-flex align-items-center">
                <ClayButton
                  displayType="secondary"
                  size="sm"
                  onClick={exportLogs}
                  title="Export system status and activity logs for sharing"
                >
                  <ClayIcon symbol="info-circle" className="mr-1" />
                  Export Logs
                </ClayButton>
              </li>
            </ul>

            {/* Hidden File Inputs */}
            <input
              type="file"
              id="configImport"
              accept=".json"
              onChange={importConfiguration}
              style={{ display: 'none' }}
              disabled={isGenerating}
            />
            <input
              type="file"
              id="datasetImport"
              accept=".json"
              onChange={importDataset}
              style={{ display: 'none' }}
              disabled={isGenerating}
            />

            <SessionSelectorModal
              visible={showSessionSelector}
              onClose={() => setShowSessionSelector(false)}
              onSelect={exportSession}
              api={api}
            />
          </nav>
        </div>
      </div>

      {/* MAIN CONTENT AREA - Responsive Column Layout */}
      <div className="container-fluid mt-4">
        {!isCheckingConnection && !connectionEstablished && (
          <div className="alert alert-warning shadow-sm mb-4" role="alert">
            <div className="container-fluid px-4 py-2">
              <div className="d-flex align-items-start">
                <div className="alert-autofit-row w-100">
                  <div className="autofit-col me-3">
                    <div
                      className="alert-indicator"
                      style={{ fontSize: '1.5rem' }}
                    >
                      <ClayIcon symbol="warning-full" />
                    </div>
                  </div>
                  <div className="autofit-col autofit-col-expand">
                    <h4 className="alert-heading font-weight-bold mb-2">
                      Microservice Offline
                    </h4>
                    <p className="mb-0">
                      Unable to connect to the AI Commerce Accelerator
                      Microservice. The dashboard cannot load active commerce
                      catalogs or generate data.
                    </p>
                    <div className="mt-3 small text-secondary">
                      Please check the following parameters:
                      <ul className="mb-0 mt-2 pl-3">
                        <li className="mb-1">
                          <strong>Backend Status</strong>: Confirm the
                          microservice server is up and running (default port is{' '}
                          <code>3001</code>).
                        </li>
                        <li className="mb-1">
                          <strong>Server Reachability</strong>: Ensure this
                          client machine can reach your server IP or VPS domain
                          (verify network firewalls).
                        </li>
                        <li>
                          <strong>Widget Property</strong>: Check the{' '}
                          <code>microservice-url</code> attribute configured in
                          your Liferay custom element widget matches your
                          server.
                        </li>
                      </ul>
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        className="btn btn-warning btn-sm px-4"
                        onClick={() => testConnection()}
                        disabled={isGenerating}
                      >
                        Retry Connection
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <ClayLayout.Row>
          {/* COLUMN 1: CONFIGURATION & HELP (Top on Mobile/Tablet) */}
          <ClayLayout.Col lg={3} md={4} sm={12}>
            <div className="sheet sheet-lg mb-4">
              <HelpSection />

              <div className="row">
                <div className="col-12">
                  <ConfigurationPanel
                    disabled={isGenerating || isCreatingChannel}
                    onTestConnection={testConnection}
                    onConnectionStatusChange={setConnectionEstablished}
                    connected={connectionEstablished}
                    catalogs={catalogs}
                    channels={channels}
                    languages={languages}
                    currencies={currencies}
                    onSelectChannel={selectChannel}
                    onSelectCatalog={selectCatalog}
                    onRefreshLists={loadRootLists}
                    isCreatingChannel={isCreatingChannel}
                    onCreateDefaultChannel={createDefaultChannel}
                    connectionErrors={connectionErrors}
                    onErrorsChange={setConnectionErrors}
                    onDeleteAllCommerceData={async () => {
                      await handleDeleteAllCommerceData();
                    }}
                    onDeleteSelectedCommerceData={async (scope) => {
                      await handleDeleteSelectedCommerceData(scope);
                    }}
                    batchSizes={batchSizes}
                  />
                </div>
              </div>
            </div>
          </ClayLayout.Col>

          {/* COLUMN 2: DATA GENERATION STRATEGY (Center) */}
          <ClayLayout.Col lg={6} md={8} sm={12}>
            <div className="sheet sheet-lg mb-4">
              <DataGeneratorForm
                generationConfig={generationConfig}
                setGenerationConfig={setGenerationConfig}
                onGenerate={generateData}
                onResetSettings={handleSettingsReset}
                onCancel={cancelWorkflow}
                disabled={isFormLocked}
                isSubmitDisabled={isSubmitDisabled}
                disabledReason={disabledReason}
                isGenerating={isGenerating}
                progress={progress}
                aiKeyAvailable={aiKeyAvailable}
                aiMediaKeyAvailable={aiMediaKeyAvailable}
                validationErrors={generationErrors}
                scrollTargetRef={appTopRef}
                availableCategories={availableCategories}
                liferayConnected={connectionEstablished}
                generationLimits={generationLimits}
              />

              <div className="divider my-4"></div>

              {/* Live Console - Moved from sidebar to center bottom */}
              <div className="live-console-container">
                <ActivityLog
                  onClearLogs={clearLogs}
                  logs={logs}
                  isGenerating={isGenerating}
                />

                <LogConsole
                  logEntries={logEntries}
                  onClear={() => setLogEntries([])}
                />
              </div>
            </div>
          </ClayLayout.Col>

          {/* COLUMN 3: OBSERVABILITY (Bottom on Mobile, Relative on Desktop) */}
          <ClayLayout.Col lg={3} md={12} sm={12}>
            <div className="sheet sheet-lg mb-4">
              <Dashboard
                progress={progress}
                isGenerating={isGenerating}
                generationConfig={generationConfig}
                wsStatus={
                  !connectionEstablished
                    ? 'unknown'
                    : wsConnected
                      ? 'connected'
                      : 'closed'
                }
                batchErrors={batchErrors}
                clearBatchErrors={clearBatchErrors}
                onReconnect={reconnect}
                connected={connectionEstablished}
                aiKeyAvailable={aiKeyAvailable}
                aiMediaKeyAvailable={aiMediaKeyAvailable}
                aiConfig={aiConfig}
                onResetStatus={handleResetStatus}
                onResetAll={handleResetAll}
              />
            </div>
          </ClayLayout.Col>
        </ClayLayout.Row>
      </div>
    </div>
  );
}

export default function AppRoot(props) {
  return (
    <AppProvider initialConfig={props.config}>
      <AppUI />
    </AppProvider>
  );
}
