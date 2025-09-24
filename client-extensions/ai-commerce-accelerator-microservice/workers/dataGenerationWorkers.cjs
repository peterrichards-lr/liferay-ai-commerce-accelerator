const productGenerator = require('../services/productGenerator.cjs');
const accountGenerator = require('../services/accountGenerator.cjs');
const orderGenerator = require('../services/orderGenerator.cjs');
const { MockDataGenerator } = require('../services/mockDataGenerator.cjs');
const { logger } = require('../utils/logger.cjs');
const { queueService } = require('../services/queueService.cjs');

// Register data generation workers
function registerDataGenerationWorkers() {
  // Product generation worker
  queueService.registerWorker(
    'generate-products',
    async (data, { job, updateProgress }) => {
      const { config, options, correlationId } = data;

      logger.info('Starting async product generation', {
        correlationId,
        operation: 'async-generate-products',
        jobId: job.id,
        productCount: options.count,
      });

      updateProgress(5);

      let result;
      if (options.demoMode) {
        const mockGenerator = new MockDataGenerator();
        result = await mockGenerator.generateProducts(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      } else {
        result = await productGenerator.generateProducts(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      }

      updateProgress(100);

      logger.success('Async product generation completed', {
        correlationId,
        operation: 'async-generate-products',
        jobId: job.id,
        created: result.created,
        errors: result.errors?.length || 0,
      });

      return {
        success: true,
        count: result.created,
        errors: result.errors || [],
        data: result.products || [],
      };
    }
  );

  // Account generation worker
  queueService.registerWorker(
    'generate-accounts',
    async (data, { job, updateProgress }) => {
      const { config, options, correlationId } = data;

      logger.info('Starting async account generation', {
        correlationId,
        operation: 'async-generate-accounts',
        jobId: job.id,
        accountCount: options.count,
      });

      updateProgress(5);

      let result;
      if (options.demoMode) {
        const mockGenerator = new MockDataGenerator();
        result = mockGenerator.generateAccountData(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      } else {
        result = await accountGenerator.generateAccounts(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      }

      updateProgress(100);

      logger.success('Async account generation completed', {
        correlationId,
        operation: 'async-generate-accounts',
        jobId: job.id,
        created: result.created,
        errors: result.errors?.length || 0,
      });

      return {
        success: true,
        count: result.created,
        errors: result.errors || [],
        data: result.accounts || [],
      };
    }
  );

  // Order generation worker
  queueService.registerWorker(
    'generate-orders',
    async (data, { job, updateProgress }) => {
      const { config, options, correlationId } = data;

      logger.info('Starting async order generation', {
        correlationId,
        operation: 'async-generate-orders',
        jobId: job.id,
        orderCount: options.count,
      });

      updateProgress(5);

      let result;
      if (options.demoMode) {
        const mockGenerator = new MockDataGenerator();
        result = await mockGenerator.generateOrders(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      } else {
        result = await orderGenerator.generateOrders(config, {
          ...options,
          onProgress: (progress) => updateProgress(5 + progress * 0.9),
        });
      }

      updateProgress(100);

      logger.success('Async order generation completed', {
        correlationId,
        operation: 'async-generate-orders',
        jobId: job.id,
        created: result.created,
        errors: result.errors?.length || 0,
      });

      return {
        success: true,
        count: result.created,
        errors: result.errors || [],
        data: result.orders || [],
      };
    }
  );

  // Comprehensive data generation worker (combines all types)
  queueService.registerWorker(
    'generate-comprehensive-data',
    async (data, { job, updateProgress }) => {
      const {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        aiModel,
        productCount,
        accountCount,
        orderCount,
        productCategories,
        generatePriceLists,
        generateBulkPricing,
        generateTierPricing,
        generateAttachments,
        generateSpecifications,
        generateSkuVariants,
        generatePDFs,
        pdfRatio,
        batchSize,
        demoMode,
        correlationId,
      } = data;

      logger.info('Starting comprehensive data generation', {
        correlationId,
        operation: 'async-comprehensive-generation',
        jobId: job.id,
        productCount,
        accountCount,
        orderCount,
        demoMode: !!demoMode,
      });

      const config = {
        liferayUrl,
        clientId,
        clientSecret,
        catalogId,
        channelId,
        currencyCode,
        aiModel: aiModel || 'gpt-4o',
      };

      const results = {
        products: { created: 0, errors: [] },
        accounts: { created: 0, errors: [] },
        orders: { created: 0, errors: [] },
        pdfs: { created: 0, errors: [] },
      };

      let currentProgress = 0;
      const totalSteps =
        (productCount > 0 ? 1 : 0) +
        (accountCount > 0 ? 1 : 0) +
        (orderCount > 0 ? 1 : 0);
      const stepProgress = 90 / totalSteps;

      updateProgress(5);

      try {
        // Generate products
        if (productCount > 0) {
          const productOptions = {
            count: productCount,
            categories: productCategories,
            generatePriceLists,
            generateBulkPricing,
            generateTierPricing,
            generateAttachments,
            generateSpecifications,
            generateSkuVariants,
            generatePDFs,
            pdfRatio: pdfRatio || 0,
            batchSize: batchSize || 5,
            demoMode,
            onProgress: (progress) =>
              updateProgress(
                5 + (currentProgress + (progress * stepProgress) / 100)
              ),
          };

          if (demoMode) {
            const mockGenerator = new MockDataGenerator();
            results.products = await mockGenerator.generateProducts(
              config,
              productOptions
            );
          } else {
            results.products = await productGenerator.generateProducts(
              config,
              productOptions
            );
          }

          currentProgress += stepProgress;
          updateProgress(5 + currentProgress);
        }

        // Generate accounts
        if (accountCount > 0) {
          const accountOptions = {
            count: accountCount,
            batchSize: batchSize || 5,
            demoMode,
            onProgress: (progress) =>
              updateProgress(
                5 + (currentProgress + (progress * stepProgress) / 100)
              ),
          };

          if (demoMode) {
            const mockGenerator = new MockDataGenerator();
            results.accounts = await mockGenerator.generateAccounts(
              config,
              accountOptions
            );
          } else {
            results.accounts = await accountGenerator.generateAccounts(
              config,
              accountOptions
            );
          }

          currentProgress += stepProgress;
          updateProgress(5 + currentProgress);
        }

        // Generate orders
        if (orderCount > 0) {
          const orderOptions = {
            count: orderCount,
            batchSize: batchSize || 5,
            demoMode,
            onProgress: (progress) =>
              updateProgress(
                5 + (currentProgress + (progress * stepProgress) / 100)
              ),
          };

          if (demoMode) {
            const mockGenerator = new MockDataGenerator();
            results.orders = await mockGenerator.generateOrders(
              config,
              orderOptions
            );
          } else {
            results.orders = await orderGenerator.generateOrders(
              config,
              orderOptions
            );
          }

          currentProgress += stepProgress;
          updateProgress(5 + currentProgress);
        }
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId,
          operation: 'async-comprehensive-generation',
          jobId: job.id,
        });
        throw error;
      }

      updateProgress(100);

      const totalCreated =
        results.products.created +
        results.accounts.created +
        results.orders.created;
      const totalErrors =
        (results.products.errors?.length || 0) +
        (results.accounts.errors?.length || 0) +
        (results.orders.errors?.length || 0);

      logger.success('Comprehensive data generation completed', {
        correlationId,
        operation: 'async-comprehensive-generation',
        jobId: job.id,
        totalCreated,
        totalErrors,
        products: results.products.created,
        accounts: results.accounts.created,
        orders: results.orders.created,
      });

      return {
        success: true,
        results,
        summary: {
          totalCreated,
          totalErrors,
          breakdown: {
            products: results.products.created,
            accounts: results.accounts.created,
            orders: results.orders.created,
            pdfs: results.pdfs.created,
          },
        },
      };
    }
  );

  logger.info('Data generation workers registered', {
    operation: 'workers-register',
    workers: [
      'generate-products',
      'generate-accounts',
      'generate-orders',
      'generate-comprehensive-data',
    ],
  });
}

module.exports = { registerDataGenerationWorkers };
