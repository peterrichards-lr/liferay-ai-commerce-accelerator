import React, {
  useState,
  useEffect,
  useCallback,
  useReducer,
  useRef,
  useMemo,
} from 'react';
import { AppProvider, useApp, useApi } from './context/AppContext';
import { progressReducer, initialProgress } from './state/progressReducer';

import useActivityLog from './hooks/useActivityLog';
import useRealtimeWebSocket from './hooks/useRealtimeWebSocket';
import useValidation from './hooks/useValidation';
import useCommerceData from './hooks/useCommerceData';
import useGeneration from './hooks/useGeneration';

import {
  computeTotalsFromConfig,
  expectedImageTotal,
  expectedPdfTotal,
} from './state/progressSelectors';

import notifyUser from './utils/notifications';

import { flattenErrorsMap } from './utils/validation';

import { buildFilename, exportJsonFile } from './utils/fileHelper';

import ConfigurationPanel from './components/config/ConfigurationPanel';
import DataGeneratorForm from './components/data-generator/DataGeneratorForm';
import Dashboard from './components/dashboard/Dashboard';

import {
  EXPORT_COMMERCE_DATA,
  IMPORT_COMMERCE_DATA,
  AI_MODEL_OPTIONS,
  BATCH_SIZES,
} from './utils/microservicePaths';

