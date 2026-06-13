const { ErrorHandler } = require('../utils/errorHandler.cjs');
const { delay, processWithRetry } = require('../utils/misc.cjs');
const { ENV } = require('../utils/constants.cjs');

class BatchProcessorService {
  constructor(ctx) {
    this.ctx = ctx;
  }

  normalizeBroadcastMeta(meta) {
    if (!meta || typeof meta !== 'object') return {};
    return {
      batchId: meta.batchId ?? 'unknown',
      entityType: meta.entityType ?? 'unknown',
      operation: meta.operation ?? 'unknown',
      phase: meta.phase ?? 'unknown',
      correlationId: meta.correlationId ?? 'none',
    };
  }

  getNormalizedMeta(meta, failureCount = 0) {
    const base = this.normalizeBroadcastMeta(meta, failureCount);
    try {
      const ws = this.ctx?.ws;
      const liveCount = Number(ws?.totalClients?.() || 0);
      return { ...base, totalClients: liveCount || base.totalClients || 0 };
    } catch {
      return base;
    }
  }

  async processBatch(items, processingFunction, batchSize = 10, options = {}) {
    const { logger } = this.ctx;
    const { operation, broadcastMeta } = options;

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
      meta: this.getNormalizedMeta(broadcastMeta, 0),
    };

    const actualBatchSize = Math.min(Math.max(1, batchSize), 100);

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
      results.meta = this.getNormalizedMeta(
        broadcastMeta,
        results.errors.length
      );

      if (ErrorHandler.shouldStopBatch(results.errors)) {
        logger.warn(
          `Stopping batch processing due to ${results.errors.length} errors${
            operation ? ` [op=${operation}]` : ''
          }`
        );
        break;
      }

      if (i + actualBatchSize < items.length) {
        await delay(100);
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
    const results = { successful: [], errors: [] };

    const promises = batch.map(async (item, index) => {
      try {
        const result = await processWithRetry(
          this.ctx,
          item,
          processingFunction
        );
        return { success: true, result, index };
      } catch (error) {
        logger.error(`Failed to process item ${index}:`, error);
        return {
          success: false,
          error: error.message || String(error),
          index,
          item,
        };
      }
    });

    const settled = await Promise.allSettled(promises);

    settled.forEach((p) => {
      if (p.status === 'fulfilled') {
        const { success, result, error, index, item } = p.value;
        if (success) results.successful.push(result);
        else results.errors.push({ error, index, item });
      } else {
        results.errors.push({
          error: p.reason?.message || 'Unknown error',
          index: -1,
          item: null,
        });
      }
    });

    return results;
  }

  async processSequentially(items, processingFunction, options = {}) {
    const { logger } = this.ctx;
    const { operation, broadcastMeta } = options;

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
      meta: this.getNormalizedMeta(broadcastMeta, 0),
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      try {
        const result = await processWithRetry(
          this.ctx,
          item,
          processingFunction
        );
        results.successful.push(result);
        logger.trace(
          `Processed item ${i + 1}/${items.length} successfully${
            operation ? ` [op=${operation}]` : ''
          }`
        );
      } catch (error) {
        logger.error(`Failed to process item ${i + 1}/${items.length}:`, error);
        results.errors.push({
          error: error.message || String(error),
          index: i,
          item,
        });

        if (
          ErrorHandler.shouldStopBatch(
            results.errors,
            ENV.LIFERAY_MAX_BATCH_ERRORS || 3
          )
        ) {
          logger.warn(
            `Stopping sequential processing due to ${
              results.errors.length
            } errors${operation ? ` [op=${operation}]` : ''}`
          );
          break;
        }
      }

      results.processed++;
      results.meta = this.getNormalizedMeta(
        broadcastMeta,
        results.errors.length
      );

      if (i < items.length - 1) {
        await delay(10);
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

  chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  async processBatchWithProgress(
    items,
    processingFunction,
    batchSize,
    progressCallback,
    options = {}
  ) {
    const { logger } = this.ctx;
    const { operation, broadcastMeta } = options;

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
      meta: this.getNormalizedMeta(broadcastMeta, 0),
    };

    const actualBatchSize = Math.min(Math.max(1, batchSize), 100);

    for (let i = 0; i < items.length; i += actualBatchSize) {
      const batch = items.slice(i, i + actualBatchSize);

      const batchResults = await this.processBatchConcurrently(
        batch,
        processingFunction
      );

      results.successful.push(...batchResults.successful);
      results.errors.push(...batchResults.errors);
      results.processed += batch.length;
      results.meta = this.getNormalizedMeta(
        broadcastMeta,
        results.errors.length
      );

      if (progressCallback && typeof progressCallback === 'function') {
        progressCallback({
          operation: operation || undefined,
          processed: results.processed,
          total: results.total,
          successful: results.successful.length,
          errors: results.errors.length,
          percentage: Math.round((results.processed / results.total) * 100),
          meta: results.meta,
        });
      }

      if (ErrorHandler.shouldStopBatch(results.errors)) {
        break;
      }

      if (i + actualBatchSize < items.length) {
        await delay(100);
      }
    }

    return results;
  }
}

module.exports = BatchProcessorService;
