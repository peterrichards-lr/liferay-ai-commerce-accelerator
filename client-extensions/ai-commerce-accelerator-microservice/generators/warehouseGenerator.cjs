const BaseGenerator = require('./baseGenerator.cjs');
const {
  createERC,
  resolvePhaseAndMode,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.name = 'WarehouseGenerator';

    this.steps = {
      [S.GENERATE_WAREHOUSE_DATA]:
        this._runWarehouseDataGenerationStep.bind(this),
      [S.CREATE_WAREHOUSES]: this._runWarehouseCreationStep.bind(this),
      [S.RESOLVE_WAREHOUSE_IDS]: this._runResolveWarehouseIdsStep.bind(this),
      [S.LINK_WAREHOUSE_CHANNELS]:
        this._runLinkWarehouseChannelsStep.bind(this),
    };
  }

  async run(config, options, correlationId) {
    const { phase, mode } = resolvePhaseAndMode(options);

    const sessionId = await this.persistence.createSession({
      type: 'warehouse',
      operation: 'generate',
      correlationId,
      context: {
        config,
        options: {
          ...options,
          phase,
          mode,
        },
      },
    });

    this.logger.info('Starting warehouse generation workflow', {
      sessionId,
      correlationId,
      warehouseCount: options.warehouseCount,
    });

    return await this.executeNextStep(sessionId);
  }

  async _runResolveWarehouseIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, warehouseDataList } = session.context;

    if (!warehouseDataList || warehouseDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_WAREHOUSE_IDS,
        'BYPASSED'
      );
    }

    this.logger.info('Resolving warehouse IDs from ERCs', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const ercs = warehouseDataList
        .map((w) => w.externalReferenceCode)
        .filter(Boolean);

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

      const updatedList = warehouseDataList.map((w) => ({
        ...w,
        id: ercToIdMap.get(w.externalReferenceCode) || w.id,
      }));

      await this.persistence.updateSessionContext(sessionId, {
        warehouseDataList: updatedList,
      });

      return await this.completeSyncStep(sessionId, S.RESOLVE_WAREHOUSE_IDS);
    } catch (error) {
      this.logger.error('Failed to resolve warehouse IDs', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.RESOLVE_WAREHOUSE_IDS,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runLinkWarehouseChannelsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, warehouseDataList } = session.context;
    const stepKey = S.LINK_WAREHOUSE_CHANNELS;

    if (!warehouseDataList || warehouseDataList.length === 0) {
      return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
    }

    this.logger.info('Linking warehouses to channel', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const payloads = warehouseDataList
        .filter((w) => w.id)
        .map((w) => ({
          channelId: parseInt(config.channelId, 10),
          warehouseId: parseInt(w.id, 10),
        }));

      if (payloads.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      await this.submitBatch(
        sessionId,
        stepKey,
        'warehouse-channels',
        'generate',
        (erc) =>
          this.liferay.createWarehouseChannelsBatch(config, payloads, {
            externalReferenceCode: erc,
            sessionId,
          }),
        payloads.length
      );
    } catch (error) {
      this.logger.error('Failed to link warehouses to channel', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey,
        status: 'FAILED',
      });
      throw error;
    }
  }

  _normalize(items) {
    return (items || []).map((item) => ({
      id: item.id,
      erc: item.externalReferenceCode || item.erc,
    }));
  }

  /**
   * Internal method used by other generators (e.g. ProductGenerator)
   * to perform warehouse creation within an existing session.
   */
  async createWarehouses(sessionId, _session) {
    this.logger.info('Executing embedded warehouse generation sub-flow', {
      sessionId,
    });

    // 1. Generate Data
    await this._runWarehouseDataGenerationStep(sessionId);

    // 2. Create in Liferay
    return await this._runWarehouseCreationStep(sessionId);
  }

  async _runWarehouseDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    this.logger.info('Starting warehouse data generation', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      // GEOGRAPHIC CONTEXT: Fetch valid countries and pick one randomly
      const countries = await this.liferay.getCountries(config);
      const activeCountries = (countries || []).filter(
        (c) => c.active !== false
      );

      let geographicContext = null;

      if (activeCountries.length > 0) {
        const country =
          activeCountries[Math.floor(Math.random() * activeCountries.length)];

        if (country && country.id) {
          const regions = await this.liferay.getCountryRegions(
            config,
            country.id
          );
          let region = null;
          if (regions && regions.length > 0) {
            region = regions[Math.floor(Math.random() * regions.length)];
          }

          geographicContext = {
            countryId: country.id,
            countryName: country.name,
            countryISOCode: country.a2, // e.g. US
            regionId: region?.id || null,
            regionName: region?.name || null,
            regionISOCode: region?.regionCode || null, // e.g. CA
          };

          this.logger.debug('Pre-selected geographic context for AI', {
            sessionId,
            geographicContext,
          });
        }
      }

      const warehouseDataList = await this.ctx.generation.generateData(
        'warehouse',
        options.warehouseCount || 1,
        config,
        {
          ...options,
          geographicContext,
        }
      );

      await this.persistence.updateSessionContext(sessionId, {
        warehouseDataList,
      });

      return await this.completeSyncStep(sessionId, S.GENERATE_WAREHOUSE_DATA);
    } catch (error) {
      this.logger.error('Warehouse data generation failed', {
        sessionId,
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
    const { config, warehouseDataList } = session.context;
    const stepKey = S.CREATE_WAREHOUSES;

    this.logger.info('Starting warehouse creation step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      // MAPPING: Liferay Headless Commerce Admin Inventory Warehouse DTO
      // uses countryISOCode and regionISOCode instead of country and region.
      const mappedWarehouses = warehouseDataList.map((w) => {
        const { country, region, ...rest } = w;
        return {
          ...rest,
          countryISOCode: country,
          regionISOCode: region,
        };
      });

      // Always use batch for warehouses to keep logic simple
      await this.submitBatch(
        sessionId,
        stepKey,
        'warehouses',
        'generate',
        (erc) =>
          this.liferay.createWarehousesBatch(config, mappedWarehouses, {
            externalReferenceCode: erc,
            sessionId,
          }),
        warehouseDataList.length
      );
    } catch (error) {
      const errorReference =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Warehouse creation failed', {
        sessionId,
        error: error.message,
        errorReference,
      });

      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey,
        status: 'FAILED',
      });

      this.ctx.progress.stepFailed(
        {
          sessionId,
          stepKey,
          entityType: 'warehouses',
          error,
        },
        { correlationId: session.correlationId }
      );

      throw error;
    }
  }

  async _verifyWarehouses(sessionId, batchERC) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Verifying warehouse creation', {
      sessionId,
      batchERC,
    });

    try {
      const warehouses = await this.liferay.getWarehouses(config);
      this.logger.info('Successfully verified warehouses', {
        count: warehouses.length,
      });
    } catch (error) {
      this.logger.warn('Warehouse verification failed (non-fatal)', {
        sessionId,
        error: error.message,
      });
    }
  }

  async handleBatchCallback(_sessionId, _batchERC) {
    return true;
  }
}

module.exports = WarehouseGenerator;
