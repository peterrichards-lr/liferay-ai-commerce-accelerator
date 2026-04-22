const BaseGenerator = require('./baseGenerator.cjs');
const { ASSET_TYPE, VIEWABLE_BY } = require('../utils/liferayPermissions.cjs');
const { deepCleanIds } = require('../utils/payload-cleaner.cjs');
const {
  delay,
  resolvePhaseAndMode,
  createERC,
  toI18n,
  buildOptionCategoryERC,
  buildSpecificationERC,
  now,
  isoNow,
  sanitizeForERC,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, ENV, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { v4: uuidv4 } = require('uuid');

const S = WORKFLOW_STEPS;

class ProductGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.CREATE_WAREHOUSES]: this._runWarehouseGenerationStep.bind(this),
      [S.RESOLVE_WAREHOUSE_IDS]: this._runResolveWarehouseIdsStep.bind(this),
      [S.GENERATE_PRODUCT_DATA]: this._runProductDataGenerationStep.bind(this),
      [S.ENSURE_SPECIFICATIONS]: this._runEnsureSpecificationsStep.bind(this),
      [S.CREATE_PRODUCTS]: this._runProductCreationStep.bind(this),
      [S.RESOLVE_PRODUCT_IDS]: this._runResolveProductIdsStep.bind(this),
      [S.LINK_PRODUCT_OPTIONS]: this._runLinkProductOptionsStep.bind(this),
      [S.CREATE_PRODUCT_SKUS]: this._runProductSkusStep.bind(this),
      [S.RESOLVE_SKU_IDS]: this._runResolveSkuIdsStep.bind(this),
      [S.SYNC_DELAY_PRICING]: this._runInterServiceSyncDelayStep.bind(this),
      [S.GENERATE_PRICE_LISTS]: this._runGeneratePriceListsStep.bind(this),
      [S.UPDATE_CATALOG_CONFIG]:
        this._runUpdateCatalogConfigurationStep.bind(this),
      [S.GENERATE_BULK_PRICING]: this._runGenerateBulkPricingStep.bind(this),
      [S.GENERATE_TIER_PRICING]: this._runGenerateTierPricingStep.bind(this),
      [S.ATTACH_IMAGES]: this._runAttachImagesStep.bind(this),
      [S.ATTACH_PDFS]: this._runAttachPdfsStep.bind(this),
      [S.UPDATE_INVENTORY]: this._runUpdateInventoryStep.bind(this),
    };
  }

  /**
   * Standalone entry point for product generation.
   */
  async runWorkflow(config, options) {
    const sessionId = options.sessionId || createERC(ERC_PREFIX.BATCH_SESSION);
    options.sessionId = sessionId;

    if (
      !options.selectedLanguages ||
      (Array.isArray(options.selectedLanguages) &&
        options.selectedLanguages.length === 0)
    ) {
      const fallbackLanguage = config.defaultLanguageId || ENV.DEFAULT_LOCALE;
      this.logger.info(
        `No languages selected for generation. Falling back to: ${fallbackLanguage}`,
        { sessionId }
      );
      options.selectedLanguages = [fallbackLanguage];
    }

    const steps = [
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
      { name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' },
      { name: S.GENERATE_PRODUCT_DATA, type: 'sync' },
      { name: S.ENSURE_SPECIFICATIONS, type: 'sync' },
      { name: S.CREATE_PRODUCTS, type: 'sync' },
      { name: S.RESOLVE_PRODUCT_IDS, type: 'sync' },
      { name: S.LINK_PRODUCT_OPTIONS, type: 'sync' },
      { name: S.CREATE_PRODUCT_SKUS, type: 'sync' },
      { name: S.RESOLVE_SKU_IDS, type: 'sync' },
      { name: S.SYNC_DELAY_PRICING, type: 'sync' },
      { name: S.GENERATE_PRICE_LISTS, type: 'sync' },
    ];

    if (options.generatePriceLists) {
      steps.push({ name: S.UPDATE_CATALOG_CONFIG, type: 'sync' });
    }

    if (options.generateBulkPricing) {
      steps.push({ name: S.GENERATE_BULK_PRICING, type: 'sync' });
    }

    if (options.generateTierPricing) {
      steps.push({ name: S.GENERATE_TIER_PRICING, type: 'sync' });
    }

    steps.push({
      type: 'parallel',
      steps: [
        { name: S.ATTACH_IMAGES, type: 'sync' },
        { name: S.ATTACH_PDFS, type: 'sync' },
        { name: S.UPDATE_INVENTORY, type: 'sync' },
      ],
    });

    await this.persistence.createSession({
      sessionId,
      flowType: 'generate',
      status: 'STARTED',
      currentSteps: [],
      correlationId: config.correlationId,
      context: {
        config,
        options,
        steps,
        generator: 'product',
      },
    });

    this.ctx.batchCallback._checkSessionCompletion(
      sessionId,
      config.correlationId
    );

    return {
      sessionId,
      message: 'Product generation workflow started.',
    };
  }

  async _runInterServiceSyncDelayStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { correlationId } = session;

    this.logger.info(
      `Starting inter-service synchronization delay of ${ENV.LIFERAY_SYNC_DELAY_MS}ms`,
      { sessionId, correlationId }
    );

    await delay(ENV.LIFERAY_SYNC_DELAY_MS);

    await this.completeSyncStep(sessionId, S.SYNC_DELAY_PRICING);

    this.logger.info('Inter-service synchronization delay completed.', {
      sessionId,
      correlationId,
    });
  }

  async _runGeneratePriceListsStep(sessionId) {
    try {
      return await this._runPricingStep(
        sessionId,
        S.GENERATE_PRICE_LISTS,
        (e) => !e.bulkPricing && (!e.tierPrices || e.tierPrices.length === 0)
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(
        `Error in generate-price-lists step: ${error.message}`,
        {
          sessionId,
          errorReferenceCode,
        }
      );
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_PRICE_LISTS,
        status: 'FAILED',
      });
    }
  }

  async _runGenerateBulkPricingStep(sessionId) {
    try {
      return await this._runPricingStep(
        sessionId,
        S.GENERATE_BULK_PRICING,
        (e) => e.bulkPricing === true
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(
        `Error in generate-bulk-pricing step: ${error.message}`,
        {
          sessionId,
          errorReferenceCode,
        }
      );
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_BULK_PRICING,
        status: 'FAILED',
      });
    }
  }

  async _runGenerateTierPricingStep(sessionId) {
    try {
      return await this._runPricingStep(
        sessionId,
        S.GENERATE_TIER_PRICING,
        (e) => !e.bulkPricing && e.tierPrices && e.tierPrices.length > 0
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(
        `Error in generate-tier-pricing step: ${error.message}`,
        {
          sessionId,
          errorReferenceCode,
        }
      );
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_TIER_PRICING,
        status: 'FAILED',
      });
    }
  }

  async _runUpdateCatalogConfigurationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;
    const catalogId = parseInt(config.catalogId, 10);

    this.logger.info('Starting update catalog configuration step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      const PRICE_LIST_CONFIGS = [
        {
          erc: 'AICA-PL-GENERAL',
          label: 'Standard Price List',
          type: 'price-list',
        },
        {
          erc: 'AICA-PL-PROMOTIONS',
          label: 'Promotions List',
          type: 'promotion',
        },
      ];

      const aicaLists = [];
      for (const item of PRICE_LIST_CONFIGS) {
        const pl = await this.liferay.getPriceListByERC(config, item.erc);
        if (pl) {
          aicaLists.push({ ...item, id: pl.id });
        }
      }

      const res = await this.liferay.getPriceLists(config, {
        filter: `catalogId eq ${catalogId}`,
        ignoreExclusions: true,
        pageSize: 1000,
      });

      const items = res.items || [];
      for (const pl of items) {
        const isTarget = aicaLists.some((aica) => aica.id === pl.id);
        if (pl.catalogBasePriceList && !isTarget) {
          await this.liferay.patchPriceList(config, pl.id, {
            catalogBasePriceList: false,
          });
          await delay(1000);
        }
      }

      let updateCount = 0;
      for (const pl of aicaLists) {
        await this.liferay.patchPriceList(config, pl.id, {
          catalogBasePriceList: true,
        });
        updateCount++;
        await delay(2000);
      }

      await this.completeSyncStep(
        sessionId,
        S.UPDATE_CATALOG_CONFIG,
        'SYNCHRONOUS',
        updateCount,
        PRICE_LIST_CONFIGS.length
      );
    } catch (err) {
      const errorReferenceCode =
        resolveErrorReference(err) || createERC(ERC_PREFIX.ERROR);
      this.logger.error(
        `Failed to update catalog configuration: ${err.message}`,
        {
          sessionId,
          errorReferenceCode,
        }
      );
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.UPDATE_CATALOG_CONFIG,
        status: 'FAILED',
      });
    }
  }

  async _runPricingStep(sessionId, stepKey, filterFn) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(sessionId, stepKey, 'BYPASSED');
    }

    this.logger.info(`Starting ${stepKey} step`, { sessionId });

    const ercToIdMap = await this._ensurePriceLists(
      config,
      sessionId,
      session.correlationId,
      options
    );
    const generalListId = ercToIdMap.get('AICA-PL-GENERAL');
    const promotionsListId = ercToIdMap.get('AICA-PL-PROMOTIONS');

    if (!generalListId)
      throw new Error(`Failed to resolve target price list for ${stepKey}`);

    const priceListTemplates = [
      {
        id: generalListId,
        externalReferenceCode: 'AICA-PL-GENERAL',
        name: 'AI Commerce Accelerator Price List',
        type: 'price-list',
        catalogId: parseInt(config.catalogId, 10),
        currencyCode: config.currencyCode || 'USD',
        priceEntries: [],
      },
    ];

    if (promotionsListId) {
      priceListTemplates.push({
        id: promotionsListId,
        externalReferenceCode: 'AICA-PL-PROMOTIONS',
        name: 'AI Commerce Accelerator Promotions',
        type: 'promotion',
        catalogId: parseInt(config.catalogId, 10),
        currencyCode: config.currencyCode || 'USD',
        priceEntries: [],
      });
    }

    let totalEntries = 0;
    for (const product of productDataList) {
      if (!Array.isArray(product.priceEntries)) continue;
      for (const entry of product.priceEntries) {
        if (!filterFn(entry)) continue;

        const baseErc = entry.externalReferenceCode || uuidv4();
        const skuERC =
          entry.skuExternalReferenceCode ||
          (typeof entry.sku === 'string' ? entry.sku : null);
        const matchedSku = (product.skus || []).find(
          (s) => s.externalReferenceCode === skuERC || s.sku === skuERC
        );
        const skuId = matchedSku?.id;

        const basePriceEntry = {
          price: entry.price,
          sku:
            typeof entry.sku === 'object'
              ? entry.sku
              : { basePrice: entry.price },
          bulkPricing: stepKey === S.GENERATE_BULK_PRICING,
          externalReferenceCode: `PE-${skuERC}-GEN-${sanitizeForERC(baseErc, { max: 40 })}`,
          tierPrices: (entry.tierPrices || []).map((tp) => ({
            minimumQuantity: tp.minimumQuantity,
            price: tp.price,
          })),
        };

        if (skuId) basePriceEntry.skuId = skuId;
        else basePriceEntry.skuExternalReferenceCode = skuERC;

        priceListTemplates[0].priceEntries.push(basePriceEntry);
        totalEntries++;
      }
    }

    const activeLists = priceListTemplates.filter(
      (pl) => pl.priceEntries.length > 0
    );
    if (activeLists.length > 0) {
      await this.submitBatch(
        sessionId,
        stepKey,
        'products',
        'generate',
        (erc) =>
          this.liferay.createPriceListsBatch(config, activeLists, {
            externalReferenceCode: erc,
            sessionId,
            session,
          }),
        totalEntries
      );
    } else {
      await this.completeSyncStep(sessionId, stepKey, 'SYNCHRONOUS');
    }
  }

  async _ensurePriceLists(config, sessionId, correlationId, options = {}) {
    const generateNewLists = options.generatePriceLists;
    const ercToIdMap = new Map();

    const PRICE_LIST_TEMPLATES = [
      {
        erc: 'AICA-PL-GENERAL',
        name: 'AI Commerce Accelerator Price List',
        priority: 1,
        type: 'price-list',
      },
      {
        erc: 'AICA-PL-PROMOTIONS',
        name: 'AI Commerce Accelerator Promotions',
        priority: 2,
        type: 'promotion',
      },
    ];

    for (const pl of PRICE_LIST_TEMPLATES) {
      let existing = await this.liferay.getPriceListByERC(config, pl.erc);
      if (!existing && generateNewLists) {
        existing = await this.liferay.createPriceList(config, {
          externalReferenceCode: pl.erc,
          name: pl.name,
          currencyCode: config.currencyCode || 'USD',
          active: true,
          priority: pl.priority,
          catalogId: config.catalogId,
          type: pl.type,
          catalogBasePriceList: false,
          neverExpire: true,
        });
      }
      if (existing?.id) ercToIdMap.set(pl.erc, existing.id);
    }
    return ercToIdMap;
  }

  async _runResolveProductIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_PRODUCT_IDS,
        'BYPASSED'
      );
    }

    try {
      const ercs = productDataList
        .map((p) => p.externalReferenceCode)
        .filter(Boolean);
      const resolvedItems = await this.liferay.resolveByERCsWithRetry(
        config,
        ercs,
        (cfg, e) =>
          this.liferay.getProductsByERC(cfg, e, [
            'id',
            'externalReferenceCode',
          ]),
        { label: 'products' }
      );

      const normalized = this._normalize(resolvedItems);
      const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

      const updatedList = productDataList.map((p) => ({
        ...p,
        id: ercToIdMap.get(p.externalReferenceCode),
      }));

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        productDataList: updatedList,
      });
      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_PRODUCT_IDS,
        'SYNCHRONOUS',
        normalized.length,
        ercs.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to resolve product IDs', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.RESOLVE_PRODUCT_IDS,
        status: 'FAILED',
      });
    }
  }

  async _runResolveSkuIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_SKU_IDS,
        'BYPASSED'
      );
    }

    const skuErcs = (productDataList || [])
      .flatMap((p) => (p.skus || []).map((sku) => sku.externalReferenceCode))
      .filter(Boolean);

    try {
      const resolvedItems = await this.liferay.resolveByERCsWithRetry(
        config,
        skuErcs,
        (cfg, e) =>
          this.liferay.getSkusByERC(cfg, e, ['id', 'externalReferenceCode']),
        { label: 'skus' }
      );

      const normalized = this._normalize(resolvedItems);
      const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

      const updatedList = productDataList.map((p) => ({
        ...p,
        skus: (p.skus || []).map((sku) => ({
          ...sku,
          id:
            ercToIdMap.get(
              sku.externalReferenceCode || p.externalReferenceCode
            ) || sku.id,
        })),
      }));

      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        productDataList: updatedList,
      });
      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_SKU_IDS,
        'SYNCHRONOUS',
        normalized.length,
        skuErcs.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to resolve SKU IDs', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.RESOLVE_SKU_IDS,
        status: 'FAILED',
      });
    }
  }

  async _runResolveWarehouseIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;
    const warehouses = options?.warehouses || [];

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
        options: { ...options, warehouses: updatedWarehouses },
      });
      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_WAREHOUSE_IDS,
        'SYNCHRONOUS',
        normalized.length,
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

  async _runLinkProductOptionsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    try {
      const productsWithOpts = (productDataList || []).filter((p) => {
        const opts = p.productOptions || p.options;
        return p.id && Array.isArray(opts) && opts.length > 0;
      });

      for (const product of productsWithOpts) {
        const sourceOptions = product.productOptions || product.options;
        const cleanedOptions = sourceOptions.map((opt) => {
          const cleanOpt = {
            ...opt,
            name: typeof opt.name === 'string' ? { en_US: opt.name } : opt.name,
          };

          // Liferay Headless Commerce API (v1.0) expects 'productOptionValues' instead of 'values'
          const sourceValues = opt.productOptionValues || opt.values || [];

          if (sourceValues.length > 0) {
            cleanOpt.productOptionValues = sourceValues.map((val) => {
              if (typeof val === 'string') {
                return {
                  name: { en_US: val },
                  key: sanitizeForERC(val),
                };
              }
              return {
                ...val,
                name:
                  typeof val.name === 'string' ? { en_US: val.name } : val.name,
                key: val.key || sanitizeForERC(val.name?.en_US || val.name),
              };
            });
          }

          delete cleanOpt.id;
          delete cleanOpt.values; // Remove incorrect field
          delete cleanOpt.__catalogOption;
          return cleanOpt;
        });

        await this.liferay.addProductOptions(
          config,
          product.id,
          cleanedOptions
        );
      }
      await this.completeSyncStep(
        sessionId,
        S.LINK_PRODUCT_OPTIONS,
        'SYNCHRONOUS',
        productsWithOpts.length,
        productsWithOpts.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed to link options', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.LINK_PRODUCT_OPTIONS,
        status: 'FAILED',
      });
    }
  }

  async _runProductSkusStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    try {
      const preparedProducts = (productDataList || [])
        .filter((p) => Array.isArray(p.skus) && p.skus.length > 0)
        .map((pd) => {
          const lp = {
            catalogId: parseInt(config.catalogId, 10),
            name: toI18n(pd.name),
            productType: pd.productType || 'simple',
            externalReferenceCode: pd.externalReferenceCode,
            skus: pd.skus,
          };
          return this._cleanProductForLiferay(lp);
        });

      if (preparedProducts.length > 0) {
        const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
        for (let i = 0; i < preparedProducts.length; i += batchSize) {
          const batch = preparedProducts.slice(i, i + batchSize);
          await this.submitBatch(
            sessionId,
            S.CREATE_PRODUCT_SKUS,
            'products',
            'generate',
            (erc) =>
              this.liferay.createProductsBatch(config, batch, {
                externalReferenceCode: erc,
                sessionId,
                session,
              }),            batch.length
          );
        }
      } else {
        await this.completeSyncStep(
          sessionId,
          S.CREATE_PRODUCT_SKUS,
          'SYNCHRONOUS'
        );
      }
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed product SKUs creation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_PRODUCT_SKUS,
        status: 'FAILED',
      });
    }
  }

  async _runWarehouseGenerationStep(sessionId, session) {
    const { config, options } = session.context;

    if (!options.createWarehouses) {
      return await this.completeSyncStep(
        sessionId,
        S.CREATE_WAREHOUSES,
        'BYPASSED'
      );
    }

    try {
      await this.ctx.warehouseGenerator.createWarehouses(sessionId, session);
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed warehouse generation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_WAREHOUSES,
        status: 'FAILED',
      });
    }
  }

  async _runProductDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options } = session.context;

    try {
      const allData = await this._generateProductData(
        config,
        options,
        sessionId,
        session.correlationId
      );
      await this.persistence.updateSessionContext(sessionId, {
        ...session.context,
        productDataList: allData,
      });
      await this.completeSyncStep(
        sessionId,
        S.GENERATE_PRODUCT_DATA,
        'SYNCHRONOUS',
        allData.length,
        options.productCount
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed product data generation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.GENERATE_PRODUCT_DATA,
        status: 'FAILED',
      });
    }
  }

  async _runEnsureSpecificationsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.ENSURE_SPECIFICATIONS,
        'BYPASSED'
      );
    }

    this.logger.info('Starting ensure specifications step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      // 1. Identify all unique specification keys used in the generated data
      const specMap = new Map();
      for (const product of productDataList) {
        const specs = product.productSpecifications || product.specifications || [];
        for (const spec of specs) {
          if (spec.specificationKey) {
            specMap.set(spec.specificationKey, spec);
          }
        }
      }

      const uniqueKeys = Array.from(specMap.keys());
      if (uniqueKeys.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.ENSURE_SPECIFICATIONS,
          'BYPASSED'
        );
      }

      this.logger.debug(`Synchronizing ${uniqueKeys.length} specification definitions...`, {
        sessionId,
        keys: uniqueKeys,
      });

      // 2. Ensure each specification exists in Liferay
      let createdCount = 0;
      for (const key of uniqueKeys) {
        const spec = specMap.get(key);
        const title = spec.title || spec.name || { en_US: toI18n(key).en_US };
        
        await this.liferay.createSpecificationWithReuse(config, {
          externalReferenceCode: buildSpecificationERC(key),
          key: key,
          title: typeof title === 'string' ? { en_US: title } : title,
          description: { en_US: `Auto-generated specification for ${key}` }
        });
        createdCount++;
      }

      await this.completeSyncStep(
        sessionId,
        S.ENSURE_SPECIFICATIONS,
        'SYNCHRONOUS',
        createdCount,
        uniqueKeys.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed ensure specifications step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.ENSURE_SPECIFICATIONS,
        status: 'FAILED',
      });
    }
  }

  async _runProductCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.CREATE_PRODUCTS,
        'BYPASSED'
      );
    }

    try {
      const prepared = productDataList.map((pd) => {
        // Liferay Headless Commerce API (v1.0) requires all products to be 'simple' during initial creation.
        const productType = 'simple';

        const lp = {
          catalogId: parseInt(config.catalogId, 10),
          name: toI18n(pd.name),
          shortDescription: toI18n(pd.shortDescription || pd.description),
          description: toI18n(pd.description),
          productType,
          productStatus: 0, // Published
          productConfiguration: {
            productTaxConfiguration: {
              taxCategory: 'Standard',
              taxable: true,
            },
          },
          externalReferenceCode: pd.externalReferenceCode,
          productSpecifications: (pd.productSpecifications || pd.specifications || []).map(spec => ({
            ...spec,
            title: spec.title || spec.value || spec.name // Liferay requires title for the underlying CPSpecificationOption
          })),
          productOptions: pd.productOptions || pd.options || [],
        };

        if (pd.skus && pd.skus.length > 0) {
          lp.skus = pd.skus.map((s) => ({
            sku: s.sku,
            externalReferenceCode: s.externalReferenceCode || s.sku,
            published: true,
            purchasable: true,
          }));

          if (!options.generateSkuVariants || productType === 'simple') {
            lp.skus = lp.skus.slice(0, 1);
          }
        }

        return deepCleanIds(lp);
      });

      if (prepared.length === 0) {
        throw new Error('No products prepared for creation');
      }

      const batchSize = Math.max(1, parseInt(config.batchSize, 10) || 1);
      for (let i = 0; i < prepared.length; i += batchSize) {
        const chunk = prepared.slice(i, i + batchSize);
        await this.submitBatch(
          sessionId,
          S.CREATE_PRODUCTS,
          'products',
          'generate',
          (erc) =>
            this.liferay.createProductsBatch(config, chunk, {
              externalReferenceCode: erc,
              sessionId,
              session,
            }),
          chunk.length
        );
      }
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed product creation step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.CREATE_PRODUCTS,
        status: 'FAILED',
      });
    }
  }

  async _runAttachImagesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;
    try {
      await this.ctx.media.createImages(config, productDataList || [], {
        ...options,
        sessionId,
      });
      await this.completeSyncStep(sessionId, S.ATTACH_IMAGES);
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed attach images step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.ATTACH_IMAGES,
        status: 'FAILED',
      });
    }
  }

  async _runAttachPdfsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;
    try {
      await this.ctx.media.createPdfs(config, productDataList || [], {
        ...options,
        sessionId,
      });
      await this.completeSyncStep(sessionId, S.ATTACH_PDFS);
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed attach PDFs step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.ATTACH_PDFS,
        status: 'FAILED',
      });
    }
  }

  async _runUpdateInventoryStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;
    const warehouses = options.warehouses || [];

    try {
      if (warehouses.length > 0) {
        await this.completeSyncStep(sessionId, S.UPDATE_INVENTORY);
      } else {
        await this.completeSyncStep(sessionId, S.UPDATE_INVENTORY, 'BYPASSED');
      }
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed update inventory step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.UPDATE_INVENTORY,
        status: 'FAILED',
      });
    }
  }

  async _generateProductData(config, options, sessionId, correlationId) {
    const data = await this.ctx.generation.generateData(
      'product',
      options.productCount,
      config,
      options
    );
    return data.map((p) => ({
      ...p,
      externalReferenceCode:
        p.externalReferenceCode || createERC(ERC_PREFIX.PRODUCT),
    }));
  }

  _cleanProductForLiferay(product, options = {}) {
    let clean = this.deepClean(product);

    if (options.stripSkuOptions && clean.skus) {
      clean.skus = clean.skus.map((s) => {
        const { skuOptions, ...rest } = s;
        return rest;
      });
    }

    return clean;
  }

  async handleBatchCallback(sessionId, batchERC) {
    const batch = await this.persistence.getBatch(batchERC);
    if (
      [
        S.GENERATE_PRICE_LISTS,
        S.GENERATE_BULK_PRICING,
        S.GENERATE_TIER_PRICING,
      ].includes(batch.step_key)
    ) {
      await this._verifyPricing(sessionId, batchERC);
    }
  }

  async _verifyPricing(sessionId, batchERC) {
    return true;
  }
}

module.exports = ProductGenerator;