const toInt = (v) => (v == null || v === '' ? undefined : parseInt(v, 10));
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

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
  const [openAiKeyAvailable, setOpenAiKeyAvailable] = useState(false);
  const [generationCompleted, setGenerationCompleted] = useState(false);
  const [batchErrors, setBatchErrors] = useState([]);
  const [batchSizes, setBatchSizes] = useState([1, 10, 25, 50]); // Default values
  const [aiModelOptions, setAiModelOptions] = useState([
    { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
    { label: 'GPT-4o', value: 'gpt-4o' },
    { label: 'GPT-4.1 Mini', value: 'gpt-4.1-mini' },
  ]);

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

  const { wsRef, ping, wsConnected } = useRealtimeWebSocket({
    enabled: connectionEstablished && !!config.microserviceUrl,
    microserviceUrl: config.microserviceUrl,
    loggingLevel: config?.wsLoggingLevel ?? 'off',
    onLog: addLog,
    onProgress: setProgress,
    onBatchErrorDetails: (errorDetails) => {
      console.log('Received BATCH_ERROR_DETAILS:', errorDetails);
      setBatchErrors((prevErrors) => {
        const existingErrorIndex = prevErrors.findIndex(
          (e) => e.batchId === errorDetails.batchId
        );

        if (existingErrorIndex > -1) {
          const newErrors = [...prevErrors];
          newErrors[existingErrorIndex] = {
            ...newErrors[existingErrorIndex],
            ...errorDetails,
          };
          return newErrors;
        }

        return [...prevErrors, errorDetails];
      });
    },
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
    setOpenAiKeyAvailable,
    setConnectionErrors,
    ping,
  });

  const { isGenerating, generateData } = useGeneration({
    addLog,
    buildPayload,
    api,
    config,
    dispatch,
    forceDemoMode: connectionEstablished && !openAiKeyAvailable,
    generationConfig,
    mountedRef,
    progress,
    setProgress,
    setGenerationCompleted,
    connectionEstablished,
  });

  const forceDemoMode = connectionEstablished && !openAiKeyAvailable;

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

  useEffect(() => {
    if (!forceDemoMode) return;

    setGenerationConfig((prev) => {
      const next = { ...prev, demoMode: true };
      if (next.imageMode === 'generate') next.imageMode = 'default';
      if (next.pdfMode === 'generate') next.pdfMode = 'default';
      return next;
    });
  }, [forceDemoMode, setGenerationConfig]);

  const wsStatus =
    !connectionEstablished || !config?.microserviceUrl
      ? 'disabled'
      : wsConnected
        ? 'connected'
        : 'connecting';

  useEffect(() => {
    if (!openAiKeyAvailable) {
      setGenerationConfig((prev) =>
        prev.demoMode ? prev : { ...prev, demoMode: true }
      );
    }
  }, [openAiKeyAvailable]);

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
  }, [
    isGenerating,
    generationConfig.productCount,
    generationConfig.accountCount,
    generationConfig.orderCount,
    generationConfig.imageMode,
    generationConfig.imageRatio,
    generationConfig.pdfMode,
    generationConfig.pdfRatio,
    generationConfig.createWarehouses,
    generationConfig.warehouseCount,
    generationConfig.reuseExistingWarehouses,
  ]);

  const exportConfiguration = () => {
    const exportData = {
      liferayUrl: config.liferayUrl,
      microserviceUrl: config.microserviceUrl,
      batchSize: config.batchSize,
      aiModel: config.aiModel,
      currencyCode: config.currencyCode,
      localeCode: config.localeCode,
      selectedLanguages: config.selectedLanguages,
      catalogId: config.catalogId,
      channelId: config.channelId,
      generationConfig: generationConfig,
      exportedAt: new Date().toISOString(),
    };

    const filename = buildFilename('ai-commerce-accelerator-config');
    exportJsonFile(exportData, filename);

    notifyUser('Configuration exported successfully');
  };

  const importConfiguration = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const importedData = JSON.parse(e.target.result);

          const fieldsToValidate = ['liferayUrl', 'clientId', 'clientSecret'];
          const missingFields = [];

          fieldsToValidate.forEach((field) => {
            const val = importedData[field];
            const empty =
              val == null || (typeof val === 'string' && val.trim() === '');
            if (importedData.hasOwnProperty(field) && empty) {
              missingFields.push(field);
            }
          });

          if (missingFields.length > 0) {
            notifyUser(
              `Invalid values for: ${missingFields.join(', ')}`,
              'danger'
            );
            return;
          }

          const connectionParamsWillChange =
            (importedData.hasOwnProperty('liferayUrl') &&
              config.liferayUrl !== importedData.liferayUrl) ||
            (importedData.hasOwnProperty('clientId') &&
              config.clientId !== importedData.clientId) ||
            (importedData.hasOwnProperty('clientSecret') &&
              config.clientSecret !== importedData.clientSecret);

          const allowedConfigFields = [
            'liferayUrl',
            'microserviceUrl',
            'clientId',
            'clientSecret',
            'batchSize',
            'aiModel',
            'currencyCode',
            'selectedLanguages',
            'catalogId',
            'channelId',
            'reactLoggingLevel',
            'wsLoggingLevel',
          ];

          const newConfig = { ...config };
          allowedConfigFields.forEach((field) => {
            if (importedData.hasOwnProperty(field)) {
              newConfig[field] = importedData[field];
            }
          });

          if (newConfig.channelId != null) {
            await selectChannel(newConfig.channelId, {
              selectedLanguages: newConfig.selectedLanguages,
              currencyCode: newConfig.currencyCode,
            });
          }

          setConfig(newConfig);

          if (importedData.generationConfig) {
            setGenerationConfig((prevConfig) => {
              const importedGenConfig = importedData.generationConfig;
              let newCategories = importedGenConfig.categories || [];
              const availableCategoryNames = new Set(
                availableCategories.map((c) => c.key)
              );

              // Filter out categories that are not available
              const validImportedCategories = newCategories.filter((cat) =>
                availableCategoryNames.has(cat)
              );

              // Identify unavailable categories
              const unavailableCategories = newCategories.filter(
                (cat) => !availableCategoryNames.has(cat)
              );

              if (unavailableCategories.length > 0) {
                notifyUser(
                  `Some imported categories are not available in the current Liferay instance: ${unavailableCategories.join(
                    ', '
                  )}. These categories have been removed from the configuration.`,
                  'warning'
                );
              }

              // If no valid categories remain, default to the first available
              if (
                validImportedCategories.length === 0 &&
                availableCategories.length > 0
              ) {
                validImportedCategories.push(availableCategories[0].key);
                notifyUser(
                  `No valid categories were imported, defaulting to '${availableCategories[0].key}'.`,
                  'info'
                );
              }

              return {
                ...prevConfig,
                ...importedGenConfig,
                categories: validImportedCategories,
              };
            });
          }

          if (connectionParamsWillChange) {
            if (mountedRef.current) setConnectionEstablished(false);
            if (mountedRef.current) setOpenAiKeyAvailable(false);

            notifyUser(
              'Configuration imported successfully. Please test connection with new parameters.'
            );
          } else {
            notifyUser(
              connectionEstablished
                ? 'Configuration imported successfully! Connection maintained.'
                : 'Configuration imported successfully.'
            );
          }
        } catch (error) {
          notifyUser(
            'Failed to import configuration. Invalid JSON file.',
            'danger',
            error
          );
        }
      };

      reader.readAsText(file);
      event.target.value = '';
    },
    [config, setConfig, connectionEstablished, notifyUser, setGenerationConfig]
  );

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

    const { products, accounts, orders, warehouses } =
      computeTotalsFromConfig(generationConfig);
    const images = expectedImageTotal(generationConfig);
    const pdfs = expectedPdfTotal(generationConfig);

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
  }, [clearLogs, setProgress, generationConfig, notifyUser]);

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

  const [availableCategories, setAvailableCategories] = useState([]);

  useEffect(() => {
    if (!connectionEstablished) return;
    (async () => {
      try {
        const fetched = await categories();
        if (mountedRef.current) {
          setAvailableCategories(fetched);
          // Set first category as default if none selected
          setGenerationConfig((prevConfig) => {
            if (
              fetched.length > 0 &&
              (prevConfig.categories == null ||
                prevConfig.categories.length === 0)
            ) {
              return { ...prevConfig, categories: [fetched[0]] };
            }
            return prevConfig;
          });
        }
      } catch (err) {
        addLog('Failed to load categories: ' + err.message, 'error');
      }

      try {
        const fetchedBatchSizes = await api.get(BATCH_SIZES);
        if (mountedRef.current && Array.isArray(fetchedBatchSizes)) {
          setBatchSizes(fetchedBatchSizes);
        }
      } catch (err) {
        addLog('Failed to load batch sizes: ' + err.message, 'error');
      }

      try {
        const fetchedAIModelOptions = await api.get(AI_MODEL_OPTIONS);
        console.log('Fetched AI Model Options:', fetchedAIModelOptions);
        if (mountedRef.current && Array.isArray(fetchedAIModelOptions)) {
          setAiModelOptions(fetchedAIModelOptions);

          setConfig((prevConfig) => {
            const newConfig = { ...prevConfig };
            if (!newConfig.aiModel && fetchedAIModelOptions.length > 0) {
              newConfig.aiModel = fetchedAIModelOptions[0].value;
            }
            if (!newConfig.batchSize && fetchedBatchSizes.length > 0) {
              newConfig.batchSize = fetchedBatchSizes[0];
            }
            return newConfig;
          });
        }
      } catch (err) {
        addLog('Failed to load AI model options: ' + err.message, 'error');
      }
    })();
  }, [connectionEstablished, categories, mountedRef, addLog, api, setConfig]);

  useEffect(() => {
    console.log('Batch Errors:', batchErrors);
  }, [batchErrors]);

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-12">
          <div className="card shadow-sm" ref={appTopRef}>
            <div className="card-header bg-primary text-white">
              <h1 className="h3 mb-0">
                <i className="fas fa-robot me-2"></i>
                {config?.title ?? 'Liferay AI Commerce Accelerator'}
              </h1>
              {subtitle && <p className="mb-0 mt-2">{subtitle}</p>}
            </div>
            <div className="card-body">
              <div className="row">
                <div className="col-lg-4">
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
                    onOpenAiKeyStatusChange={setOpenAiKeyAvailable}
                    openAiKeyAvailable={openAiKeyAvailable}
                    connectionErrors={connectionErrors}
                    commerceErrors={commerceErrors}
                    onErrorsChange={setConnectionErrors}
                    onDeleteAllCommerceData={handleDeleteAllCommerceData}
                    onDeleteSelectedCommerceData={
                      handleDeleteSelectedCommerceData
                    }
                    batchSizes={batchSizes}
                    aiModelOptions={aiModelOptions}
                  />
                </div>
                <div className="col-lg-8">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5>
                      <i className="fas fa-cogs me-2"></i>
                      Application Configuration
                    </h5>
                    <div className="btn-group">
                      <input
                        type="file"
                        id="configImport"
                        accept=".json"
                        onChange={importConfiguration}
                        style={{ display: 'none' }}
                        disabled={isGenerating}
                      />
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() =>
                          document.getElementById('configImport').click()
                        }
                        disabled={isGenerating}
                        title="Import complete application configuration to JSON file"
                      >
                        <i className="fas fa-upload me-1"></i>
                        Import Config
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={exportConfiguration}
                        disabled={isGenerating}
                        title="Export complete application configuration to JSON file"
                      >
                        <i className="fas fa-download me-1"></i>
                        Export Config
                      </button>
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
                    openAiKeyAvailable={openAiKeyAvailable}
                    validationErrors={generationErrors}
                    scrollTargetRef={appTopRef}
                    availableCategories={availableCategories}
                    generationCompleted={generationCompleted}
                    onExport={handleExport}
                    onImport={handleImport}
                    liferayConnected={connectionEstablished}
                  />
                  <Dashboard
                    progress={progress}
                    logs={logs}
                    isGenerating={isGenerating}
                    onClearLogs={clearLogs}
                    onReset={handleProgressReset}
                    generationConfig={generationConfig}
                    wsStatus={wsStatus}
                    batchErrors={batchErrors}
                    clearBatchErrors={clearBatchErrors}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
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
