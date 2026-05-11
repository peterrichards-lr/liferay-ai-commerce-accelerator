const BaseGenerator = require('./baseGenerator.cjs');
const { deepCleanIds } = require('../utils/payload-cleaner.cjs');
const {
  delay,
  createERC,
  toI18n,
  fromI18n,
  buildKeyedERC,
  buildSpecificationERC,
  sanitizeForERC,
  resolveErrorReference,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');
const { COMMERCE_CONSTRAINTS } = require('../utils/commerceConstants.cjs');
const crypto = require('crypto');

const S = WORKFLOW_STEPS;

class ProductGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    this.steps = {
      [S.GENERATE_PRODUCT_DATA]: this._runProductDataGenerationStep.bind(this),
      [S.LOAD_METADATA]: this._runLoadMetadataStep.bind(this),
      [S.ENSURE_SPECIFICATION_CATEGORIES]:
        this._runEnsureSpecificationCategoriesStep.bind(this),
      [S.ENSURE_SPECIFICATIONS]: this._runEnsureSpecificationsStep.bind(this),
      [S.ENSURE_OPTIONS]: this._runEnsureOptionsStep.bind(this),
      [S.CREATE_PRODUCTS]: this._runProductCreationStep.bind(this),
      [S.RESOLVE_PRODUCT_IDS]: this._runResolveProductIdsStep.bind(this),
      [S.LINK_PRODUCT_OPTIONS]: this._runLinkProductOptionsStep.bind(this),
      [S.CREATE_PRODUCT_SKUS]: this._runProductSkusStep.bind(this),
      [S.RESOLVE_SKU_IDS]: this._runResolveSkuIdsStep.bind(this),
      [S.SYNC_DELAY_PRICING]: (sId) =>
        this._runInterServiceSyncDelayStep(sId, S.SYNC_DELAY_PRICING),
      [S.SYNC_DELAY_MEDIA]: (sId) =>
        this._runAdaptiveSyncDelayStep(
          sId,
          S.SYNC_DELAY_MEDIA,
          async (config, context) => {
            const ercs = (context.productDataList || [])
              .map((p) => p.externalReferenceCode)
              .filter(Boolean)
              .slice(0, 5); // Just check a few samples

            if (ercs.length === 0) return true;

            const res = await this.liferay.getProductsByERC(config, ercs, [
              'externalReferenceCode',
            ]);
            const foundCount = (res.items || res || []).length;
            return foundCount > 0;
          }
        ),
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
    const steps = [
      { name: S.LOAD_METADATA, type: 'sync' },
      { name: S.GENERATE_WAREHOUSE_DATA, type: 'sync' },
      { name: S.CREATE_WAREHOUSES, type: 'sync' },
      { name: S.RESOLVE_WAREHOUSE_IDS, type: 'sync' },
      { name: S.GENERATE_PRODUCT_DATA, type: 'sync' },
      { name: S.ENSURE_SPECIFICATION_CATEGORIES, type: 'sync' },
      { name: S.ENSURE_SPECIFICATIONS, type: 'sync' },
      { name: S.ENSURE_OPTIONS, type: 'sync' },
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

    steps.push({ name: S.SYNC_DELAY_MEDIA, type: 'sync' });

    steps.push({
      type: 'parallel',
      steps: [
        { name: S.ATTACH_IMAGES, type: 'sync' },
        { name: S.ATTACH_PDFS, type: 'sync' },
        { name: S.UPDATE_INVENTORY, type: 'sync' },
      ],
    });

    // Calculate initial totals for the UI
    const totals = {
      products: options.productCount || 0,
      accounts: options.accountCount || 0,
      orders: options.orderCount || 0,
      warehouses: options.createWarehouses ? options.warehouseCount || 0 : 0,
      images:
        options.imageMode !== 'none'
          ? Math.round(
              ((options.productCount || 0) * (options.imageRatio || 0)) / 100
            )
          : 0,
      pdfs:
        options.pdfMode !== 'none'
          ? Math.round(
              ((options.productCount || 0) * (options.pdfRatio || 0)) / 100
            )
          : 0,
    };

    return super.runWorkflow(config, options, 'products', steps, totals);
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
      throw error;
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
      throw error;
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
      throw error;
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

      // HARDENING: Pricing V2.0 strictly forbids 'catalogId eq' filters in 2025.Q1.
      // We fetch all and filter in memory to bypass "Collection not allowed" errors.
      const res = await this.liferay.getPriceLists(config, {
        ignoreExclusions: true,
        pageSize: 1000,
      });

      const items = (res.items || []).filter(
        (it) => !catalogId || Number(it.catalogId) === Number(catalogId)
      );
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
      throw err;
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

        const baseErc = entry.externalReferenceCode || crypto.randomUUID();
        const skuERC =
          entry.skuExternalReferenceCode ||
          (typeof entry.sku === 'string' ? entry.sku : null);

        // HARDENING: Look for the resolved ID in BOTH the skus and skuVariants arrays
        const allSkus = [
          ...(product.skus || []),
          ...(product.skuVariants || []),
        ];
        const matchedSku = allSkus.find(
          (s) => s.externalReferenceCode === skuERC || s.sku === skuERC
        );
        const skuId = matchedSku?.id;

        // CRITICAL: If we still have a placeholder (like 50000) or no ID, do NOT send it.
        // Pricing V2.0 will crash the entire batch if one ID is invalid.
        if (!skuId || skuId === 50000) {
          this.logger.warn(
            `Skipping price entry for SKU ${skuERC}: Real physical ID not resolved yet.`,
            {
              sessionId,
              productId: product.id,
            }
          );
          continue;
        }

        const targetList =
          promotionsListId && entry.promoPrice
            ? priceListTemplates[1]
            : priceListTemplates[0];
        const targetListId = targetList.id;

        const basePriceEntry = {
          price: entry.price,
          priceListId: targetListId,
          bulkPricing: stepKey === S.GENERATE_BULK_PRICING,
          externalReferenceCode: `PE-${skuERC}-GEN-${sanitizeForERC(baseErc, { max: 40 })}`,
          active: true,
          // HARDENING: Pricing V2.0 strictly requires this boolean to be non-null
          discountDiscovery: false,
          // HARDENING: Always provide the ERC as the primary identifier
          skuExternalReferenceCode: skuERC,
          tierPrices: (entry.tierPrices || []).map((tp) => ({
            minimumQuantity: tp.minimumQuantity,
            price: tp.price,
            externalReferenceCode: createERC(ERC_PREFIX.BATCH), // Add ERC for tier items
          })),
        };

        if (skuId && skuId !== 40000 && skuId !== 50000) {
          // HARDENING: Provide the physical ID if resolved as a secondary high-speed path
          basePriceEntry.skuId = parseInt(skuId, 10);
          basePriceEntry.sku = { id: parseInt(skuId, 10) };
        }

        if (entry.promoPrice) {
          basePriceEntry.promoPrice = entry.promoPrice;
        }

        targetList.priceEntries.push(basePriceEntry);
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
      throw error;
    }
  }

  async _runResolveSkuIdsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.RESOLVE_SKU_IDS,
        'BYPASSED'
      );
    }

    // HARDENING: Resolve ONLY the SKUs that were actually sent to Liferay
    const skuErcs = [];
    for (const p of productDataList) {
      const hasSkuContributingOptions = (
        p.productOptions ||
        p.options ||
        []
      ).some((o) => o.skuContributor);

      if (
        options.generateSkuVariants &&
        hasSkuContributingOptions &&
        Array.isArray(p.skuVariants)
      ) {
        // 1. Variant SKUs
        skuErcs.push(
          ...p.skuVariants.map((v) => v.externalReferenceCode).filter(Boolean)
        );
      } else if (Array.isArray(p.skus)) {
        // 2. Base SKUs (only if variants were not generated)
        skuErcs.push(
          ...p.skus.map((s) => s.externalReferenceCode).filter(Boolean)
        );
      }
    }

    const uniqueErcs = [...new Set(skuErcs)];

    try {
      this.logger.info(
        `Resolving physical database IDs for ${uniqueErcs.length} SKUs...`,
        { sessionId }
      );

      const resolvedItems = await this.liferay.resolveByERCsWithRetry(
        config,
        uniqueErcs,
        (cfg, e) =>
          this.liferay.getSkusByERC(cfg, e, ['id', 'externalReferenceCode']),
        { label: 'skus', tolerateMissing: true }
      );

      const normalized = this._normalize(resolvedItems);
      const ercToIdMap = new Map(normalized.map((item) => [item.erc, item.id]));

      const updatedList = productDataList.map((p) => ({
        ...p,
        // Update IDs on Base SKUs
        skus: (p.skus || []).map((sku) => ({
          ...sku,
          id: ercToIdMap.get(sku.externalReferenceCode) || sku.id,
        })),
        // Update IDs on Variant SKUs
        skuVariants: (p.skuVariants || []).map((variant) => ({
          ...variant,
          id: ercToIdMap.get(variant.externalReferenceCode) || variant.id,
        })),
      }));

      await this.persistence.updateSessionContext(sessionId, {
        productDataList: updatedList,
      });

      await this.completeSyncStep(
        sessionId,
        S.RESOLVE_SKU_IDS,
        'SYNCHRONOUS',
        normalized.length,
        uniqueErcs.length
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
      throw error;
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
        this.logger.debug(
          `Linking options for product ${product.externalReferenceCode} (ID: ${product.id})`,
          { sessionId }
        );
        const sourceOptions = product.productOptions || product.options;
        const cleanedOptions = sourceOptions.map((opt) => {
          const name =
            typeof opt.name === 'string' ? { en_US: opt.name } : opt.name;
          const key = opt.key || sanitizeForERC(name?.en_US || name);

          // HARDENING: Strict DTO Mapping (No Ghost Properties)
          const cleanOpt = {
            optionId: opt.optionId,
            key: key,
            name: name,
            fieldType: opt.fieldType,
            required: opt.required || false,
            skuContributor: opt.skuContributor || false,
          };

          // Liferay Headless Commerce API (v1.0) expects 'productOptionValues'
          const sourceValues = opt.productOptionValues || opt.values || [];

          if (sourceValues.length > 0) {
            cleanOpt.productOptionValues = sourceValues.map((val) => {
              const valName =
                typeof val.name === 'string' ? { en_US: val.name } : val.name;
              return {
                key:
                  val.key || sanitizeForERC(valName?.en_US || valName || val),
                name: valName,
              };
            });
          }

          return cleanOpt;
        });

        await this.liferay.addProductOptions(
          config,
          product.id,
          cleanedOptions,
          product.externalReferenceCode // HARDENING: Pass ERC to bypass indexing race condition
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
      throw error;
    }
  }

  async _runProductSkusStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, options } = session.context;

    try {
      const preparedProducts = (productDataList || [])
        .map((pd) => {
          const lp = {
            catalogId: parseInt(config.catalogId, 10),
            name: toI18n(pd.name),
            productType: pd.productType || 'simple',
            externalReferenceCode: pd.externalReferenceCode,
          };

          const hasSkuContributingOptions = (
            pd.productOptions ||
            pd.options ||
            []
          ).some((o) => o.skuContributor);

          // If variants are enabled, generate all SKUs with option mappings
          if (
            options.generateSkuVariants &&
            hasSkuContributingOptions &&
            Array.isArray(pd.skuVariants)
          ) {
            lp.skus = pd.skuVariants.map((v) => {
              const sku = {
                sku: v.sku,
                externalReferenceCode: v.externalReferenceCode || v.sku,
                published: true,
                purchasable: true,
                skuOptions: [],
              };

              if (v.options) {
                sku.skuOptions = Object.entries(v.options)
                  .map(([optName, valName]) => {
                    const optMeta = (
                      pd.productOptions ||
                      pd.options ||
                      []
                    ).find(
                      (o) =>
                        sanitizeForERC(o.name) === sanitizeForERC(optName) ||
                        o.key === optName
                    );

                    const valMeta = (optMeta?.optionValuesWithIds || []).find(
                      (vMeta) =>
                        sanitizeForERC(vMeta.name) ===
                        sanitizeForERC(String(valName))
                    );

                    return {
                      optionId: optMeta?.optionId || 0,
                      optionValueId: valMeta?.optionValueId || 0,
                    };
                  })
                  .filter((o) => o.optionId > 0);
              }
              return sku;
            });
          } else if (Array.isArray(pd.skus) && pd.skus.length > 0) {
            // Fallback for simple products or if variants disabled
            lp.skus = pd.skus.map((s) => ({
              sku: s.sku,
              externalReferenceCode: s.externalReferenceCode || s.sku,
              published: true,
              purchasable: true,
            }));
          }

          return this._cleanProductForLiferay(lp);
        })
        .filter((p) => Array.isArray(p.skus) && p.skus.length > 0);

      if (preparedProducts.length > 0) {
        // HARDENING: Brief delay to allow Liferay's Option links to propagate
        // before we attempt to create SKUs that use those links.
        await delay(2000);

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
              }),
            batch.length
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
      throw error;
    }
  }

  async _runLoadMetadataStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Loading Liferay metadata for AI grounding', {
      sessionId,
    });

    try {
      // 1. Fetch available languages for the site
      // 2. Fetch available currencies for the catalog
      // 3. Fetch taxonomy vocabularies and categories for the site
      const [languages, currencies, vocabularies] = await Promise.all([
        this.liferay.getLanguages(config, config.siteGroupId),
        this.liferay.getCurrencies(config),
        this.liferay.getTaxonomyVocabularies(config, config.siteGroupId),
      ]);

      // Flatten vocabularies and categories for easier AI consumption
      const vocabWithCategories = await Promise.all(
        (vocabularies || []).map(async (v) => {
          try {
            const categories = await this.liferay.getTaxonomyCategories(
              config,
              v.id
            );
            return {
              name: v.name,
              categories: (categories || []).map((c) => ({
                id: c.id,
                name: c.name,
                erc: c.externalReferenceCode,
              })),
            };
          } catch (_e) {
            return { name: v.name, categories: [] };
          }
        })
      );

      await this.persistence.updateSessionContext(sessionId, {
        groundingMetadata: {
          languages: (languages?.items || languages || []).map((l) => ({
            id: l.id,
            name: l.name,
            default: l.markedAsDefault,
          })),
          currencies: (currencies || []).map((c) => ({
            code: c.code,
            name: fromI18n(c.name),
            active: c.active,
          })),
          vocabularies: vocabWithCategories,
        },
      });

      await this.completeSyncStep(sessionId, S.LOAD_METADATA);
    } catch (error) {
      this.logger.error('Failed to load Liferay metadata for grounding', {
        sessionId,
        error: error.message,
      });
      // Non-fatal, continue without grounding
      await this.completeSyncStep(sessionId, S.LOAD_METADATA, 'WARNING');
    }
  }

  async _runProductDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, groundingMetadata } = session.context;

    try {
      const allData = await this._generateProductData(
        config,
        { ...options, groundingMetadata },
        sessionId,
        session.correlationId
      );
      await this.persistence.updateSessionContext(sessionId, {
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
      throw error;
    }
  }

  async _runEnsureSpecificationCategoriesStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config } = session.context;

    this.logger.info('Starting ensure specification categories step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      // For now, we ensure a default "General" specification category exists
      const defaultCategory = {
        externalReferenceCode: buildKeyedERC({
          prefix: ERC_PREFIX.OPTION_CATEGORY,
          category: 'SPC',
          key: 'general',
        }),
        key: 'general',
        title: { en_US: 'General' },
        description: { en_US: 'Auto-generated general specification group' },
      };

      const liferayCategory =
        await this.liferay.createSpecificationCategoryWithReuse(
          config,
          defaultCategory
        );

      await this.persistence.updateSessionContext(sessionId, {
        // HARDENING: Store the full category metadata object
        defaultSpecificationCategory: {
          id: liferayCategory.id,
          key: liferayCategory.key || defaultCategory.key,
          title: liferayCategory.title || defaultCategory.title,
        },
        defaultSpecificationCategoryId: liferayCategory.id, // Keep legacy for safety
      });

      await this.completeSyncStep(
        sessionId,
        S.ENSURE_SPECIFICATION_CATEGORIES,
        'SYNCHRONOUS',
        1,
        1
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed ensure specification categories step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.ENSURE_SPECIFICATION_CATEGORIES,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runEnsureSpecificationsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, defaultSpecificationCategory } =
      session.context;

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
        const specs =
          product.productSpecifications || product.specifications || [];
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

      this.logger.debug(
        `Synchronizing ${uniqueKeys.length} specification definitions...`,
        {
          sessionId,
          keys: uniqueKeys,
        }
      );

      // 2. Ensure each specification exists in Liferay
      let createdCount = 0;
      const updatedProductDataList = JSON.parse(
        JSON.stringify(productDataList)
      );

      for (const key of uniqueKeys) {
        const spec = specMap.get(key);
        const title = spec.title || spec.name || { en_US: toI18n(key).en_US };

        const liferaySpec = await this.liferay.createSpecificationWithReuse(
          config,
          {
            externalReferenceCode: buildSpecificationERC(key),
            key: key,
            title: typeof title === 'string' ? { en_US: title } : title,
            description: { en_US: `Auto-generated specification for ${key}` },
            // HARDENING: Use full metadata object to satisfy Liferay's strict validation
            optionCategory: defaultSpecificationCategory,
          }
        );

        // Update all products that use this specification with the real specificationId
        if (liferaySpec?.id) {
          for (const product of updatedProductDataList) {
            const productSpecs =
              product.productSpecifications || product.specifications || [];
            for (const pSpec of productSpecs) {
              const pKey =
                pSpec.specificationKey ||
                sanitizeForERC(pSpec.label?.en_US || pSpec.label);
              if (pKey === key) {
                pSpec.specificationId = liferaySpec.id;
              }
            }
          }
        }
        createdCount++;
      }

      // Save the updated product data with specificationIds back to context
      await this.persistence.updateSessionContext(sessionId, {
        productDataList: updatedProductDataList,
      });

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
      throw error;
    }
  }

  async _runEnsureOptionsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList } = session.context;

    if (!productDataList || productDataList.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.ENSURE_OPTIONS,
        'BYPASSED'
      );
    }

    this.logger.info('Starting ensure options step', {
      sessionId,
      correlationId: session.correlationId,
    });

    try {
      // 1. Identify all unique options used in the generated data
      const optionMap = new Map();
      for (const product of productDataList) {
        const options = product.productOptions || product.options || [];
        for (const opt of options) {
          const key = opt.key || sanitizeForERC(opt.name?.en_US || opt.name);
          if (key) {
            optionMap.set(key, opt);
          }
        }
      }

      const uniqueKeys = Array.from(optionMap.keys());
      if (uniqueKeys.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.ENSURE_OPTIONS,
          'BYPASSED'
        );
      }

      this.logger.debug(
        `Synchronizing ${uniqueKeys.length} option definitions...`,
        {
          sessionId,
          keys: uniqueKeys,
        }
      );

      // 2. Ensure each option exists in Liferay
      let processedCount = 0;
      const updatedProductDataList = JSON.parse(
        JSON.stringify(productDataList)
      );

      for (const key of uniqueKeys) {
        const sourceOpt = optionMap.get(key);

        const optionData = {
          externalReferenceCode: buildKeyedERC({
            prefix: ERC_PREFIX.OPTION,
            category: 'OPT',
            key: key,
          }),
          key: key,
          name:
            typeof sourceOpt.name === 'string'
              ? { en_US: sourceOpt.name }
              : sourceOpt.name,
          fieldType: sourceOpt.fieldType || 'select',
          skuContributor:
            sourceOpt.skuContributor !== undefined
              ? sourceOpt.skuContributor
              : true,
        };

        // Handle Option Values if applicable
        const sourceValues =
          sourceOpt.productOptionValues || sourceOpt.values || [];
        if (
          sourceValues.length > 0 &&
          COMMERCE_CONSTRAINTS.FIELD_TYPES_WITH_VALUES.includes(
            optionData.fieldType?.toLowerCase()
          )
        ) {
          optionData.optionValues = sourceValues.map((v) => {
            const vName =
              typeof v.name === 'string' ? { en_US: v.name } : v.name;
            return {
              key: v.key || sanitizeForERC(vName?.en_US || vName || v),
              name: vName,
            };
          });
        }

        const liferayOption = await this.liferay.createOptionWithReuse(
          config,
          optionData
        );

        // Map IDs back to productDataList
        if (liferayOption?.id) {
          const valueNameToIdMap = new Map();
          if (Array.isArray(liferayOption.optionValues)) {
            liferayOption.optionValues.forEach((v) => {
              // Normalize name for matching
              const vName =
                typeof v.name === 'string'
                  ? v.name
                  : fromI18n(v.name_i18n || v.name);
              if (vName) valueNameToIdMap.set(vName.toLowerCase(), v.id);
            });
          }

          for (const product of updatedProductDataList) {
            const productOpts = product.productOptions || product.options || [];
            for (const pOpt of productOpts) {
              const pKey =
                pOpt.key || sanitizeForERC(pOpt.name?.en_US || pOpt.name);
              if (pKey === key) {
                pOpt.optionId = liferayOption.id;
                pOpt.key = key;

                // Also map value IDs if they exist
                const pValues = pOpt.productOptionValues || pOpt.values || [];
                pOpt.optionValuesWithIds = pValues.map((val) => {
                  const valName =
                    typeof val === 'string'
                      ? val
                      : fromI18n(val.name_i18n || val.name || val);
                  return {
                    name: valName,
                    optionValueId: valName
                      ? valueNameToIdMap.get(valName.toLowerCase())
                      : null,
                  };
                });
              }
            }
          }
        }
        processedCount++;
      }

      // Save the updated product data with optionIds back to context
      await this.persistence.updateSessionContext(sessionId, {
        productDataList: updatedProductDataList,
      });

      await this.completeSyncStep(
        sessionId,
        S.ENSURE_OPTIONS,
        'SYNCHRONOUS',
        processedCount,
        uniqueKeys.length
      );
    } catch (error) {
      const errorReferenceCode =
        resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);
      this.logger.error('Failed ensure options step', {
        sessionId,
        errorReferenceCode,
        error: error.message,
      });
      await this.persistence.createBatch({
        erc: createERC(ERC_PREFIX.BATCH),
        sessionId,
        stepKey: S.ENSURE_OPTIONS,
        status: 'FAILED',
      });
      throw error;
    }
  }

  async _runProductCreationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, options, defaultSpecificationCategoryId } =
      session.context;

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
          active: true,
          productConfiguration: {
            productTaxConfiguration: {
              taxCategory: 'Standard',
              taxable: true,
            },
          },
          externalReferenceCode: pd.externalReferenceCode,
          // HARDENING: Establishing indirect channel relationship at creation
          productChannels: [
            {
              channelId: parseInt(config.channelId, 10),
            },
          ],
          productSpecifications: (
            pd.productSpecifications ||
            pd.specifications ||
            []
          ).map((spec) => {
            const { externalReferenceCode: _erc, ...rest } = spec;
            return {
              ...rest,
              label:
                spec.label || toI18n(spec.title || spec.value || spec.name),
              value: spec.value || spec.title || spec.name,
              optionCategoryId: defaultSpecificationCategoryId,
              specificationId: spec.specificationId,
            };
          }),
        };

        const hasSkuContributingOptions = (
          pd.productOptions ||
          pd.options ||
          []
        ).some((o) => o.skuContributor);

        if (pd.skus && pd.skus.length > 0) {
          // Rule: If product has SKU-contributing options, omit SKUs in initial payload
          // because they must be created AFTER options are linked to have correct skuOptions.
          if (options.generateSkuVariants && hasSkuContributingOptions) {
            this.logger.debug(
              `Omitting SKUs for ${pd.externalReferenceCode} due to SKU-contributing options`,
              { sessionId }
            );
          } else {
            lp.skus = pd.skus.slice(0, 1).map((s) => ({
              sku: s.sku,
              externalReferenceCode: s.externalReferenceCode || s.sku,
              published: true,
              purchasable: true,
            }));
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
      throw error;
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
      throw error;
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
      throw error;
    }
  }

  async _runUpdateInventoryStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, options, productDataList } = session.context;

    // Hard-resolving warehouses to ensure we have IDs and ERCs
    const { items: warehouses } = await this.liferay.getWarehouses(config);

    if (!warehouses || warehouses.length === 0) {
      return await this.completeSyncStep(
        sessionId,
        S.UPDATE_INVENTORY,
        'BYPASSED'
      );
    }

    try {
      this.logger.info(
        `Starting inventory update for ${productDataList.length} products across ${warehouses.length} warehouses...`,
        { sessionId }
      );

      // HARDENING: Brief delay to allow SKUs to be indexed by Liferay
      // Inventory requires the SKU string to be 'resolvable' by the backend.
      await delay(3000);

      const inventoryItems = [];
      const {
        inventoryMin = 10,
        inventoryMax = 100,
        inventoryAssignmentRatio = 100,
      } = options;

      for (const pd of productDataList) {
        // Roll dice for assignment ratio
        if (Math.random() * 100 > inventoryAssignmentRatio) continue;

        const skus = pd.skus || [];
        for (const sku of skus) {
          if (!sku.sku) continue;

          // Assign to a random warehouse
          const warehouse =
            warehouses[Math.floor(Math.random() * warehouses.length)];

          inventoryItems.push({
            sku: sku.sku,
            quantity:
              Math.floor(Math.random() * (inventoryMax - inventoryMin + 1)) +
              inventoryMin,
            warehouseId: warehouse.id,
          });
        }
      }

      if (inventoryItems.length > 0) {
        await this.submitBatch(
          sessionId,
          S.UPDATE_INVENTORY,
          'inventory',
          'generate',
          (erc) =>
            this.liferay.createWarehouseItemsBatch(config, inventoryItems, {
              externalReferenceCode: erc,
              sessionId,
            }),
          inventoryItems.length
        );
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
      throw error;
    }
  }

  async _generateProductData(config, options, _sessionId, _correlationId) {
    const data = await this.ctx.generation.generateData(
      'product',
      options.productCount,
      config,
      options
    );
    return data.map((p) => ({
      ...p,
      // HARDENING: Always generate fresh ERCs for products
      externalReferenceCode: createERC(ERC_PREFIX.PRODUCT),
      // Liferay Commerce ignores nested SKU ERCs during product creation and uses the SKU code.
      // We must use the SKU code as the ERC to ensure successful resolution later.
      skus: (p.skus || []).map((s) => ({
        ...s,
        externalReferenceCode: s.externalReferenceCode || s.sku,
      })),
      skuVariants: (p.skuVariants || []).map((v) => ({
        ...v,
        externalReferenceCode: v.externalReferenceCode || v.sku,
      })),
    }));
  }

  _cleanProductForLiferay(product, options = {}) {
    let clean = this.deepClean(product);

    if (options.stripSkuOptions && clean.skus) {
      clean.skus = clean.skus.map((s) => {
        const { skuOptions: _skuOptions, ...rest } = s;
        return rest;
      });
    }

    return clean;
  }

  async handleBatchCallback(_sessionId, batchERC) {
    const batch = await this.persistence.getBatch(batchERC);
    if (
      [
        S.GENERATE_PRICE_LISTS,
        S.GENERATE_BULK_PRICING,
        S.GENERATE_TIER_PRICING,
      ].includes(batch.step_key)
    ) {
      await this._verifyPricing(_sessionId, batchERC);
    }
  }

  async _verifyPricing(_sessionId, _batchERC) {
    return true;
  }
}

module.exports = ProductGenerator;
