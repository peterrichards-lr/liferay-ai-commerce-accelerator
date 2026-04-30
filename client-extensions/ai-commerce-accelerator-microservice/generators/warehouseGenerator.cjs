const BaseGenerator = require('./baseGenerator.cjs');
const { createERC, toI18n, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

/**
 * WarehouseGenerator - Specialized orchestrator for warehouse generation.
 */
class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.GENERATE_WAREHOUSE_DATA]:
        this._runWarehouseDataGenerationStep.bind(this),
      [S.CREATE_WAREHOUSES]: this._runWarehouseCreationStep.bind(this),
      [S.RESOLVE_WAREHOUSE_IDS]: this._runResolveWarehouseIdsStep.bind(this),
      [S.LINK_WAREHOUSE_CHANNELS]: this._runLinkWarehouseChannelsStep.bind(this),
    };
  }

  async _runResolveWarehouseIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, warehouseDataList } = session.context;
    const warehouses = warehouseDataList || options?.warehouses || [];

    if (!warehouses || warehouses.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_WAREHOUSE_IDS,
        'BYPASSED'
      );
    }

    try {
      const ercs = warehouses
        .map((w) => w.externalReferenceCode || w.erc)
        .filter((erc) => erc && !erc.includes('-BATCH-'));

      const resolvedItems = await this.liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) =>
          this.liferay.getWarehousesByERC(cfg, e, [
            'id',
            'externalReferenceCode',
          ]),
        { label: 'warehouses' }
      );

      const normalized = this._normalize(resolvedItems);
      const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

      const updatedWarehouses = warehouses.map((w) => ({
        ...w,
        id: ercToIdMap.get(w.externalReferenceCode || w.erc) || w.id,
      }));

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        warehouseDataList: updatedWarehouses,
        options: { ...options, warehouses: updatedWarehouses },
      });

      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_WAREHOUSE_IDS,
        'SYNCHRONOUS',
        updatedWarehouses.filter((w) => w.id).length,
        ercs.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to resolve warehouse IDs', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.RESOLVE_WAREHOUSE_IDS,
        status: 'FAILED',
      });
    }
  }

  /**
   * Standalone entry point for warehouse generation.
   */
  async runWorkflow(config, options) {
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    const steps = [
      { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
    ];

    await this.persistence.createSession({
      sessionId,
      flowType: 'warehouses',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
        generator: 'warehouse',
      },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return {
      sessionId,
      message: 'Warehouse generation workflow started.',
    };
  }

  /**
   * Internal method used by other generators (e.g. ProductGenerator)
   * to perform warehouse creation within an existing session.
   */
  async createWarehouses(sessionId, session) {
    const { config, options } = session.context;

    this.logger.info('Executing embedded warehouse generation sub-flow', {
      sessionId,
    });

    // 1. Generate Data
    const data = await this._runWarehouseDataGenerationStep(sessionId);

    // 2. Create in Liferay
    return await this._runWarehouseCreationStep(sessionId);
  }

  async _runWarehouseDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Starting warehouse data generation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      this.validateConfig(config);
      // Fallback for warehouse count if embedded in product flow
      const count = options.warehouseCount || 5;

      const warehouseDataList = await this.ctx.generation.generateData(
        'warehouse',
        count,
        config,
        options
      );

      const normalizedWarehouseDataList = warehouseDataList.map((data) =>
        this._normalizeWarehouseData(data, config)
      );

      // Targeted update: Only add the new data to the existing context
      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        warehouseDataList: normalizedWarehouseDataList,
      });

      await this.completeSyncStep(
        sessionId,
        S.GENERATE_WAREHOUSE_DATA,
        'SYNCHRONOUS',
        normalizedWarehouseDataList.length,
        count
      );

      return normalizedWarehouseDataList;
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed execution of generate-warehouse-data step', {
        sessionId,
        correlationId: session.correlationId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_WAREHOUSE_DATA,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runWarehouseCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, warehouseDataList } = session.context;
    const stepKey = S.CREATE_WAREHOUSES;

    this.logger.info('Starting warehouse creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      // Always use batch for warehouses to keep logic simple
      const result = await this.submitBatch(
        sessionId,
        stepKey,
        'warehouses',
        'generate',
        (erc) =>
          this.liferay.createWarehousesBatch(config, warehouseDataList, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        warehouseDataList.length
      );

      return warehouseDataList;
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(`Failed execution of ${stepKey} step`, {
        sessionId,
        correlationId: session.correlationId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: stepKey,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runLinkWarehouseChannelsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, warehouseDataList } = session.context;

    if (!warehouseDataList || warehouseDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.LINK_WAREHOUSE_CHANNELS,
        'BYPASSED'
      );
    }

    this.logger.info('Starting warehouse-to-channel linking step (Sequential)', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      // HARDENING: WarehouseChannel entity does NOT support externalReferenceCode.
      // We perform sequential individual POSTs since the number of warehouses is small.
      if (config.channelId) {
        for (const warehouse of warehouseDataList) {
          if (!warehouse.id) continue;

          this.logger.debug(
            `Linking warehouse ${warehouse.id} to channel ${config.channelId}`,
            { sessionId }
          );
          await this.liferay.addWarehouseChannel(
            config,
            warehouse.id,
            config.channelId
          );
        }
      } else {
        this.logger.info(
          'No channelId provided, skipping warehouse-to-channel linking',
          { sessionId }
        );
      }

      await this.completeSyncStep(
        sessionId,
        S.LINK_WAREHOUSE_CHANNELS,
        'SYNCHRONOUS',
        warehouseDataList.length,
        warehouseDataList.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to link warehouse channels', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.LINK_WAREHOUSE_CHANNELS,
        status: 'FAILED',
      });
    }
  }

  _normalizeWarehouseData(warehouseData, config) {
    const name = toI18n(warehouseData.name, config.localeCode);
    const description = toI18n(warehouseData.description, config.localeCode);
    const countryISOCode = (warehouseData.countryISOCode || warehouseData.addressCountry || warehouseData.country || 'US').substring(0, 2).toUpperCase();
    const regionISOCode = (warehouseData.regionISOCode || warehouseData.addressRegion || warehouseData.region || '').toUpperCase();
    
    const normalized = {
      ...warehouseData,
      name,
      description,
      countryISOCode,
      regionISOCode,
      city: warehouseData.city || warehouseData.addressLocality,
      zip: warehouseData.zip || warehouseData.postalCode,
      street1: warehouseData.street1 || warehouseData.streetAddressLine1,
      latitude: warehouseData.latitude || Math.random() * 180 - 90,
      longitude: warehouseData.longitude || Math.random() * 360 - 180,
      active: warehouseData.active !== undefined ? warehouseData.active : true,
      externalReferenceCode:
        warehouseData.externalReferenceCode || createERC(ERC_PREFIX.WAREHOUSE),
    };

    // Cleanup internal/raw fields
    delete normalized.country;
    delete normalized.region;
    delete normalized.addressCountry;
    delete normalized.addressLocality;
    delete normalized.addressRegion;
    delete normalized.postalCode;
    delete normalized.streetAddressLine1;

    return normalized;
  }

  validateConfig(config) {
    if (!config.catalogId) throw new Error('catalogId is required');
  }

  async handleBatchCallback(sessionId, batchERC) {
    return true;
  }
}

module.exports = WarehouseGenerator;
