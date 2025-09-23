import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { AppProvider, useApi, useApp } from './context/AppContext.jsx';
import { progressReducer, initialProgress } from './state/progressReducer';

import useActivityLog from './hooks/useActivityLog';
import useRealtimeWebSocket from './hooks/useRealtimeWebSocket';

import ApplicationConfigPanel from './components/config/ApplicationConfigPanel';
import DataGeneratorForm from './components/DataGeneratorForm';
import ProgressMonitor from './components/ProgressMonitor';

import notifyUser from './utils/notifications';

const toInt = (v) => (v == null || v === '' ? undefined : parseInt(v, 10));
const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function toFormData(obj, files = {}) {
  const fd = new FormData();

  Object.entries(obj).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null) {
      fd.append(key, '');
      return;
    }
    if (value instanceof File || value instanceof Blob) {
      return;
    }
    const isObject = typeof value === 'object';
    fd.append(key, isObject ? JSON.stringify(value) : String(value));
  });

  Object.entries(files).forEach(([field, file]) => {
    if (!file) return;
    fd.append(field, file, file.name || field);
  });

  return fd;
}

export function AppUI() {
  const mountedRef = React.useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    []
  );

  const { config, setConfig } = useApp();

  const isHosted = !!config.liferayHosted;

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

  const [catalogs, setCatalogs] = useState([]);
  const [channels, setChannels] = useState([]);
  const [languages, setLanguages] = useState([]);
  const [currencies, setCurrencies] = useState([]);

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
      reader.onload = async (e) => {
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

  const buildPayload = useCallback(
    (overrides = {}) => {
      const {
        includeCredentials = !config.liferayHosted,
        channel,
        siteGroupId,
        ...rest
      } = overrides;

      const base = {
        liferayUrl: config.liferayUrl,
        microserviceUrl: config.microserviceUrl,
        localeCode: config.localeCode,
        languageId: config.languageId,
        pollingDelay: config.pollingDelay,
        pollingRetries: config.pollingRetries,

        catalogId: toInt(config.catalogId),
        channelId:
          channel?.id != null ? toInt(channel.id) : toInt(config.channelId),
        siteGroupId: channel?.siteGroupId ?? siteGroupId,
        currencyCode: config.currencyCode,

        aiModel: config.aiModel,
        batchSize: config.batchSize,
        selectedLanguages: toArray(config.selectedLanguages),

        ...rest,
      };

      if (includeCredentials && config.clientId && config.clientSecret) {
        base.clientId = config.clientId;
        base.clientSecret = config.clientSecret;
      }

      return base;
    },
    [config]
  );

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

        const parallelTasks = [];

        if (generationConfig.productCount > 0) {
          const productTask = async () => {
            try {
              if (mountedRef.current)
                addLog(
                  `Generating ${generationConfig.productCount} products...`,
                  'info'
                );

              const basePayload = {
                ...buildPayload(),
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
                useCustomPDF: generationConfig.useCustomPDF,

                demoMode: generationConfig.demoMode,
              };

              const imageFile = generationConfig.useCustomImage
                ? generationConfig.customImageFile
                : null;
              const pdfFile = generationConfig.useCustomPDF
                ? generationConfig.customPDFFile
                : null;

              let response;
debugger;
              if (imageFile || pdfFile) {
                // Multipart: meta as fields, plus files
                const form = toFormData(basePayload, {
                  customImageFile: imageFile,
                  customPDFFile: pdfFile,
                });

                response = await api.post('/api/generate/products', form);
              } else {
                response = await api.post('/api/generate/products', basePayload);
              }

              if (response.success) {
                totalProductsCreated = response.count || 0;
                totalPDFsCreated = response.pdfCount || 0;

                if (response.batchId) {
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalProductsCreated} demo products for batch creation (Batch ID: ${response.batchId})`
                    : `✓ Successfully submitted ${totalProductsCreated} products for batch creation (Batch ID: ${response.batchId})`;
                  if (mountedRef.current) addLog(batchMessage, 'success');
                } else {
                  const productMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalProductsCreated} demo products`
                    : `✓ Successfully generated ${totalProductsCreated} products`;
                  if (mountedRef.current) addLog(productMessage, 'success');

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

        if (generationConfig.accountCount > 0) {
          const accountTask = async () => {
            try {
              if (mountedRef.current)
                addLog(
                  `Generating ${generationConfig.accountCount} accounts...`,
                  'info'
                );

              const response = await api.post('/api/generate/accounts', {
                ...buildPayload(),
                count: generationConfig.accountCount,
                demoMode: generationConfig.demoMode,
              });

              if (response.success) {
                totalAccountsCreated = response.count || 0;

                if (response.batchId) {
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalAccountsCreated} demo accounts for batch creation (Batch ID: ${response.batchId})`
                    : `✓ Successfully submitted ${totalAccountsCreated} accounts for batch creation (Batch ID: ${response.batchId})`;
                  if (mountedRef.current) addLog(batchMessage, 'success');
                } else {
                  const accountMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalAccountsCreated} demo accounts`
                    : `✓ Successfully generated ${totalAccountsCreated} accounts`;
                  if (mountedRef.current) addLog(accountMessage, 'success');

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

        if (generationConfig.orderCount > 0) {
          try {
            const hasProducts = generationConfig.productCount > 0;
            const hasAccounts = generationConfig.accountCount > 0;

            if (mountedRef.current)
              addLog(
                `Generating ${generationConfig.orderCount} orders...`,
                'info'
              );

            if (hasProducts || hasAccounts) {
              if (mountedRef.current)
                addLog(
                  '⏳ Verifying products and accounts are available in Liferay...',
                  'info'
                );

              let retries = 0;
              let productsAvailable = !hasProducts;
              let accountsAvailable = !hasAccounts;

              while (
                (!productsAvailable || !accountsAvailable) &&
                retries < config.maxRetries
              ) {
                retries++;
                if (mountedRef.current)
                  addLog(
                    `⏳ Checking data availability (attempt ${retries}/${config.maxRetries})...`,
                    'info'
                  );

                try {
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

                    accountsAvailable = res.sufficient;
                    if (accountsAvailable) {
                      if (mountedRef.current)
                        addLog(
                          `✓ Found ${accountsCheck.count} accounts available (${accountsCheck.required} required)`,
                          'success'
                        );
                    } else {
                      if (mountedRef.current)
                        addLog(
                          `⚠ Only ${accountsCheck.count} accounts found, ${accountsCheck.required} required`,
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

                await new Promise((resolve) =>
                  setTimeout(resolve, config.pollingDelay)
                );
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
              ...buildPayload(),
              orderCount: generationConfig.orderCount,
              demoMode: generationConfig.demoMode,
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
            const errorMessage = error.response?.error || error.message;

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
            `Generation failed: ${error.response?.error || error.message}`,
            'error'
          );
      } finally {
        if (mountedRef.current) setIsGenerating(false);
      }
    };

    handleGenerate(currentGenerationConfig);
  };

  const loadRootLists = async () => {
    const payload = buildPayload();

    const [cat, ch] = await Promise.all([
      api.post('/api/get-catalogs', payload),
      api.post('/api/get-channels', payload),
    ]);

    const cats = Array.isArray(cat?.catalogs) ? cat.catalogs : [];
    const chs = Array.isArray(ch?.channels) ? ch.channels : [];

    setCatalogs(cats);
    setChannels(chs);

    return { catalogs: cats, channels: chs };
  };

  const loadChannelDependent = async (channelOrId) => {
    let chObj =
      channelOrId && typeof channelOrId === 'object'
        ? channelOrId
        : (channels || []).find((c) => String(c.id) === String(channelOrId));

    if (!chObj) {
      const fresh = (await loadRootLists()).channels;
      chObj = fresh.find((c) => String(c.id) === String(channelOrId));
      if (!chObj) {
        notifyUser(
          'Selected channel not found. Please test the connection again.',
          'warning'
        );
        return null;
      }
    }

    const payload = buildPayload({ channel: chObj });

    const [langsRes, currsRes] = await Promise.all([
      api.post('/api/get-languages', payload),
      api.post('/api/get-currencies', payload),
    ]);

    const langs = Array.isArray(langsRes?.languages) ? langsRes.languages : [];
    const currs = Array.isArray(currsRes?.currencies)
      ? currsRes.currencies
      : [];

    setLanguages(langs);
    setCurrencies(currs);

    const selectLangs = langs.filter((lang) => lang.markedAsDefault).map((lang) => lang.id);

    setConfig((prev) => ({
      ...prev,
      channelId: chObj.id,
      selectedLanguages: selectLangs,
      ...(prev.currencyCode
        ? {}
        : chObj.currencyCode
        ? { currencyCode: chObj.currencyCode }
        : {}),
    }));

    return chObj;
  };

  const testConnection = async () => {
    const payload = buildPayload();
    const res = await api.post('/api/test-connection', payload);

    if (!res?.success) {
      setConnectionEstablished(false);
      setOpenAiKeyAvailable(false);
      throw new Error(res?.message || 'Failed to establish connection.');
    }

    // Optional: log server message
    addLog(res.message || 'Connected.', 'success');

    setOpenAiKeyAvailable(Boolean(res.openAiKeyAvailable));

    await loadRootLists(); // fetch catalogs + channels
    setConnectionEstablished(true);

    return res;
  };

  const selectChannel = async (
    channelObjOrId,
    { selectedLanguages, currencyCode } = {}
  ) => {
    const chObj = await loadChannelDependent(channelObjOrId);
    if (!chObj) return;

    // Re-apply selections AFTER options load
    setConfig((prev) => {
      const available = new Set(
        (languages || []).map((l) => l.code ?? l.locale ?? l.id)
      );
      const nextLangs = Array.isArray(selectedLanguages)
        ? selectedLanguages.filter((code) => available.has(code))
        : prev.selectedLanguages;

      const nextCurr =
        currencyCode ?? prev.currencyCode ?? chObj.currencyCode ?? '';

      return {
        ...prev,
        channelId: chObj.id,
        selectedLanguages: nextLangs,
        currencyCode: nextCurr,
      };
    });
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
                  <ApplicationConfigPanel
                    disabled={isGenerating}
                    generationConfig={generationConfig}
                    // NEW: wire the connection test + status + lists
                    onTestConnection={testConnection}
                    onConnectionStatusChange={setConnectionEstablished}
                    connected={connectionEstablished}
                    catalogs={catalogs}
                    channels={channels}
                    languages={languages}
                    currencies={currencies}
                    onSelectChannel={selectChannel}
                    // Keep OpenAI key plumbing (for DataGeneratorForm/demo mode)
                    onOpenAiKeyStatusChange={setOpenAiKeyAvailable}
                    openAiKeyAvailable={openAiKeyAvailable}
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
