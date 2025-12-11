const { createERC, toI18n, resolvePhaseAndMode } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class WarehouseGenerator {
  constructor(ctx) {
    this.ctx = ctx;
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
    const { logger, ai, mockData, ws, liferay, batchPolling, configService } = this.ctx;
    const { warehouseCount, demoMode } = options;
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

    const useBatch = warehouseCount > 1; // Assuming batch for more than 1 warehouse
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
      });

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      const submission = await liferay.createWarehousesBatch(config, normalizedWarehouseDataList, null, {
        externalReferenceCode: batchERC,
      });

      const batchId = submission.batchId;
      const totalItems = normalizedWarehouseDataList.length;

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
            const progress = totalItems > 0 ? Math.round((processed / totalItems) * 100) : 0;
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
                etaSeconds: 0, // Liferay batch engine should provide this
              },
              { correlationId }
            );
          },
          onComplete: (r) => {
            ws.emitBatchProgress( // <-- Add this
              {
                entityType,
                operation: 'generate',
                mode: 'batch',
                phase: 'poll',
                batchId: batchId,
                batchERC,
                completedCount: r.processedCount,
                totalItems: totalItems,
                progress: 100,
                etaSeconds: 0,
              },
              { correlationId }
            );
            ws.emitBatchCompleted(
              {
                batchId,
                entityType,
                successCount: r.processedCount,
                failureCount: r.errorCount,
                errors: [],
                operation,
                mode: 'batch',
                phase: 'complete',
                externalReferenceCode: batchERC,
              },
              { correlationId }
            );
            logger.info('Batch warehouse creation completed via polling', {
              correlationId,
              operation: 'warehouses/generate:complete',
              created: r.processedCount,
              errors: r.errorCount,
              mode: 'batch',
            });
          },
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
}

module.exports = WarehouseGenerator;
