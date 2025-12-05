import React, {
  useState,
  useEffect,
  useCallback,
  useReducer,
  useRef,
  useMemo,
} from 'react';
import { AppProvider, useApp } from './context/AppContext.jsx';
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

import { buildFilename, exportJsonFile } from './utils/fileHelper.js';

import ConfigurationPanel from './components/config/ConfigurationPanel.jsx';
import DataGeneratorForm from './components/data-generator/DataGeneratorForm';
import ProgressMonitor from './components/dashboard/Dashboard.jsx';

const toInt = (v) => (v == null || v === '' ? undefined : parseInt(v, 10));
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const initialGenerationConfig = {
  productCount: 2,
  accountCount: 5,
  orderCount: 20,
  categories: ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'],
  generatePriceLists: false,
  generateBulkPricing: false,
  generateTierPricing: false,
  imageMode: 'default',
  imageWidth: 1024,
  imageHeight: 1024,
  imageQuality: 'standard',
  imageStyle: 'photographic',
  imageRatio: 25,
  customImageFile: null,
  generateSpecifications: false,
  generateSkuVariants: false,
  pdfMode: 'default',
  pdfRatio: 10,
  demoMode: true,
  inventoryMin: 0,
  inventoryMax: 1000,
  inventoryAssignmentRatio: 100,
  enableBackorders: false,
  backorderAssignmentRatio: 50,
  createWarehouses: true,
  reuseExistingWarehouses: true,
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

  const [generationConfig, setGenerationConfig] = useState(
    initialGenerationConfig
  );

  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [openAiKeyAvailable, setOpenAiKeyAvailable] = useState(false);

  const initialLoggingConfig = {
    level: config?.wsLoggingLevel || 'info',
    maxEntries: 500,
    dedupeWindowMs: 1000,
    mirrorToConsole: true,
    storageKey: 'activityLog:v1',
  };

  const { logs, addLog, clearLogs } = useActivityLog(initialLoggingConfig);

  const {
    connectionErrors,
    setConnectionErrors,
    commerceErrors,
    generationErrors,
  } = useValidation(config, generationConfig);

  const [progress, dispatch] = useReducer(progressReducer, initialProgress);

  const setProgress = useCallback((arg) => {
    if (typeof arg === 'function') {
      dispatch({ type: 'APPLY_UPDATER', updater: arg });
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
  });

  const {
    catalogs,
    channels,
    languages,
    currencies,
    buildPayload,
    selectChannel,
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
    config,
    dispatch,
    forceDemoMode: connectionEstablished && !openAiKeyAvailable,
    generationConfig,
    mountedRef,
    progress,
    setProgress,
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

  let disabled = isGenerating;
  let disabledReason = '';

  if (firstConnectionError) {
    disabled = true;
    disabledReason = firstConnectionError;
  } else if (!connectionEstablished) {
    disabled = true;
    disabledReason = 'Please test the connection first.';
  } else if (firstCommerceError) {
    disabled = true;
    disabledReason = firstCommerceError;
  } else if (firstGenerationError) {
    disabled = true;
    disabledReason = 'Fix the highlighted issues to continue.';
  } else if (isGenerating) {
    disabled = true;
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
      console.log('🔄 Demo mode enforced - OpenAI key not available');
    }
  }, [openAiKeyAvailable]);

  useEffect(() => {
    if (isGenerating) return;

    const { products, accounts, orders, images, pdfs } =
      computeTotalsFromConfig(generationConfig);

    dispatch({
      type: 'SET_EXPECTED_VALUES',
      values: { images, pdfs },
    });

    dispatch({
      type: 'SET_TOTALS',
      totals: { products, accounts, orders, images, pdfs },
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
            setGenerationConfig(importedData.generationConfig);
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

  const handleProgressReset = useCallback(() => {
    clearLogs();

    const { products, accounts, orders } =
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
    }));

    notifyUser('Progress and activity log have been reset.');
  }, [clearLogs, setProgress, generationConfig, notifyUser]);

  const handleSettingsReset = useCallback(() => {
    setGenerationConfig(initialGenerationConfig);
    notifyUser('Generator settings restored to defaults.');
  }, []);

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
                    disabled={disabled}
                    disabledReason={disabledReason}
                    isGenerating={isGenerating}
                    forceDemoMode={forceDemoMode}
                    openAiKeyAvailable={openAiKeyAvailable}
                    validationErrors={generationErrors}
                    scrollTargetRef={appTopRef}
                  />
                  <ProgressMonitor
                    progress={progress}
                    logs={logs}
                    isGenerating={isGenerating}
                    onClearLogs={clearLogs}
                    onReset={handleProgressReset}
                    generationConfig={generationConfig}
                    wsStatus={wsStatus}
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

export default function AppRoot({ config: initialConfig }) {
  return (
    <AppProvider initialConfig={initialConfig}>
      <AppUI />
    </AppProvider>
  );
}
