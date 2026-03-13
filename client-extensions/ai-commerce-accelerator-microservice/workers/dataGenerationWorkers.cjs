module.exports = function registerDataGenerationWorkers({
  queue,
  logger,
  productGenerator,
  accountGenerator,
  orderGenerator,
}) {
  queue.registerWorker(
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

      const result = await productGenerator.generateProducts(config, {
        ...options,
        onProgress: (progress) => updateProgress(5 + progress * 0.9),
      });

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

  queue.registerWorker(
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

      const result = await accountGenerator.generateAccounts(config, {
        ...options,
        onProgress: (progress) => updateProgress(5 + progress * 0.9),
      });

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

  queue.registerWorker(
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

      const result = await orderGenerator.generateOrders(config, {
        ...options,
        onProgress: (progress) => updateProgress(5 + progress * 0.9),
      });

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

  queue.registerWorker(
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
      const stepProgress = totalSteps > 0 ? 90 / totalSteps : 90;

      updateProgress(5);

      try {
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

          results.products = await productGenerator.generateProducts(
            config,
            productOptions
          );

          currentProgress += stepProgress;
          updateProgress(5 + currentProgress);
        }

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

          results.accounts = await accountGenerator.generateAccounts(
            config,
            accountOptions
          );

          currentProgress += stepProgress;
          updateProgress(5 + currentProgress);
        }

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

          results.orders = await orderGenerator.generateOrders(
            config,
            orderOptions
          );

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
        (results.products.created || 0) +
        (results.accounts.created || 0) +
        (results.orders.created || 0);
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
};
