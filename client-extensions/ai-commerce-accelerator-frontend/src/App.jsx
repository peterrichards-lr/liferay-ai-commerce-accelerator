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
import { AppProvider, useApp, useApi } from './context/AppContext';
import { progressReducer, initialProgress } from './state/progressReducer';

import useActivityLog from './hooks/useActivityLog';
import useRealtimeWebSocket from './hooks/useRealtimeWebSocket';
import useValidation from './hooks/useValidation';
import useCommerceData from './hooks/useCommerceData';
import useGeneration from './hooks/useGeneration';

import { computeTotalsFromConfig } from './state/progressSelectors';

import notifyUser from './utils/notifications';

import { flattenErrorsMap } from './utils/validation';

import { buildFilename, exportJsonFile } from './utils/fileHelper';

import ConfigurationPanel from './components/config/ConfigurationPanel';
import DataGeneratorForm from './components/data-generator/DataGeneratorForm';
import HelpSection from './components/dashboard/HelpSection';
import Dashboard from './components/dashboard/Dashboard';

import useAppConfigIO from './hooks/useAppConfigIO';

import {
  EXPORT_COMMERCE_DATA,
  IMPORT_COMMERCE_DATA,
  AI_MODEL_OPTIONS,
  AI_CONFIG,
  BATCH_SIZES,
} from './utils/microservicePaths';

const initialGenerationConfig = {
  productCount: 10,
  accountCount: 10,
  orderCount: 50,
  categories: [],
  generatePriceLists: true,
  generateBulkPricing: true,
  generateTierPricing: true,
  imageMode: 'placeholder',
  imageWidth: 1024,
  imageHeight: 1024,
  imageQuality: 'standard',
  imageStyle: 'photographic',
  imageRatio: 100,
  customImageFile: null,
  generateSpecifications: true,
  generateSkuVariants: true,
  pdfMode: 'placeholder',
  pdfRatio: 100,
  pdfContentType: 'product_info',
  demoMode: true,
  inventoryMin: 0,
  inventoryMax: 1000,
  inventoryAssignmentRatio: 100,
  enableBackorders: true,
  backorderAssignmentRatio: 50,
  createWarehouses: true,
  reuseExistingWarehouses: true,
  warehouseCount: 5,
  customPDFFile: null,
};

