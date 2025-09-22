import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { AppProvider, useApi, useApp } from './context/AppContext.jsx';
import { progressReducer, initialProgress } from './state/progressReducer';

import useActivityLog from './hooks/useActivityLog';
import useRealtimeWebSocket from './hooks/useRealtimeWebSocket';

import ConfigurationPanel from './components/ConfigurationPanel';
import DataGeneratorForm from './components/DataGeneratorForm';
import ProgressMonitor from './components/ProgressMonitor';

import notifyUser from './utils/notifications';

const toInt = (v) => (v == null || v === '' ? undefined : parseInt(v, 10));
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export function AppUI() {
  const mountedRef = React.useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const { config, setConfig } = useApp();

  const { logs, addLog, addLogGroup, clearLogs } = useActivityLog({
    level: config?.wsLoggingLevel || 'info',
    maxEntries: 500,
    dedupeWindowMs: 1000,
    mirrorToConsole: true,
    storageKey: 'activityLog:v1',
  });

  const api = useApi();

  const [generationConfig, setGenerationConfig] = useState({
    productCount: 10,
    accountCount: 5,
    orderCount: 20,
    categories: ['Electronics', 'Clothing', 'Home & Garden', 'Sports', 'Books'],
    generatePriceLists: false,
    generateBulkPricing: false,
    generateTierPricing: false,
    generateImages: false,
    imageWidth: 1024,
    imageHeight: 1024,
    imageQuality: 'standard',
    imageStyle: 'photographic',
    imageRatio: 25,
    generateSpecifications: false,
    generateSkuVariants: false,
    generatePDFs: false,
    pdfRatio: 10,
    useCustomImage: false,
    customImageFile: null,
    useCustomPDF: false,
    customPDFFile: null,
    demoMode: true,
  });
  const [isGenerating, setIsGenerating] = useState(false);

  const [progress, dispatch] = useReducer(progressReducer, initialProgress);
  const setProgress = useCallback((arg) => {
    if (typeof arg === 'function') {
      dispatch({ type: 'APPLY_UPDATER', updater: arg });
    } else {
      dispatch({ type: 'MERGE', payload: arg });
    }
  }, []);

  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [openAiKeyAvailable, setOpenAiKeyAvailable] = useState(false);

  const { wsRef, wsConnected } = useRealtimeWebSocket({
    enabled: connectionEstablished && !!config.microserviceUrl,
    microserviceUrl: config.microserviceUrl,
    loggingLevel: config?.wsLoggingLevel ?? 'off',
    onLog: addLog,
    onProgress: setProgress,
  });

  const wsStatus =
    !connectionEstablished || !config?.microserviceUrl
      ? 'disabled'
      : wsConnected
      ? 'connected'
      : 'connecting';

  useEffect(() => {
    // Force demo mode when no OpenAI key is available
    if (!openAiKeyAvailable) {
      setGenerationConfig((prev) =>
        prev.demoMode ? prev : { ...prev, demoMode: true }
      );
      console.log('🔄 Demo mode enforced - OpenAI key not available');
    }
    // When key becomes available, user has choice (no auto-disable)
  }, [openAiKeyAvailable]);

  const exportConfiguration = () => {
    const exportData = {
      liferayUrl: config.liferayUrl,
      microserviceUrl: config.microserviceUrl,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
      aiModel: config.aiModel,
      currencyCode: config.currencyCode,
      localeCode: config.localeCode,
      selectedLanguages: config.selectedLanguages,
      catalogId: config.catalogId,
      channelId: config.channelId,
      generationConfig: generationConfig,
      exportedAt: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-generator-config-${
      new Date().toISOString().split('T')[0]
    }.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    notifyUser('Configuration exported successfully');
  };

  const importConfiguration = useCallback(
    (event) => {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedData = JSON.parse(e.target.result);

          // Only validate fields that are actually present in the imported data
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

          // Check if connection parameters will change
          const connectionParamsWillChange =
            (importedData.hasOwnProperty('liferayUrl') &&
              config.liferayUrl !== importedData.liferayUrl) ||
            (importedData.hasOwnProperty('clientId') &&
              config.clientId !== importedData.clientId) ||
            (importedData.hasOwnProperty('clientSecret') &&
              config.clientSecret !== importedData.clientSecret);

          // Import general configuration fields
          const allowedConfigFields = [
            'liferayUrl',
            'microserviceUrl',
            'clientId',
            'clientSecret',
            'batchSize',
            'pollingDelay',
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

          setConfig(newConfig);

          // Set the imported generation configuration
          if (importedData.generationConfig) {
            setGenerationConfig(importedData.generationConfig);
          }

          // Handle connection state based on whether connection parameters changed
          if (connectionParamsWillChange) {
            // Connection parameters changed, reset connection state
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
      // Clear the input so the same file can be imported again if needed
      event.target.value = '';
    },
    [config, setConfig, connectionEstablished, notifyUser, setGenerationConfig]
  );

  const buildCommonPayload = useCallback(
    () => ({
      liferayUrl: config.liferayUrl,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      catalogId: toInt(config.catalogId),
      channelId: toInt(config.channelId),
      currencyCode: config.currencyCode,
      aiModel: config.aiModel,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
      selectedLanguages: toArray(config.selectedLanguages),
    }),
    [config]
  );

  // Function to handle data generation
  const generateData = async (currentGenerationConfig) => {
    const handleGenerate = async (generationConfig) => {
      if (!connectionEstablished) {
        if (mountedRef.current)
          addLog(
            'Please test the connection first before generating data.',
            'error'
          );
        return;
      }

      // The WebSocket connection is managed by the main useEffect
      // No manual connection needed here

      console.log('🚀 Starting generation process:', {
        wsConnected,
        connectionEstablished,
        hasWebSocket: !!wsRef.current,
        wsState: wsRef.current ? wsRef.current.readyState : 'null',
      });

      if (mountedRef.current) setIsGenerating(true);
      setProgress({
        products: {
          total: generationConfig.productCount,
          completed: 0,
          errors: [],
        },
        accounts: {
          total: generationConfig.accountCount,
          completed: 0,
          errors: [],
        },
        orders: {
          total: generationConfig.orderCount,
          completed: 0,
          errors: [],
        },
        images: {
          completed: 0,
          total: Math.ceil(
            generationConfig.productCount * (generationConfig.imageRatio / 100)
          ),
          errors: [],
        },
        pdfs: {
          completed: 0,
          total: Math.ceil(
            generationConfig.productCount * (generationConfig.pdfRatio / 100)
          ),
          errors: [],
        },
      });

      if (mountedRef.current)
        addLog(
          `Starting data generation: ${generationConfig.productCount} products, ${generationConfig.accountCount} accounts, ${generationConfig.orderCount} orders`,
          'info'
        );

      try {
        let totalProductsCreated = 0;
        let totalAccountsCreated = 0;
        let totalOrdersCreated = 0;
        let totalImagesCreated = 0;
        let totalPDFsCreated = 0;

        // Generate Products and Accounts in parallel for better performance
        // Orders will be generated last since they depend on both products and accounts

        const parallelTasks = [];

        // Step 1: Prepare Products generation task
        if (generationConfig.productCount > 0) {
          const productTask = async () => {
            try {
              if (mountedRef.current)
                addLog(
                  `Generating ${generationConfig.productCount} products...`,
                  'info'
                );

              const response = await api.post('/api/generate/products', {
                ...buildCommonPayload(),
                microserviceUrl:
                  config.microserviceUrl || window.location.origin,
                count: generationConfig.productCount,
                categories: generationConfig.categories,
                generatePriceLists: generationConfig.generatePriceLists,
                generateBulkPricing: generationConfig.generateBulkPricing,
                generateTierPricing: generationConfig.generateTierPricing,
                generateImages: generationConfig.generateImages,
                imageWidth: generationConfig.imageWidth,
                imageHeight: generationConfig.imageHeight,
                imageQuality: generationConfig.imageQuality,
                imageStyle: generationConfig.imageStyle,
                imageRatio: generationConfig.imageRatio,
                generateSpecifications: generationConfig.generateSpecifications,
                generateSkuVariants: generationConfig.generateSkuVariants,
                generatePDFs: generationConfig.generatePDFs,
                pdfRatio: generationConfig.pdfRatio,
                useCustomImage: generationConfig.useCustomImage,
                customImageFile: generationConfig.customImageFile,
                useCustomPDF: generationConfig.useCustomPDF,
                customPDFFile: generationConfig.customPDFFile,
                demoMode: generationConfig.demoMode,
              });

              if (response.success) {
                totalProductsCreated = response.count || 0;
                totalPDFsCreated = response.pdfCount || 0;

                if (response.batchId) {
                  // Batch mode - WebSocket will handle progress updates
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalProductsCreated} demo products for batch creation (Batch ID: ${response.batchId})`
                    : `✓ Successfully submitted ${totalProductsCreated} products for batch creation (Batch ID: ${response.batchId})`;
                  if (mountedRef.current) addLog(batchMessage, 'success');
                } else {
                  // Individual mode - immediate success
                  const productMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalProductsCreated} demo products`
                    : `✓ Successfully generated ${totalProductsCreated} products`;
                  if (mountedRef.current) addLog(productMessage, 'success');

                  // Update progress immediately for non-batch operations
                  setProgress((prev) => ({
                    ...prev,
                    products: {
                      ...prev.products,
                      completed: totalProductsCreated,
                    },
                  }));
                }

                if (generationConfig.generatePDFs && totalPDFsCreated > 0) {
                  const pdfMessage = generationConfig.demoMode
                    ? `✓ Generated ${totalPDFsCreated} demo PDFs`
                    : `✓ Generated ${totalPDFsCreated} product PDFs`;
                  if (mountedRef.current) addLog(pdfMessage, 'success');

                  // Update PDF progress immediately
                  setProgress((prev) => ({
                    ...prev,
                    pdfs: { ...prev.pdfs, completed: totalPDFsCreated },
                  }));
                }
              } else {
                if (mountedRef.current)
                  addLog(
                    `✗ Product generation failed: ${response.error}`,
                    'error'
                  );
                setProgress((prev) => ({
                  ...prev,
                  products: {
                    ...prev.products,
                    errors: [...prev.products.errors, response.error],
                  },
                }));
              }
            } catch (error) {
              if (mountedRef.current)
                addLog(
                  `✗ Product generation failed: ${
                    error.response?.data?.error || error.message
                  }`,
                  'error'
                );
              setProgress((prev) => ({
                ...prev,
                products: {
                  ...prev.products,
                  errors: [...prev.products.errors, error.message],
                },
              }));
            }
          };

          parallelTasks.push(productTask);
        }

        // Step 2: Prepare Accounts generation task
        if (generationConfig.accountCount > 0) {
          const accountTask = async () => {
            try {
              if (mountedRef.current)
                addLog(
                  `Generating ${generationConfig.accountCount} accounts...`,
                  'info'
                );

              const response = await api.post('/api/generate/accounts', {
                ...buildCommonPayload(),
                count: generationConfig.accountCount,
                demoMode: generationConfig.demoMode,
              });

              if (response.success) {
                totalAccountsCreated = response.count || 0;

                if (response.batchId) {
                  // Batch mode - WebSocket will handle progress updates
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalAccountsCreated} demo accounts for batch creation (Batch ID: ${response.batchId})`
                    : `✓ Successfully submitted ${totalAccountsCreated} accounts for batch creation (Batch ID: ${response.batchId})`;
                  if (mountedRef.current) addLog(batchMessage, 'success');
                } else {
                  // Individual mode - immediate success
                  const accountMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalAccountsCreated} demo accounts`
                    : `✓ Successfully generated ${totalAccountsCreated} accounts`;
                  if (mountedRef.current) addLog(accountMessage, 'success');

                  // Update progress immediately for non-batch operations
                  setProgress((prev) => ({
                    ...prev,
                    accounts: {
                      ...prev.accounts,
                      completed: totalAccountsCreated,
                    },
                  }));
                }
              } else {
                if (mountedRef.current)
                  addLog(
                    `✗ Account generation failed: ${response.error}`,
                    'error'
                  );
                setProgress((prev) => ({
                  ...prev,
                  accounts: {
                    ...prev.accounts,
                    errors: [...prev.accounts.errors, response.error],
                  },
                }));
              }
            } catch (error) {
              if (mountedRef.current)
                addLog(
                  `✗ Account generation failed: ${
                    error.response?.data?.error || error.message
                  }`,
                  'error'
                );
              setProgress((prev) => ({
                ...prev,
                accounts: {
                  ...prev.accounts,
                  errors: [...prev.accounts.errors, error.message],
                },
              }));
            }
          };

          parallelTasks.push(accountTask);
        }

        // Execute products and accounts generation in parallel
        if (parallelTasks.length > 0) {
          if (mountedRef.current)
            addLog(
              `Executing ${parallelTasks.length} generation tasks in parallel...`,
              'info'
            );
          await Promise.all(parallelTasks.map((task) => task()));
          if (mountedRef.current)
            addLog(`✓ Parallel generation tasks completed`, 'success');
        }

        // Step 3: Generate Orders (LAST - depends on products and accounts)
        if (generationConfig.orderCount > 0) {
          try {
            const hasProducts = generationConfig.productCount > 0;
            const hasAccounts = generationConfig.accountCount > 0;

            if (mountedRef.current)
              addLog(
                `Generating ${generationConfig.orderCount} orders...`,
                'info'
              );

            // If products or accounts were just created, wait and verify they're available
            if (hasProducts || hasAccounts) {
              if (mountedRef.current)
                addLog(
                  '⏳ Verifying products and accounts are available in Liferay...',
                  'info'
                );

              // Wait with retries to ensure data is available
              let retries = 0;
              const maxRetries = 12; // 60 seconds total
              let productsAvailable = !hasProducts; // true if we don't need products
              let accountsAvailable = !hasAccounts; // true if we don't need accounts

              while (
                (!productsAvailable || !accountsAvailable) &&
                retries < maxRetries
              ) {
                retries++;
                if (mountedRef.current)
                  addLog(
                    `⏳ Checking data availability (attempt ${retries}/${maxRetries})...`,
                    'info'
                  );

                try {
                  // Check products availability
                  if (hasProducts && !productsAvailable) {
                    const productsCheck = await api.post(
                      '/api/validate/products',
                      {
                        liferayUrl: config.liferayUrl,
                        clientId: config.clientId,
                        clientSecret: config.clientSecret,
                        requiredCount: totalProductsCreated,
                      }
                    );
                    productsAvailable = productsCheck.sufficient;
                    if (productsAvailable) {
                      if (mountedRef.current)
                        addLog(
                          `✓ Found ${productsCheck.count} products available (${productsCheck.required} required)`,
                          'success'
                        );
                    } else {
                      if (mountedRef.current)
                        addLog(
                          `⚠ Only ${productsCheck.count} products found, ${productsCheck.required} required`,
                          'info'
                        );
                    }
                  }

                  // Check accounts availability
                  if (hasAccounts && !accountsAvailable) {
                    const accountsCheck = await api.post(
                      '/api/validate/accounts',
                      {
                        liferayUrl: config.liferayUrl,
                        clientId: config.clientId,
                        clientSecret: config.clientSecret,
                        requiredCount: totalAccountsCreated,
                      }
                    );
                    accountsAvailable = accountsCheck.data.sufficient;
                    if (accountsAvailable) {
                      if (mountedRef.current)
                        addLog(
                          `✓ Found ${accountsCheck.data.count} accounts available (${accountsCheck.data.required} required)`,
                          'success'
                        );
                    } else {
                      if (mountedRef.current)
                        addLog(
                          `⚠ Only ${accountsCheck.data.count} accounts found, ${accountsCheck.data.required} required`,
                          'info'
                        );
                    }
                  }

                  if (productsAvailable && accountsAvailable) {
                    if (mountedRef.current)
                      addLog(
                        '✓ All required data is now available in Liferay',
                        'success'
                      );
                    break;
                  }
                } catch (checkError) {
                  console.log(
                    `Data availability check failed (attempt ${retries}):`,
                    checkError.message
                  );
                }

                // Wait 5 seconds before next check
                await new Promise((resolve) => setTimeout(resolve, 5000));
              }

              if (!productsAvailable) {
                throw new Error(
                  'Products are still not available after waiting. Please try again in a few minutes or check Liferay logs.'
                );
              }
              if (!accountsAvailable) {
                throw new Error(
                  'Accounts are still not available after waiting. Please try again in a few minutes or check Liferay logs.'
                );
              }
            }

            // Determine if retry should be enabled based on whether we created products/accounts
            const enableRetry =
              totalProductsCreated > 0 || totalAccountsCreated > 0;

            if (enableRetry) {
              if (mountedRef.current)
                addLog(
                  `Retry enabled: Dependencies were created in this session`,
                  'info'
                );
            }

            const response = await api.post('/api/generate/orders', {
              ...buildCommonPayload(),
              orderCount: generationConfig.orderCount,
              demoMode: generationConfig.demoMode,
              microserviceUrl: config.microserviceUrl,
              enableRetry: enableRetry,
            });

            if (response.success) {
              totalOrdersCreated = response.count || 0;
              const orderMessage = generationConfig.demoMode
                ? `✓ Successfully generated ${totalOrdersCreated} demo orders`
                : `✓ Successfully generated ${totalOrdersCreated} orders`;
              if (mountedRef.current) addLog(orderMessage, 'success');
            } else {
              if (mountedRef.current)
                addLog(`✗ Order generation failed: ${response.error}`, 'error');
              setProgress((prev) => ({
                ...prev,
                orders: {
                  ...prev.orders,
                  errors: [...prev.orders.errors, response.error],
                },
              }));
            }
          } catch (error) {
            const errorMessage = error.response?.data?.error || error.message;

            // Check for specific validation errors that users can fix
            if (errorMessage.includes('No products available')) {
              if (mountedRef.current)
                addLog(
                  '⚠️ Cannot generate orders: No products found. Orders require existing products.',
                  'warning'
                );
            } else if (errorMessage.includes('No accounts available')) {
              if (mountedRef.current)
                addLog(
                  '⚠️ Cannot generate orders: No accounts found. Orders require existing accounts.',
                  'warning'
                );
            } else {
              if (mountedRef.current)
                addLog(`✗ Order generation failed: ${errorMessage}`, 'error');
            }

            setProgress((prev) => ({
              ...prev,
              orders: {
                ...prev.orders,
                errors: [...prev.orders.errors, errorMessage],
              },
            }));
          }
        }

        // Final progress updates are handled by WebSocket for batch operations
        // Only update for non-batch operations or orders (which are always individual)
        if (totalOrdersCreated > 0) {
          setProgress((prev) => ({
            ...prev,
            orders: { ...prev.orders, completed: totalOrdersCreated },
          }));
        }

        const completionMessage = generationConfig.demoMode
          ? 'Demo data generation completed! (No AI credits used)'
          : 'Data generation process completed!';
        if (mountedRef.current) addLog(completionMessage, 'success');
      } catch (error) {
        if (mountedRef.current)
          addLog(
            `Generation failed: ${
              error.response?.data?.error || error.message
            }`,
            'error'
          );
      } finally {
        if (mountedRef.current) setIsGenerating(false);
      }
    };

    handleGenerate(currentGenerationConfig);
  };

  // Function to handle connection testing and update state
  const testConnection = async () => {
    try {
      const response = await api.get('/api/health');
      if (response.status === 200) {
        if (mountedRef.current) setConnectionEstablished(true);
        if (mountedRef.current)
          addLog(
            'Connection to microservice established successfully.',
            'success'
          );

        // OpenAI key availability is already set from the connection test
        // No need for separate status check
      } else {
        if (mountedRef.current) setConnectionEstablished(false);
        if (mountedRef.current) setOpenAiKeyAvailable(false); // Reset OpenAI status if connection fails
        if (mountedRef.current)
          addLog('Failed to establish connection to microservice.', 'error');
      }
    } catch (error) {
      if (mountedRef.current) setConnectionEstablished(false);
      if (mountedRef.current) setOpenAiKeyAvailable(false); // Reset OpenAI status if connection fails
      if (mountedRef.current)
        addLog(
          `Connection test failed: ${
            error.response?.data?.error || error.message
          }`,
          'error'
        );
    }
  };

  const subtitle = React.useMemo(
    () =>
      config?.subtitle ||
      'Generate comprehensive Commerce data using AI and Liferay Headless APIs',
    [config?.subtitle]
  );

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-12">
          <div className="card shadow-sm">
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
                    config={config}
                    setConfig={setConfig}
                    disabled={isGenerating}
                    generationConfig={generationConfig}
                    onTestConnection={testConnection} // Pass testConnection function
                    onConnectionStatusChange={setConnectionEstablished}
                    onOpenAiKeyStatusChange={setOpenAiKeyAvailable} // Pass callback to update OpenAI key status
                    openAiKeyAvailable={openAiKeyAvailable} // Pass OpenAI key status
                  />
                </div>
                <div className="col-lg-8">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <h5 className="mb-0">
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
                    disabled={isGenerating}
                    onGenerate={generateData}
                    connectionEstablished={connectionEstablished}
                    openAiKeyAvailable={openAiKeyAvailable}
                  />
                  <ProgressMonitor
                    progress={progress}
                    logs={logs}
                    isGenerating={isGenerating}
                    onClearLogs={clearLogs}
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
