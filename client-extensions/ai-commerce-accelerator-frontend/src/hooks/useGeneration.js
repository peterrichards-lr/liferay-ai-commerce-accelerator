import { useState, useCallback } from 'react';
import { toFormData } from '../utils/formData';
import { computeTotalsFromConfig } from '../state/progressSelectors';

export default function useGeneration({
  addLog,
  buildPayload,
  api,
  config,
  dispatch,
  forceDemoMode,
  generationConfig,
  mountedRef,
  progress,
  setProgress,
  setGenerationCompleted,
  connectionEstablished,
}) {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateData = useCallback(async () => {
    if (!connectionEstablished) {
      addLog(
        'Please test the connection first before generating data.',
        'error'
      );
      return;
    }

    if (mountedRef.current) setIsGenerating(true);

    const { products, accounts, orders, images, pdfs } =
      computeTotalsFromConfig(generationConfig);

    dispatch({
      type: 'SET_TOTALS',
      totals: {
        products,
        accounts,
        orders,
        images,
        pdfs,
      },
    });

    dispatch({
      type: 'SET_EXPECTED_VALUES',
      values: {
        images,
        pdfs,
      },
    });

    dispatch({
      type: 'MERGE',
      payload: {
        products: { ...progress.products, completed: 0, errors: [] },
        accounts: { ...progress.accounts, completed: 0, errors: [] },
        orders: { ...progress.orders, completed: 0, errors: [] },
        images: { ...progress.images, completed: 0, errors: [] },
        pdfs: { ...progress.pdfs, completed: 0, errors: [] },
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
              productCount: generationConfig.productCount,
              productCategories: generationConfig.categories,
              generatePriceLists: generationConfig.generatePriceLists,
              generateBulkPricing: generationConfig.generateBulkPricing,
              generateTierPricing: generationConfig.generateTierPricing,
              imageMode: generationConfig.imageMode,
              imageRatio: generationConfig.imageRatio,
              customImageFile: generationConfig.customImageFile,
              imageWidth: generationConfig.imageWidth,
              imageHeight: generationConfig.imageHeight,
              imageQuality: generationConfig.imageQuality,
              imageStyle: generationConfig.imageStyle,
              generateSpecifications: generationConfig.generateSpecifications,
              generateSkuVariants: generationConfig.generateSkuVariants,
              pdfMode: generationConfig.pdfMode,
              pdfRatio: generationConfig.pdfRatio,
              customPdfFile: generationConfig.customPdfFile,
              demoMode: generationConfig.demoMode,
              createWarehouses: !!generationConfig.createWarehouses,
              reuseExistingWarehouses:
                !!generationConfig.reuseExistingWarehouses,
              inventoryMin: Number.isFinite(generationConfig.inventoryMin)
                ? generationConfig.inventoryMin
                : 0,
              inventoryMax: Number.isFinite(generationConfig.inventoryMax)
                ? generationConfig.inventoryMax
                : 0,
              inventoryAssignmentRatio: Number.isFinite(
                generationConfig.inventoryAssignmentRatio
              )
                ? generationConfig.inventoryAssignmentRatio
                : 0,
              warehouseCount: Number.isFinite(generationConfig.warehouseCount) ? generationConfig.warehouseCount : 0,
              enableBackorders: !!generationConfig.enableBackorders,
              backorderAssignmentRatio: Number.isFinite(
                generationConfig.backorderAssignmentRatio
              )
                ? generationConfig.backorderAssignmentRatio
                : 0,
            };
            if (forceDemoMode) {
              basePayload.demoMode = true;
              if (basePayload.imageMode === 'generate')
                basePayload.imageMode = 'default';
              if (basePayload.pdfMode === 'generate')
                basePayload.pdfMode = 'default';
            }
            const imageFile =
              generationConfig.imageMode === 'custom'
                ? generationConfig.customImageFile
                : null;
            const pdfFile =
              generationConfig.pdfMode === 'custom'
                ? generationConfig.customPDFFile
                : null;
            let response;
            if (imageFile || pdfFile) {
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
              totalImagesCreated = response.imageCount || 0;
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
              if (
                generationConfig.imageMode === 'generate' &&
                totalImagesCreated > 0
              ) {
                const imageMessage = `✓ Generated ${totalImagesCreated} product images`;
                if (mountedRef.current) addLog(imageMessage, 'success');
                setProgress((prev) => ({
                  ...prev,
                  images: { ...prev.images, completed: totalImagesCreated },
                }));
              }
              if (
                generationConfig.pdfMode === 'generate' &&
                totalPDFsCreated > 0
              ) {
                const pdfMessage = `✓ Generated ${totalPDFsCreated} product PDFs`;
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
              accountCount: generationConfig.accountCount,
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
                setProgress((prev) => {
                  const total = prev.accounts?.total ?? Infinity;
                  const nextCompleted = Math.max(
                    prev.accounts?.completed || 0,
                    totalAccountsCreated || 0
                  );
                  return {
                    ...prev,
                    accounts: {
                      ...prev.accounts,
                      completed: Math.min(nextCompleted, total),
                    },
                  };
                });
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
              retries < config.pollingRetries
            ) {
              retries++;
              if (mountedRef.current)
                addLog(
                  `⏳ Checking data availability (attempt ${retries}/${config.pollingRetries})...`,
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
                  accountsAvailable = accountsCheck.sufficient;
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
      if (mountedRef.current) {
        setIsGenerating(false);
        setGenerationCompleted(true);
      }
    }
  }, [
    addLog,
    api,
    buildPayload,
    config,
    connectionEstablished,
    dispatch,
    forceDemoMode,
    generationConfig,
    mountedRef,
    progress,
    setProgress,
  ]);

  return { isGenerating, generateData };
}
