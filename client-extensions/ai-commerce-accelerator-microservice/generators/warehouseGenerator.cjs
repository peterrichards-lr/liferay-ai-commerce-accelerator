const BaseGenerator = require('./baseGenerator.cjs');
const { deepCleanIds } = require('../utils/payload-cleaner.cjs');
const {
  createERC,
  fromI18n,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

class WarehouseGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.steps = {
      [S.GENERATE_WAREHOUSE_DATA]:
        this._runWarehouseDataGenerationStep.bind(this),
      [S.CREATE_WAREHOUSES]: this._runWarehouseCreationStep.bind(this),
      [S.RESOLVE_WAREHOUSE_IDS]: this._runResolveWarehouseIdsStep.bind(this),
      [S.LINK_WAREHOUSE_CHANNELS]:
        this._runLinkWarehouseChannelsStep.bind(this),
    };
  }

  async runWorkflow(config, options) {
    const steps = [
      { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
      { name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' },
      { name: S.LINK_WAREHOUSE_CHANNELS, type: 'sync' },
    ];

    return await super.runWorkflow(config, options, 'warehouses', steps);
  }

  async _runResolveWarehouseIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, warehouseDataList } = session.context;

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.RESOLVE_WAREHOUSE_IDS,
          'BYPASSED'
        );
      }

      const ercs = warehouseDataList.map((w) => w.externalReferenceCode);
      const warehouses = await this.liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) => this.liferay.getWarehousesByERC(cfg, e),
        { label: 'warehouses' }
      );

      const ercToIdMap = new Map(
        warehouses.map((w) => [w.externalReferenceCode, w.id])
      );

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

    try {
      const channelId = parseInt(config.channelId, 10);
      const payloads = warehouseDataList
        .filter((w) => w.id)
        .map((w) => ({
          channelId,
          warehouseId: w.id,
        }));

      if (payloads.length === 0) {
        return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
      }

      this.logger.info(
        `Linking ${payloads.length} warehouses to channel ${channelId}`,
        {
          sessionId,
        }
      );

      // HARDENING: Link warehouses individually to avoid schema/batch issues
      for (const payload of payloads) {
        await this.liferay.createWarehouseChannel(
          config,
          payload.warehouseId,
          payload.channelId
        );
      }

      await this.completeSyncStep(
        sessionId,
        stepKey,
        'SYNCHRONOUS',
        payloads.length,
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

  async _runWarehouseDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    try {
      // HARDENING: If no geographic context provided, pick a random active one from Liferay
      // to improve AI grounding and avoid hallucinated country codes.
      if (!options.geographicContext) {
        const countries = await this.liferay.getCountries(config);
        const activeCountries = (countries.items || countries).filter(
          (c) => c.active
        );

        if (activeCountries.length > 0) {
          const country =
            activeCountries[Math.floor(Math.random() * activeCountries.length)];

          if (country && country.id) {
            const regions = await this.liferay.getCountryRegions(
              config,
              country.id
            );
            const region = regions.length
              ? regions[Math.floor(Math.random() * regions.length)]
              : null;

            const countryTitle = fromI18n(
              country.title_i18n,
              config.localeCode
            );
            const regionTitle = region
              ? fromI18n(region.title_i18n, config.localeCode)
              : null;

            const geographicContext = {
              countryISOCode: country.a2 || null, // e.g. US
              countryName: country.name || null,
              countryTitle: countryTitle || null,
              regionName: region?.name || null,
              regionTitle: regionTitle || null,
              regionISOCode: region?.regionCode || null, // e.g. CA
            };

            this.logger.debug('Pre-selected geographic context for AI', {
              sessionId,
              geographicContext,
            });

            await this.persistence.updateSessionContext(sessionId, {
              options: {
                ...options,
                geographicContext,
              },
            });
          }
        }
      }

      // Re-read context to get updated options
      const updatedSession = await this.persistence.getSession(sessionId);

      const warehouseDataList = await this.ctx.generation.generateData(
        'warehouse',
        options.warehouseCount,
        config,
        updatedSession.context.options
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

    try {
      if (!warehouseDataList || warehouseDataList.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_WAREHOUSES,
          'BYPASSED'
        );
      }

      // HARDENING: Map 'country' to 'countryISOCode' and 'region' to 'regionISOCode'
      // if coming from AI generator which uses simplified fields.
      const prepared = deepCleanIds(
        warehouseDataList.map((w) => {
          const { country, region, ...rest } = w;
          return {
            ...rest,
            countryISOCode: w.countryISOCode || country,
            regionISOCode: w.regionISOCode || region,
          };
        })
      );

      // Persist the prepared list so that RESOLVE step has the same objects
      await this.persistence.updateSessionContext(sessionId, {
        warehouseDataList: prepared,
      });

      await this.submitBatch(
        sessionId,
        S.CREATE_WAREHOUSES,
        'warehouses',
        'generate',
        (erc) =>
          this.liferay.createWarehousesBatch(config, prepared, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        prepared.length
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
        stepKey: S.CREATE_WAREHOUSES,
        status: 'FAILED',
      });
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