export function AppUI() {
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const appTopRef = useRef(null);

  const { config, setConfig } = useApp();
  const api = useApi();

  const [generationConfig, setGenerationConfig] = useState(
    initialGenerationConfig
  );

  const {
    connectionErrors,
    setConnectionErrors,
    commerceErrors,
    generationErrors,
  } = useValidation(config, generationConfig);

  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [aiKeyAvailable, setAiKeyAvailable] = useState(false);
  const [generationCompleted, setGenerationCompleted] = useState(false);
  const [batchErrors, setBatchErrors] = useState([]);
  const [batchSizes, setBatchSizes] = useState([1, 10, 25, 50]); // Default values
  const [aiModelOptions, setAiModelOptions] = useState([
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
  ]);

  const [availableCategories, setAvailableCategories] = useState([]);
  const [aiConfig, setAiConfig] = useState(null);

  const initialLoggingConfig = {
    level: config?.wsLoggingLevel || 'info',
    maxEntries: 500,
    dedupeWindowMs: 1000,
    mirrorToConsole: true,
    storageKey: 'activityLog:v1',
  };

  const { logs, addLog, clearLogs } = useActivityLog(initialLoggingConfig);

  const [progress, dispatch] = useReducer(progressReducer, initialProgress);

  const setProgress = useCallback((arg) => {
    if (typeof arg === 'function') {
      dispatch({ type: 'APPLY_UPDATER', updater: arg });
    } else if (arg && arg.type) {
      dispatch(arg);
    } else {
      dispatch({ type: 'MERGE', payload: arg });
    }
  }, []);

  const onBatchErrorDetails = useCallback((errorDetails) => {
    setBatchErrors((prevErrors) => {
      const existingErrorIndex = prevErrors.findIndex(
        (e) => e.batchId === errorDetails.batchId
      );

      if (existingErrorIndex >= 0) {
        const nextErrors = [...prevErrors];
        nextErrors[existingErrorIndex] = errorDetails;
        return nextErrors;
      }

      return [...prevErrors, errorDetails];
    });
  }, []);

  const { ping, wsConnected, reconnect } = useRealtimeWebSocket({
    enabled: connectionEstablished && !!config.microserviceUrl,
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
    categories,
    buildPayload,
    selectChannel,
    selectCatalog,
    testConnection,
    handleDeleteAllCommerceData,
    handleDeleteSelectedCommerceData,
  } = useCommerceData({
    addLog,
    setConnectionEstablished,
    setAiKeyAvailable,
    setConnectionErrors,
    ping,
  });

  const { isSubmitting, generateData } = useGeneration({
    addLog,
    buildPayload,
    api,
    config,
    dispatch,
    forceDemoMode: connectionEstablished && !aiKeyAvailable,
    generationConfig,
    mountedRef,
    progress,
    setProgress,
    setGenerationCompleted,
    connectionEstablished,
  });

  const isGenerating = isSubmitting || !!progress.activeSessionId;

  const commerceConfigured =
    !!config.catalogId &&
    !!config.channelId &&
    !!config.currencyCode &&
    Array.isArray(config.selectedLanguages) &&
    config.selectedLanguages.length > 0;

  const firstConnectionError = flattenErrorsMap(connectionErrors)[0];
  const firstCommerceError = flattenErrorsMap(commerceErrors)[0];
  const firstGenerationError = flattenErrorsMap(generationErrors)[0];

  const isFormLocked = isGenerating;
  let isSubmitDisabled = isGenerating;
  let disabledReason = '';

  if (firstConnectionError) {
    isSubmitDisabled = true;
    disabledReason = firstConnectionError;
  } else if (!connectionEstablished) {
    isSubmitDisabled = true;
    disabledReason = 'Please test the connection first.';
  } else if (firstCommerceError) {
    isSubmitDisabled = true;
    disabledReason = firstCommerceError;
  } else if (firstGenerationError) {
    isSubmitDisabled = true;
    disabledReason = 'Fix the highlighted issues to continue.';
  } else if (isGenerating) {
    disabledReason = generationConfig.demoMode
      ? 'Generating demo data…'
      : 'Generating data…';
  }

  const { exportConfiguration, importConfiguration } = useAppConfigIO({
    config,
    setConfig,
    generationConfig,
    setGenerationConfig,
    connectionEstablished,
    setConnectionEstablished,
    setAiKeyAvailable,
    availableCategories,
    mountedRef,
    selectChannel,
  });

  const forceDemoMode = connectionEstablished && !aiKeyAvailable;

  useEffect(() => {
    if (forceDemoMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGenerationConfig((prev) => {
        if (
          prev.demoMode &&
          prev.imageMode !== 'generate' &&
          prev.pdfMode !== 'generate'
        ) {
          return prev;
        }
        const next = { ...prev, demoMode: true };
        if (next.imageMode === 'generate') next.imageMode = 'default';
        if (next.pdfMode === 'generate') next.pdfMode = 'default';
        return next;
      });
    }
  }, [forceDemoMode]);

  const wsStatus =
    !connectionEstablished || !config?.microserviceUrl
      ? 'disabled'
      : wsConnected
        ? 'connected'
        : 'connecting';

  useEffect(() => {
    if (isGenerating) return;

    const { products, accounts, orders, images, pdfs, warehouses } =
      computeTotalsFromConfig(generationConfig);

    dispatch({
      type: 'SET_EXPECTED_VALUES',
      values: { images, pdfs },
    });

    dispatch({
      type: 'SET_TOTALS',
      totals: { products, accounts, orders, images, pdfs, warehouses },
    });
  }, [isGenerating, generationConfig]);

  const subtitle = useMemo(
    () =>
      config?.subtitle ||
      'Generate comprehensive Commerce data using AI and Liferay Headless APIs',
    [config?.subtitle]
  );

  const clearBatchErrors = useCallback(() => {
    setBatchErrors([]);
  }, []);

  const handleProgressReset = useCallback(() => {
    clearLogs();
    setBatchErrors([]);

    const { products, accounts, orders, warehouses, images, pdfs } =
      computeTotalsFromConfig(generationConfig);

    setProgress(() => ({
      ...initialProgress,
      products: { ...initialProgress.products, total: products },
      accounts: { ...initialProgress.accounts, total: accounts },
      orders: { ...initialProgress.orders, total: orders },
      images: { ...initialProgress.images, total: images, expected: images },
      pdfs: { ...initialProgress.pdfs, total: pdfs, expected: pdfs },
      warehouses: { ...initialProgress.warehouses, total: warehouses },
    }));

    notifyUser('Progress and activity log have been reset.');
  }, [clearLogs, setProgress, generationConfig]);

  const handleSettingsReset = () => {
    const newConfig = { ...initialGenerationConfig };
    if (availableCategories.length > 0) {
      newConfig.categories = [availableCategories[0].key];
    }
    setGenerationConfig(newConfig);
    notifyUser('Generator settings restored to defaults.');
  };

  const handleExport = useCallback(async () => {
    try {
      const response = await api.get(EXPORT_COMMERCE_DATA);
      const filename = buildFilename('ai-commerce-accelerator-data');
      exportJsonFile(response, filename);
      notifyUser('Commerce data exported successfully');
    } catch (error) {
      notifyUser('Failed to export commerce data', 'danger', error);
    }
  }, [api]);

  const handleImport = useCallback(
    async (event) => {
      const file = event.target.files[0];
      if (!file) return;

      try {
        const formData = new FormData();
        formData.append('importFile', file);
        await api.post(IMPORT_COMMERCE_DATA, formData);
        notifyUser('Commerce data import started');
      } catch (error) {
        notifyUser('Failed to import commerce data', 'danger', error);
      }
    },
    [api]
  );

  useEffect(() => {
    if (!connectionEstablished) return;
    (async () => {
      try {
        const fetched = await categories();
        if (mountedRef.current) {
          setAvailableCategories(fetched);

          // Set first category as default if none selected
          if (fetched.length > 0) {
            setGenerationConfig((prevConfig) => {
              if (
                !prevConfig.categories ||
                prevConfig.categories.length === 0
              ) {
                const firstCategory = fetched[0];
                const firstCategoryKey =
                  typeof firstCategory === 'string'
                    ? firstCategory
                    : firstCategory.key;

                return { ...prevConfig, categories: [firstCategoryKey] };
              }
              return prevConfig;
            });
          }
        }
      } catch (err) {
        addLog('Failed to load categories: ' + err.message, 'error');
      }

      let fetchedBatchSizes = [];
      try {
        fetchedBatchSizes = await api.get(BATCH_SIZES);
        if (mountedRef.current && Array.isArray(fetchedBatchSizes)) {
          setBatchSizes(fetchedBatchSizes);
        }
      } catch (err) {
        addLog('Failed to load batch sizes: ' + err.message, 'error');
      }

      try {
        const fetchedAIModelOptions = await api.get(AI_MODEL_OPTIONS);
        if (mountedRef.current && Array.isArray(fetchedAIModelOptions)) {
          setAiModelOptions(fetchedAIModelOptions);

          setConfig((prevConfig) => {
            const newConfig = { ...prevConfig };
            if (!newConfig.aiModel && fetchedAIModelOptions.length > 0) {
              newConfig.aiModel = fetchedAIModelOptions[0].value;
            }
            if (
              !newConfig.batchSize &&
              Array.isArray(fetchedBatchSizes) &&
              fetchedBatchSizes.length > 0
            ) {
              newConfig.batchSize = fetchedBatchSizes[0];
            }
            return newConfig;
          });
        }
      } catch (err) {
        addLog('Failed to load AI model options: ' + err.message, 'error');
      }

      try {
        const fullAiConfig = await api.get(AI_CONFIG);
        if (mountedRef.current && fullAiConfig?.success) {
          setAiConfig(fullAiConfig.config?.ai);
        }
      } catch (err) {
        // Silently fail
      }
    })();
  }, [connectionEstablished, categories, mountedRef, addLog, api, setConfig]);

  useEffect(() => {
    // Sync logic for errors or side effects
  }, [batchErrors]);

  return (
    <div className="ai-commerce-dashboard">
      {/* GLOBAL MANAGEMENT BAR */}
      <div className="management-bar management-bar-light">
        <div className="container-fluid container-fluid-max-xl">
          <nav className="navbar navbar-expand-md">
            <div className="navbar-brand d-flex align-items-center">
              <h1 className="component-title mb-0 mr-3">
                <i className="fas fa-robot mr-2"></i>
                {config?.title ?? 'Liferay AI Commerce Accelerator'}
              </h1>
              <ClayLabel displayType={connectionEstablished ? "success" : "warning"}>
                {connectionEstablished ? "Connected to Liferay" : "Disconnected"}
              </ClayLabel>
            </div>
            <ul className="navbar-nav ml-auto">
              <li className="nav-item mr-2">
                <div className="btn-group">
                  <input
                    type="file"
                    id="configImport"
                    accept=".json"
                    onChange={importConfiguration}
                    style={{ display: 'none' }}
                    disabled={isGenerating}
                  />
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={() => document.getElementById('configImport').click()}
                    disabled={isGenerating}
                  >
                    Import Config
                  </ClayButton>
                  <ClayButton
                    displayType="secondary"
                    size="sm"
                    onClick={exportConfiguration}
                    disabled={isGenerating}
                  >
                    Export Config
                  </ClayButton>
                </div>
              </li>
            </ul>
          </nav>
        </div>
      </div>

      {/* MAIN CONTENT AREA - Dual Pane Layout */}
      <div className="container-fluid container-fluid-max-xl mt-4">
        <ClayLayout.Row>
          
          {/* LEFT PANE: CONFIGURATION */}
          <ClayLayout.Col size={8}>
            <div className="sheet sheet-lg">
              <HelpSection />
              
              <div className="row mb-4">
                 <div className="col-12">
                   <ConfigurationPanel
                      disabled={isGenerating}
                      generationConfig={generationConfig}
                      onTestConnection={testConnection}
                      onConnectionStatusChange={setConnectionEstablished}
                      connected={connectionEstablished}
                      catalogs={catalogs}
                      channels={channels}
                      languages={languages}
                      currencies={currencies}
                      onSelectChannel={selectChannel}
                      onSelectCatalog={selectCatalog}
                      commerceConfigured={commerceConfigured}
                      onOpenAiKeyStatusChange={setAiKeyAvailable}
                      aiKeyAvailable={aiKeyAvailable}
                      connectionErrors={connectionErrors}
                      commerceErrors={commerceErrors}
                      onErrorsChange={setConnectionErrors}
                      onDeleteAllCommerceData={async () => {
                        setProgress({ type: 'RESET_ALL', totals: {} });
                        await handleDeleteAllCommerceData();
                      }}
                      onDeleteSelectedCommerceData={async (scope) => {
                        setProgress({ type: 'RESET_ALL', totals: {} });
                        await handleDeleteSelectedCommerceData(scope);
                      }}
                      batchSizes={batchSizes}
                      aiModelOptions={aiModelOptions}
                    />
                 </div>
              </div>

              <DataGeneratorForm
                generationConfig={generationConfig}
                setGenerationConfig={setGenerationConfig}
                onGenerate={generateData}
                onResetSettings={handleSettingsReset}
                disabled={isFormLocked}
                isSubmitDisabled={isSubmitDisabled}
                disabledReason={disabledReason}
                isGenerating={isGenerating}
                forceDemoMode={forceDemoMode}
                aiKeyAvailable={aiKeyAvailable}
                validationErrors={generationErrors}
                scrollTargetRef={appTopRef}
                availableCategories={availableCategories}
                generationCompleted={generationCompleted}
                onExport={handleExport}
                onImport={handleImport}
                liferayConnected={connectionEstablished}
              />
            </div>
          </ClayLayout.Col>

          {/* RIGHT PANE: OBSERVABILITY (Sticky) */}
          <ClayLayout.Col size={4} className="sticky-top" style={{ top: '2rem', maxHeight: 'calc(100vh - 4rem)', overflowY: 'auto' }}>
             <Dashboard
                progress={progress}
                logs={logs}
                isGenerating={isGenerating}
                onClearLogs={clearLogs}
                onReset={handleProgressReset}
                generationConfig={generationConfig}
                wsStatus={wsConnected ? 'connected' : 'closed'}
                batchErrors={batchErrors}
                clearBatchErrors={clearBatchErrors}
                onReconnect={reconnect}
                connected={connectionEstablished}
                aiConfig={aiConfig}
              />
          </ClayLayout.Col>
        </ClayLayout.Row>
      </div>
    </div>
  );
}

import { ClayIconSpriteContext } from '@clayui/icon';

const SPRITEMAP_FALLBACK = '/icons.svg';

export default function AppRoot({ config: initialConfig }) {
  const spritemap = useMemo(
    () =>
      initialConfig?.spritemap ||
      globalThis?.Liferay?.Icons?.spritemap ||
      SPRITEMAP_FALLBACK,
    [initialConfig?.spritemap]
  );

  return (
    <AppProvider initialConfig={initialConfig}>
      <ClayIconSpriteContext.Provider value={spritemap}>
        <AppUI />
      </ClayIconSpriteContext.Provider>
    </AppProvider>
  );
}
