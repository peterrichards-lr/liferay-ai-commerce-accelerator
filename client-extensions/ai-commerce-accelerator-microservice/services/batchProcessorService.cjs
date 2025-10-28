const liferayConfig = require('../config/liferayConfig.cjs');
const { ErrorHandler } = require('../utils/errorHandler.cjs');
const { delay } = require('../utils/misc.cjs');

class BatchProcessorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async processBatch(
    items,
    processingFunction,
    batchSize = liferayConfig.batchConfig.defaultBatchSize,
    options = {}
  ) {
    const { logger } = this.ctx;
    const { operation } = options;
    logger.trace(
      `Processing ${items.length} items in batches of ${batchSize}${
        operation ? ` [op=${operation}]` : ''
      }`
    );

    const results = {
      operation: operation || undefined,
      successful: [],
      errors: [],
      total: items.length,
      processed: 0,
    };

    const actualBatchSize = Math.min(
      Math.max(1, batchSize),
      liferayConfig.batchConfig.maxBatchSize
    );

    for (let i = 0; i < items.length; i += actualBatchSize) {
      const batch = items.slice(i, i + actualBatchSize);
      logger.trace(
        `Processing batch ${Math.floor(i / actualBatchSize) + 1} (${
          batch.length
        } items)${operation ? ` [op=${operation}]` : ''}`
      );

      const batchResults = await this.processBatchConcurrently(
        batch,
        processingFunction
      );

      results.successful.push(...batchResults.successful);
      results.errors.push(...batchResults.errors);
      results.processed += batch.length;

      if (ErrorHandler.shouldStopBatch(results.errors)) {
        logger.warn(
          `Stopping batch processing due to ${results.errors.length} errors${
            operation ? ` [op=${operation}]` : ''
          }`
        );
        break;
      }

      if (i + actualBatchSize < items.length) {
        await delay(liferayConfig.batchConfig.batchDelay);
      }
    }

    logger.trace(
      `Batch processing completed: ${results.successful.length} successful, ${
        results.errors.length
      } errors${operation ? ` [op=${operation}]` : ''}`
    );
    return results;
  }

  async processBatchConcurrently(batch, processingFunction) {
    const { logger } = this.ctx;
    const results = {
      successful: [],
      errors: [],
    };

    const promises = batch.map(async (item, index) => {
      try {
        const result = await this.processWithRetry(item, processingFunction);
        return { success: true, result, index };
      } catch (error) {
        logger.error(`Failed to process item ${index}:`, error);
        return {
          success: false,
          error: error.message || error.toString(),
          index,
          item,
        };
      }
    });

    const batchResults = await Promise.allSettled(promises);

    batchResults.forEach((promiseResult) => {
      if (promiseResult.status === 'fulfilled') {
        const { success, result, error, index, item } = promiseResult.value;
        if (success) {
          results.successful.push(result);
        } else {
          results.errors.push({ error, index, item });
        }
      } else {
        results.errors.push({
          error: promiseResult.reason?.message || 'Unknown error',
          index: -1,
          item: null,
        });
      }
    });

    return results;
  }

  async processWithRetry(
    item,
    processingFunction,
    maxRetries = liferayConfig.requestConfig.maxRetries
  ) {
    const { logger } = this.ctx;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await processingFunction(item);
      } catch (error) {
        lastError = error;

        if (!ErrorHandler.isRetryableError(error) || attempt === maxRetries) {
          throw error;
        }

        const retryDelay = liferayConfig.requestConfig.retryDelay * attempt;
        logger.warn(
          `Attempt ${attempt} failed, retrying in ${retryDelay}ms:`,
          error.message
        );
        await delay(retryDelay);
      }
    }

    throw lastError;
  }

  async processSequentially(items, processingFunction, options = {}) {
    const { logger } = this.ctx;
    const { operation } = options;
    logger.trace(
      `Processing ${items.length} items sequentially${
        operation ? ` [op=${operation}]` : ''
      }`
    );

    const results = {
      operation: operation || undefined,
      successful: [],
      errors: [],
      total: items.length,
      processed: 0,
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        const result = await this.processWithRetry(item, processingFunction);
        results.successful.push(result);
        logger.trace(
          `Processed item ${i + 1}/${items.length} successfully${
            operation ? ` [op=${operation}]` : ''
          }`
        );
      } catch (error) {
        logger.error(`Failed to process item ${i + 1}/${items.length}:`, error);
        results.errors.push({
          error: error.message || error.toString(),
          index: i,
          item,
        });

        if (ErrorHandler.shouldStopBatch(results.errors)) {
          logger.warn(
            `Stopping sequential processing due to ${
              results.errors.length
            } errors${operation ? ` [op=${operation}]` : ''}`
          );
          break;
        }
      }

      results.processed++;

      if (i < items.length - 1) {
        await delay(100);
      }
    }

    logger.trace(
      `Sequential processing completed: ${
        results.successful.length
      } successful, ${results.errors.length} errors${
        operation ? ` [op=${operation}]` : ''
      }`
    );
    return results;
  }

  // Helper method to split array into chunks
  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Progress tracking callback support
  async processBatchWithProgress(
    items,
    processingFunction,
    batchSize,
    progressCallback,
    options = {}
  ) {
    const { logger } = this.ctx;
    const { operation } = options;
    logger.trace(
      `Processing ${items.length} items with progress tracking${
        operation ? ` [op=${operation}]` : ''
      }`
    );

    const results = {
      operation: operation || undefined,
      successful: [],
      errors: [],
      total: items.length,
      processed: 0,
    };

    const actualBatchSize = Math.min(
      Math.max(1, batchSize),
      liferayConfig.batchConfig.maxBatchSize
    );

    for (let i = 0; i < items.length; i += actualBatchSize) {
      const batch = items.slice(i, i + actualBatchSize);

      const batchResults = await this.processBatchConcurrently(
        batch,
        processingFunction
      );

      results.successful.push(...batchResults.successful);
      results.errors.push(...batchResults.errors);
      results.processed += batch.length;

      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback({
          operation: operation || undefined,
          processed: results.processed,
          total: results.total,
          successful: results.successful.length,
          errors: results.errors.length,
          percentage: Math.round((results.processed / results.total) * 100),
        });
      }

      if (ErrorHandler.shouldStopBatch(results.errors)) {
        break;
      }

      if (i + actualBatchSize < items.length) {
        await delay(liferayConfig.batchConfig.batchDelay);
      }
    }

    return results;
  }
}

module.exports = BatchProcessorService;
