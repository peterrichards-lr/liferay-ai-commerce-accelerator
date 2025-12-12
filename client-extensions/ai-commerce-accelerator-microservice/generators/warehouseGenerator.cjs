const { createERC, toI18n, resolvePhaseAndMode } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { getBatchCacheTTLms } = require('../utils/ttl.cjs');

class WarehouseGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.handleBatchComplete = this.handleBatchComplete.bind(this);
  }

  _normalizeWarehouseData(warehouseData, config) {
    const name = toI18n(warehouseData.name, config.localeCode);
    const description = toI18n(warehouseData.description, config.localeCode);

    const countryISOCode = warehouseData.country?.substring(0, 2).toUpperCase();
    const regionISOCode = warehouseData.region?.substring(0, 2).toUpperCase();

    const { country, region, ...rest } = warehouseData;

    return {
      ...rest,
      name,
      description,
      countryISOCode,
      regionISOCode,
      latitude: Math.random() * 180 - 90,
      longitude: Math.random() * 360 - 180,
      externalReferenceCode:
        rest.externalReferenceCode || createERC(ERC_PREFIX.WAREHOUSE),
    };
  }

  async createWarehouses(config, options) {
    const { logger, ai, mockData, ws, liferay, batchPolling, cache } =
      this.ctx;
    const { warehouseCount, demoMode, sessionId } = options;
    const correlationId = config?.correlationId || '∅';

    let warehouseDataList;
    if (demoMode) {
      warehouseDataList = mockData.generateWarehouseData(warehouseCount);
    } else {
      warehouseDataList = await ai.generateWarehouseData(
        warehouseCount,
        config,
        config.aiModel
      );
    }

    const useBatch = warehouseCount > 1;
    const entityType = 'warehouses';
    const operation = 'generate';
    const { mode, phase } = resolvePhaseAndMode({
      useBatch: useBatch,
      phase: 'generate',
    });

    if (useBatch) {
      const batchERC = createERC(ERC_PREFIX.WAREHOUSE_BATCH);
      logger.info('Starting batch warehouse creation', {
        correlationId,
        operation: 'warehouses/generate:start',
        mode: 'batch',
        phase: 'generate',
        warehouseCount,
        batchSize: config.batchSize,
        sessionId,
      });

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      const submission = await liferay.createWarehousesBatch(
        config,
        normalizedWarehouseDataList,
        null,
        {
          externalReferenceCode: batchERC,
        }
      );

      const batchId = submission.batchId;
      const totalItems = normalizedWarehouseDataList.length;

      if (sessionId) {
        batchPolling.registerSession(sessionId, {
          batchIds: [batchId],
          totalExpected: 1,
        });
      }

      batchPolling.startPolling(
        batchId,
        {
          liferayUrl: config.liferayUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          localeCode: config.localeCode,
          entityType: entityType,
        },
        {
          pollInterval: config.pollingDelay,
          maxPollAttempts: config.pollingRetries,
          externalReferenceCode: batchERC,
          onStatusChange: (status) => {
            const processed = status.processedCount || 0;
            const progress =
              totalItems > 0 ? Math.round((processed / totalItems) * 100) : 0;
            ws.emitBatchProgress(
              {
                entityType,
                operation: 'generate',
                mode: 'batch',
                phase: 'poll',
                batchId: status.batchId,
                batchERC,
                completedCount: processed,
                totalItems: totalItems,
                progress: progress,
                etaSeconds: 0,
                sessionId,
              },
              { correlationId }
            );
          },
          onComplete: (r) => this.handleBatchComplete(r, config),
          onError: (err) => {
            ws.emitBatchFailed(
              {
                batchId,
                entityType,
                error: err.message,
                successCount: 0,
                failureCount: 1,
                operation,
                mode: 'batch',
                phase: 'error',
                externalReferenceCode: batchERC,
                sessionId,
              },
              { correlationId }
            );
            ws.emitError({
              correlationId,
              batchId,
              entityType,
              message: err.message || 'Batch warehouse creation error',
              phase: 'batch-polling',
              errorReference: err.errorReference,
              operation,
              details: { status: 'FAILED' },
            });
            logger.error('Batch warehouse creation failed via polling', {
              correlationId,
              operation: 'warehouses/generate:error',
              error: err.message,
              mode: 'batch',
            });
          },
          entityType: entityType,
          operation: 'generate',
          mode: 'batch',
          affectsProgress: true,
        }
      );

      return submission.batchRefs;
    } else {
      const batchId = 'warehouses-individual';

      if (ws && typeof ws.emitBatchStarted === 'function') {
        ws.emitBatchStarted(
          {
            batchId,
            entityType,
            totalItems: warehouseDataList.length,
            operation,
            mode,
            phase,
            sessionId,
          },
          { correlationId }
        );
      }

      const createdWarehouses = [];
      const errors = [];

      for (let index = 0; index < warehouseDataList.length; index++) {
        const warehouse = warehouseDataList[index];
        try {
          const normalizedWarehouse = this._normalizeWarehouseData(
            warehouse,
            config
          );
          const createdWarehouse = await liferay.createWarehouse(
            config,
            normalizedWarehouse
          );
          createdWarehouses.push(createdWarehouse);
        } catch (error) {
          errors.push({ index, error: error.message });
          logger.error('Warehouse creation failed', {
            correlationId,
            operation: 'warehouses/create:error',
            error: error.message,
            index,
          });
        }

        const processed = index + 1;
        if (ws && typeof ws.emitBatchProgress === 'function') {
          const totalItems = warehouseDataList.length;
          const progress =
            totalItems > 0 ? Math.round((processed / totalItems) * 100) : 0;

          ws.emitBatchProgress(
            {
              batchId,
              entityType,
              completedCount: processed,
              totalItems,
              progress,
              operation,
              mode,
              phase,
              sessionId,
            },
            { correlationId }
          );
        }
      }

      if (ws && typeof ws.emitBatchCompleted === 'function') {
        ws.emitBatchCompleted(
          {
            batchId,
            entityType,
            successCount: createdWarehouses.length,
            failureCount: errors.length,
            errors,
            operation,
            mode,
            phase,
            sessionId,
          },
          { correlationId }
        );
      }

      logger.info('Warehouse creation completed', {
        correlationId,
        operation: 'warehouses/generate:complete',
        created: createdWarehouses.length,
        errors: errors.length,
        mode,
        phase,
      });

      return createdWarehouses;
    }
  }

  handleBatchComplete(results, config) {
    const { logger, ws, cache, configService } = this.ctx;

    const bid = String(results.batchId || '');
    cache.set(
      `batch:${bid}:completed`,
      true,
      getBatchCacheTTLms(configService)
    );

    const meta = cache.get(`batch:${bid}:meta`) || {};
    const { batchERC, sessionId } = meta;

    logger.info('Handling batch completion for warehouses', {
      entityType: 'warehouses',
      operation: 'generate',
      ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
      batchId: bid,
      batchERC,
      sessionId,
      status: results.status,
      processedCount: results.processedCount,
      totalCount: results.totalCount,
    });

    const content = results.content;
    let successCount = 0;
    let failureCount = 0;
    const failures = [];

    if (Array.isArray(content)) {
      content.forEach((item, index) => {
        if (item.status === 'SUCCESS' || item.status === 'CREATED') {
          successCount++;
        } else {
          failureCount++;
          failures.push({
            index,
            error: item.error || item.message || 'Unknown error',
          });
        }
      });
    } else {
      successCount = results.processedCount || results.totalCount || 0;
    }

    ws.emitBatchCompleted(
      {
        entityType: 'warehouses',
        operation: 'generate',
        ...resolvePhaseAndMode({ useBatch: true, phase: 'complete' }),
        batchId: bid,
        batchERC,
        sessionId,
        successCount,
        failureCount,
        errors: failureCount > 0 ? failures.slice(0, 5) : [],
      },
      { correlationId: config.correlationId }
    );
  }
}

module.exports = WarehouseGenerator;