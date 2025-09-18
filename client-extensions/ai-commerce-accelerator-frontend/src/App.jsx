import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

import ConfigurationPanel from './components/ConfigurationPanel';
import DataGeneratorForm from './components/DataGeneratorForm';
import ProgressMonitor from './components/ProgressMonitor';

import notifyUser from './utils/notifications';

export default function LiferayAiCommerceAcceleratorFrontend({
  config: fragmentConfig,
  runtime,
}) {
  const [config, setConfig] = useState({
    liferayUrl: 'http://localhost:8080',
    microserviceUrl: 'http://localhost:3001',
    clientId: '',
    clientSecret: '',
    catalogId: '',
    channelId: '',
    currencyCode: 'USD',
    aiModel: 'gpt-4o',
    batchSize: 5,
    pollingDelay: 10,
    selectedLanguages: [],
    reactLoggingLevel: 'off',
    wsLoggingLevel: 'off',
  });

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
  const [progress, setProgress] = useState({
    products: { total: 0, completed: 0, errors: [] },
    accounts: { total: 0, completed: 0, errors: [] },
    orders: { total: 0, completed: 0, errors: [] },
    images: { total: 0, completed: 0, errors: [] },
    pdfs: { total: 0, completed: 0, errors: [] },
  });
  const [logs, setLogs] = useState([]);
  const [connectionEstablished, setConnectionEstablished] = useState(false);
  const [openAiKeyAvailable, setOpenAiKeyAvailable] = useState(false);

  const wsRef = useRef(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Component unmounting');
        wsRef.current = null;
      }
    };
  }, []);

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

  // WebSocket connection management
  useEffect(() => {
    const effectId =
      config.wsLoggingLevel !== 'off'
        ? Math.random().toString(36).substring(7)
        : null;

    if (config.wsLoggingLevel !== 'off') {
      console.log('🔄 WebSocket useEffect triggered [' + effectId + ']:', {
        connectionEstablished,
        microserviceUrl: config.microserviceUrl,
        currentWsState: wsRef.current ? wsRef.current.readyState : 'null',
        wsConnected,
        timestamp: new Date().toISOString(),
      });
    }

    if (!connectionEstablished || !config.microserviceUrl) {
      if (config.wsLoggingLevel !== 'off') {
        console.log(
          'ℹ️ WebSocket connection skipped [' +
            effectId +
            '] - prerequisites not met'
        );
      }
      return;
    }

    // Skip if already connected and healthy
    if (
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN &&
      wsConnected
    ) {
      if (config.wsLoggingLevel !== 'off') {
        console.log(
          'ℹ️ WebSocket already healthy, skipping connection [' + effectId + ']'
        );
      }
      return;
    }

    // Cleanup existing connection if not healthy
    if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
      if (config.wsLoggingLevel !== 'off') {
        console.log(
          '🔄 WebSocket effect cleanup [' +
            effectId +
            '] - dependency change or unmount'
        );
      }
      try {
        wsRef.current.close();
      } catch (closeError) {
        if (config.wsLoggingLevel !== 'off') {
          console.warn('Warning during WebSocket close:', closeError);
        }
      }
      wsRef.current = null;
      setWsConnected(false);
    }

    const microserviceUrl = config.microserviceUrl?.replace(/\/$/, '');
    const wsUrl = microserviceUrl.replace(/^http/, 'ws');

    if (config.wsLoggingLevel !== 'off') {
      console.log('🔗 Attempting WebSocket connection [' + effectId + ']:', {
        wsUrl,
        microserviceUrl,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      if (config.wsLoggingLevel !== 'off') {
        console.log('🔗 Creating new WebSocket [' + effectId + ']:', {
          wsUrl,
          microserviceUrl,
          timestamp: new Date().toISOString(),
        });
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.warn('⏰ WebSocket connection timeout [' + effectId + ']');
          ws.close();
          addLog(
            'WebSocket connection timed out. Check if microservice is running on ' +
              microserviceUrl,
            'warning'
          );
        }
      }, 10000); // 10 second timeout

      ws.onopen = (event) => {
        clearTimeout(connectionTimeout);
        if (config.wsLoggingLevel !== 'off') {
          console.log('✅ WebSocket connected [' + effectId + ']:', {
            url: wsUrl,
            readyState: ws.readyState,
            timestamp: new Date().toISOString(),
            protocol: ws.protocol,
            extensions: ws.extensions,
          });
        }
        setWsConnected(true);
        addLog('WebSocket connection established successfully.', 'success');

        // Send a ping to test the connection
        try {
          ws.send(
            JSON.stringify({
              type: 'ping',
              timestamp: new Date().toISOString(),
            })
          );
          if (config.wsLoggingLevel === 'verbose') {
            console.log('📤 Sent ping to WebSocket server [' + effectId + ']');
          }
        } catch (pingError) {
          if (config.wsLoggingLevel !== 'off') {
            console.warn('Failed to send ping:', pingError);
          }
        }
      };

      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
          if (config.wsLoggingLevel === 'verbose') {
            console.log('📨 WebSocket message received [' + effectId + ']:', {
              messageType: data.type,
              timestamp: data.timestamp || new Date().toISOString(),
              batchId: data.batchId,
              hasData: !!data,
              dataKeys: Object.keys(data),
              fullMessage: data,
            });
          } else if (config.wsLoggingLevel === 'info') {
            console.log(
              '📨 WebSocket message [' + effectId + ']:',
              data.type,
              data.batchId ? `(Batch: ${data.batchId})` : ''
            );
          }

          // Handle pong response
          if (data.type === 'pong') {
            if (config.wsLoggingLevel === 'verbose') {
              console.log('🏓 Received pong from server [' + effectId + ']');
            }
            return;
          }

          // Handle connected message
          if (data.type === 'connected') {
            if (config.wsLoggingLevel !== 'off') {
              console.log(
                '🤝 Received connected confirmation from server [' +
                  effectId +
                  ']'
              );
            }
            addLog('Connected to real-time updates', 'success');
            return;
          }

          // Handle generation session completion
          if (data.type === 'generation_session_complete') {
            if (config.wsLoggingLevel !== 'off') {
              console.log(
                '🎉 Generation session completed [' + effectId + ']:',
                data
              );
            }
            addLog(
              '✓ All batches completed - starting image and PDF processing...',
              'success'
            );
            return;
          }

          // Update progress counts based on entity type
          const updateProgressCounts = (
            entityType,
            successCount,
            failureCount
          ) => {
            setProgress((prev) => {
              const currentEntityProgress = prev[entityType] || {
                completed: 0,
                errors: [],
              };
              switch (entityType) {
                case 'pdfs':
                case 'images':
                  return {
                    ...prev,
                    [entityType]: {
                      ...currentEntityProgress,
                      completed: successCount,
                      errors: [
                        ...currentEntityProgress.errors,
                        ...(data.errors || []),
                      ],
                    },
                  };
                default:
                  return {
                    ...prev,
                    [entityType]: {
                      ...currentEntityProgress,
                      completed: currentEntityProgress.completed + successCount,
                      errors: [
                        ...currentEntityProgress.errors,
                        ...(data.errors || []),
                      ],
                    },
                  };
              }
            });
          };

          switch (data.type) {
            case 'batch_started':
              addLog(
                `⏳ Batch started: ${data.batchId} (${data.entityType}) - ${data.totalItems} items`,
                'info'
              );
              setProgress((prev) => {
                const currentEntity = prev[data.entityType] || {
                  total: 0,
                  completed: 0,
                  errors: [],
                };
                return {
                  ...prev,
                  [data.entityType]: {
                    ...currentEntity,
                    total: currentEntity.total + data.totalItems,
                    errors: currentEntity.errors || [],
                  },
                };
              });
              break;
            case 'batch_progress':
              addLog(
                `⏳ Batch progress: ${data.batchId} (${data.entityType}) - ${data.completedCount}/${data.totalItems} (${data.progress}%)`,
                'info'
              );
              setProgress((prev) => ({
                ...prev,
                [data.entityType]: {
                  ...prev[data.entityType],
                  completed: data.completedCount,
                },
              }));
              break;
            case 'batch_completed':
              addLog(
                `✅ Batch completed: ${data.batchId} (${data.entityType}) - ${
                  data.successCount || 0
                } items processed`,
                'success'
              );
              updateProgressCounts(
                data.entityType,
                data.successCount || 0,
                data.failureCount || 0
              );
              break;

            case 'session_completed':
              addLog(
                `🎉 All batches completed for ${data.entityType} - starting post-processing...`,
                'success'
              );
              break;

            case 'post_processing_started':
              addLog(
                `📎 Starting post-processing for images and PDFs...`,
                'info'
              );
              break;

            case 'post_processing_progress':
              addLog(
                `📎 Post-processing progress: ${data.data.processedCount}/${data.data.totalCount} (${data.data.progress}%)`,
                'info'
              );
              break;

            case 'post_processing_completed':
              const errorMsg =
                data.data.errorCount > 0
                  ? ` with ${data.data.errorCount} errors`
                  : '';
              addLog(
                `✅ Post-processing completed: ${data.data.processedCount}/${data.data.totalCount} products${errorMsg}`,
                data.data.errorCount > 0 ? 'warning' : 'success'
              );
              break;

            default:
              if (config.wsLoggingLevel !== 'off') {
                console.log(
                  'ℹ️ Unhandled WebSocket message type [' + effectId + ']:',
                  data.type,
                  data
                );
              }
              break;
          }
        } catch (parseError) {
          if (config.wsLoggingLevel !== 'off') {
            console.error(
              '❌ WebSocket message parse error [' + effectId + ']:',
              parseError,
              'Raw data:',
              event.data
            );
          }
          addLog('WebSocket received invalid message format.', 'error');
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        if (config.wsLoggingLevel !== 'off') {
          console.error('❌ WebSocket error [' + effectId + ']:', {
            error,
            url: wsUrl,
            readyState: ws.readyState,
            timestamp: new Date().toISOString(),
          });
        }
        setWsConnected(false);
        addLog(
          `WebSocket connection error: Unable to connect to ${microserviceUrl}. Please check if the microservice is running.`,
          'error'
        );
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        if (config.wsLoggingLevel !== 'off') {
          console.log('🔌 WebSocket disconnected [' + effectId + ']:', {
            code: event.code,
            reason: event.reason || 'No reason provided',
            wasClean: event.wasClean,
            timestamp: new Date().toISOString(),
          });
        }
        setWsConnected(false);

        // Only log if it was an unexpected closure
        if (event.code !== 1000) {
          addLog(
            'WebSocket connection lost. Updates may be delayed.',
            'warning'
          );
        } else if (event.code === 1000 && config.wsLoggingLevel !== 'off') {
          console.log('ℹ️ WebSocket disconnected cleanly.');
        }
      };
    } catch (error) {
      if (config.wsLoggingLevel !== 'off') {
        console.error(
          '❌ Failed to create WebSocket connection [' + effectId + ']:',
          error
        );
      }
      setWsConnected(false);
      addLog('Failed to establish WebSocket connection.', 'error');
      wsRef.current = null; // Ensure ref is cleared on error
    }

    // Cleanup function
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (config.wsLoggingLevel !== 'off') {
          console.log('🧹 Cleaning up WebSocket connection [' + effectId + ']');
        }
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [connectionEstablished, config.microserviceUrl, config.wsLoggingLevel]);

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, message, type }]);
  };

  const clearLogs = () => {
    setLogs([]);
  };

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

  const importConfiguration = (event) => {
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
          if (
            importedData.hasOwnProperty(field) &&
            (!importedData[field] || importedData[field].trim() === '')
          ) {
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
          setConnectionEstablished(false);
          setOpenAiKeyAvailable(false);

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
  };

  // Function to handle data generation
  const generateData = async (currentGenerationConfig) => {
    const handleGenerate = async (generationConfig) => {
      if (!connectionEstablished) {
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

      setIsGenerating(true);
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
              addLog(
                `Generating ${generationConfig.productCount} products...`,
                'info'
              );

              const response = await axios.post(
                config.microserviceUrl
                  ? `${config.microserviceUrl}/api/generate/products`
                  : '/api/generate/products',
                {
                  liferayUrl: config.liferayUrl,
                  clientId: config.clientId,
                  clientSecret: config.clientSecret,
                  catalogId: parseInt(config.catalogId),
                  channelId: parseInt(config.channelId),
                  currencyCode: config.currencyCode,
                  aiModel: config.aiModel,
                  batchSize: config.batchSize,
                  pollingDelay: config.pollingDelay,
                  microserviceUrl:
                    config.microserviceUrl || window.location.origin,
                  selectedLanguages: Array.isArray(config.selectedLanguages)
                    ? config.selectedLanguages
                    : [],
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
                  generateSpecifications:
                    generationConfig.generateSpecifications,
                  generateSkuVariants: generationConfig.generateSkuVariants,
                  generatePDFs: generationConfig.generatePDFs,
                  pdfRatio: generationConfig.pdfRatio,
                  useCustomImage: generationConfig.useCustomImage,
                  customImageFile: generationConfig.customImageFile,
                  useCustomPDF: generationConfig.useCustomPDF,
                  customPDFFile: generationConfig.customPDFFile,
                  demoMode: generationConfig.demoMode,
                }
              );

              if (response.data.success) {
                totalProductsCreated = response.data.count || 0;
                totalPDFsCreated = response.data.pdfCount || 0;

                if (response.data.batchId) {
                  // Batch mode - WebSocket will handle progress updates
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalProductsCreated} demo products for batch creation (Batch ID: ${response.data.batchId})`
                    : `✓ Successfully submitted ${totalProductsCreated} products for batch creation (Batch ID: ${response.data.batchId})`;
                  addLog(batchMessage, 'success');
                } else {
                  // Individual mode - immediate success
                  const productMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalProductsCreated} demo products`
                    : `✓ Successfully generated ${totalProductsCreated} products`;
                  addLog(productMessage, 'success');

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
                  addLog(pdfMessage, 'success');

                  // Update PDF progress immediately
                  setProgress((prev) => ({
                    ...prev,
                    pdfs: { ...prev.pdfs, completed: totalPDFsCreated },
                  }));
                }
              } else {
                addLog(
                  `✗ Product generation failed: ${response.data.error}`,
                  'error'
                );
                setProgress((prev) => ({
                  ...prev,
                  products: {
                    ...prev.products,
                    errors: [...prev.products.errors, response.data.error],
                  },
                }));
              }
            } catch (error) {
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
              addLog(
                `Generating ${generationConfig.accountCount} accounts...`,
                'info'
              );

              const response = await axios.post(
                config.microserviceUrl
                  ? `${config.microserviceUrl}/api/generate/accounts`
                  : '/api/generate/accounts',
                {
                  liferayUrl: config.liferayUrl,
                  clientId: config.clientId,
                  clientSecret: config.clientSecret,
                  aiModel: config.aiModel,
                  batchSize: config.batchSize,
                  pollingDelay: config.pollingDelay,
                  selectedLanguages: Array.isArray(config.selectedLanguages)
                    ? config.selectedLanguages
                    : [],
                  count: generationConfig.accountCount,
                  demoMode: generationConfig.demoMode,
                }
              );

              if (response.data.success) {
                totalAccountsCreated = response.data.count || 0;

                if (response.data.batchId) {
                  // Batch mode - WebSocket will handle progress updates
                  const batchMessage = generationConfig.demoMode
                    ? `✓ Successfully submitted ${totalAccountsCreated} demo accounts for batch creation (Batch ID: ${response.data.batchId})`
                    : `✓ Successfully submitted ${totalAccountsCreated} accounts for batch creation (Batch ID: ${response.data.batchId})`;
                  addLog(batchMessage, 'success');
                } else {
                  // Individual mode - immediate success
                  const accountMessage = generationConfig.demoMode
                    ? `✓ Successfully generated ${totalAccountsCreated} demo accounts`
                    : `✓ Successfully generated ${totalAccountsCreated} accounts`;
                  addLog(accountMessage, 'success');

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
                addLog(
                  `✗ Account generation failed: ${response.data.error}`,
                  'error'
                );
                setProgress((prev) => ({
                  ...prev,
                  accounts: {
                    ...prev.accounts,
                    errors: [...prev.accounts.errors, response.data.error],
                  },
                }));
              }
            } catch (error) {
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
          addLog(
            `Executing ${parallelTasks.length} generation tasks in parallel...`,
            'info'
          );
          await Promise.all(parallelTasks.map((task) => task()));
          addLog(`✓ Parallel generation tasks completed`, 'success');
        }

        // Step 3: Generate Orders (LAST - depends on products and accounts)
        if (generationConfig.orderCount > 0) {
          try {
            const hasProducts = generationConfig.productCount > 0;
            const hasAccounts = generationConfig.accountCount > 0;

            addLog(
              `Generating ${generationConfig.orderCount} orders...`,
              'info'
            );

            // If products or accounts were just created, wait and verify they're available
            if (hasProducts || hasAccounts) {
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
                addLog(
                  `⏳ Checking data availability (attempt ${retries}/${maxRetries})...`,
                  'info'
                );

                try {
                  // Check products availability
                  if (hasProducts && !productsAvailable) {
                    const productsCheck = await axios.post(
                      config.microserviceUrl
                        ? `${config.microserviceUrl}/api/validate/products`
                        : '/api/validate/products',
                      {
                        liferayUrl: config.liferayUrl,
                        clientId: config.clientId,
                        clientSecret: config.clientSecret,
                        requiredCount: totalProductsCreated,
                      }
                    );
                    productsAvailable = productsCheck.data.sufficient;
                    if (productsAvailable) {
                      addLog(
                        `✓ Found ${productsCheck.data.count} products available (${productsCheck.data.required} required)`,
                        'success'
                      );
                    } else {
                      addLog(
                        `⚠ Only ${productsCheck.data.count} products found, ${productsCheck.data.required} required`,
                        'info'
                      );
                    }
                  }

                  // Check accounts availability
                  if (hasAccounts && !accountsAvailable) {
                    const accountsCheck = await axios.post(
                      config.microserviceUrl
                        ? `${config.microserviceUrl}/api/validate/accounts`
                        : '/api/validate/accounts',
                      {
                        liferayUrl: config.liferayUrl,
                        clientId: config.clientId,
                        clientSecret: config.clientSecret,
                        requiredCount: totalAccountsCreated,
                      }
                    );
                    accountsAvailable = accountsCheck.data.sufficient;
                    if (accountsAvailable) {
                      addLog(
                        `✓ Found ${accountsCheck.data.count} accounts available (${accountsCheck.data.required} required)`,
                        'success'
                      );
                    } else {
                      addLog(
                        `⚠ Only ${accountsCheck.data.count} accounts found, ${accountsCheck.data.required} required`,
                        'info'
                      );
                    }
                  }

                  if (productsAvailable && accountsAvailable) {
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
              addLog(
                `Retry enabled: Dependencies were created in this session`,
                'info'
              );
            }

            const response = await axios.post(
              config.microserviceUrl
                ? `${config.microserviceUrl}/api/generate/orders`
                : '/api/generate/orders',
              {
                liferayUrl: config.liferayUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                catalogId: parseInt(config.catalogId),
                channelId: parseInt(config.channelId),
                currencyCode: config.currencyCode,
                aiModel: config.aiModel,
                batchSize: config.batchSize,
                pollingDelay: config.pollingDelay,
                selectedLanguages: Array.isArray(config.selectedLanguages)
                  ? config.selectedLanguages
                  : [],
                orderCount: generationConfig.orderCount,
                demoMode: generationConfig.demoMode,
                microserviceUrl: config.microserviceUrl,
                enableRetry: enableRetry,
              }
            );

            if (response.data.success) {
              totalOrdersCreated = response.data.count || 0;
              const orderMessage = generationConfig.demoMode
                ? `✓ Successfully generated ${totalOrdersCreated} demo orders`
                : `✓ Successfully generated ${totalOrdersCreated} orders`;
              addLog(orderMessage, 'success');
            } else {
              addLog(
                `✗ Order generation failed: ${response.data.error}`,
                'error'
              );
              setProgress((prev) => ({
                ...prev,
                orders: {
                  ...prev.orders,
                  errors: [...prev.orders.errors, response.data.error],
                },
              }));
            }
          } catch (error) {
            const errorMessage = error.response?.data?.error || error.message;

            // Check for specific validation errors that users can fix
            if (errorMessage.includes('No products available')) {
              addLog(
                '⚠️ Cannot generate orders: No products found. Orders require existing products.',
                'warning'
              );
            } else if (errorMessage.includes('No accounts available')) {
              addLog(
                '⚠️ Cannot generate orders: No accounts found. Orders require existing accounts.',
                'warning'
              );
            } else {
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
        addLog(completionMessage, 'success');
      } catch (error) {
        addLog(
          `Generation failed: ${error.response?.data?.error || error.message}`,
          'error'
        );
      } finally {
        setIsGenerating(false);
      }
    };

    handleGenerate(currentGenerationConfig);
  };

  // Function to handle connection testing and update state
  const testConnection = async () => {
    try {
      const response = await axios.get(
        config.microserviceUrl
          ? `${config.microserviceUrl}/api/health`
          : '/api/health'
      );
      if (response.status === 200) {
        setConnectionEstablished(true);
        addLog(
          'Connection to microservice established successfully.',
          'success'
        );

        // OpenAI key availability is already set from the connection test
        // No need for separate status check
      } else {
        setConnectionEstablished(false);
        setOpenAiKeyAvailable(false); // Reset OpenAI status if connection fails
        addLog('Failed to establish connection to microservice.', 'error');
      }
    } catch (error) {
      setConnectionEstablished(false);
      setOpenAiKeyAvailable(false); // Reset OpenAI status if connection fails
      addLog(
        `Connection test failed: ${
          error.response?.data?.error || error.message
        }`,
        'error'
      );
    }
  };

  const subtitle =
    fragmentConfig?.subtitle ||
    'Generate comprehensive Commerce data using AI and Liferay Headless APIs';

  return (
    <div className="container-fluid py-4">
      <div className="row">
        <div className="col-12">
          <div className="card shadow-sm">
            <div className="card-header bg-primary text-white">
              <h1 className="h3 mb-0">
                <i className="fas fa-robot me-2"></i>
                {fragmentConfig?.title ?? 'Liferay AI Commerce Accelerator'}
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
                    microserviceUrl={config.microserviceUrl}
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
