const BaseGenerator = require('./baseGenerator.cjs');
const { createERC, delay } = require('../utils/misc.cjs');
const { ERC_PREFIX, WORKFLOW_STEPS } = require('../utils/constants.cjs');

const S = WORKFLOW_STEPS;

class PromoGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);
    this.steps = {
      [S.GENERATE_PROMO_DATA]: this._runPromoDataGenerationStep.bind(this),
      [S.CREATE_USER_SEGMENTS]: this._runCreateUserSegmentsStep.bind(this),
      [S.CREATE_PROMOTIONS]: this._runCreatePromotionsStep.bind(this),
    };
  }

  async _runWithRetry(fn, label, maxRetries = 5, initialDelay = 2000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isTransient =
          error.status === 404 ||
          error.status === 400 ||
          error.status >= 500 ||
          error.status === 429 ||
          error.message?.includes('404') ||
          error.message?.includes('400');

        if (!isTransient || attempt === maxRetries) {
          throw error;
        }

        const retryDelay = initialDelay * attempt;
        this.logger.warn(
          `[${label}] Attempt ${attempt} failed with status ${error.status || error.message}. Retrying in ${retryDelay}ms...`
        );
        await delay(retryDelay);
      }
    }
    throw lastError;
  }

  async runWorkflow(config, options) {
    const steps = [
      { name: S.GENERATE_PROMO_DATA, type: 'sync' },
      { name: S.CREATE_USER_SEGMENTS, type: 'sync' },
      { name: S.CREATE_PROMOTIONS, type: 'sync' },
    ];

    return await super.runWorkflow(config, options, 'promotions', steps);
  }

  async _runPromoDataGenerationStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, productDataList, accountDataList } = session.context;

    try {
      this.logger.info(
        'Generating commerce user segments and promotions data...',
        { sessionId }
      );

      let products = productDataList || [];
      let accounts = accountDataList || [];

      // Fallback: If no products or accounts in context, fetch them from Liferay
      if (products.length === 0) {
        const res = await this.liferay.getProducts(config, { pageSize: 10 });
        products = res.items || [];
      }
      if (accounts.length === 0) {
        const res = await this.liferay.getAccounts(config, { pageSize: 5 });
        accounts = res.items || [];
      }

      if (products.length === 0) {
        this.logger.warn(
          'No products available. Bypassing promotion generation.',
          { sessionId }
        );
        return await this.completeSyncStep(
          sessionId,
          S.GENERATE_PROMO_DATA,
          'BYPASSED'
        );
      }

      // Query AI service to generate segment and promotion rules
      const promoData = await this.ctx.ai.generatePromoData(
        products,
        accounts,
        session.context.options || {},
        { correlationId: sessionId }
      );

      const userSegments = promoData?.userSegments || [];
      const promotions = promoData?.promotions || [];

      // Align and format ERCs
      const sanitizedSegments = userSegments.map((seg) => {
        const rawErc =
          seg.externalReferenceCode || createERC(ERC_PREFIX.USER_SEGMENT);
        return {
          ...seg,
          name: seg.name ? seg.name.slice(0, 50) : undefined,
          description: seg.description
            ? seg.description.slice(0, 50)
            : undefined,
          externalReferenceCode: rawErc.slice(0, 50),
        };
      });

      const sanitizedPromotions = promotions.map((promo) => {
        // Find matching segment ERC
        const matchingSeg = sanitizedSegments.find(
          (s) => s.name.toLowerCase() === promo.targetSegmentName.toLowerCase()
        );
        const rawPromoErc =
          promo.externalReferenceCode || createERC(ERC_PREFIX.PROMOTION);
        return {
          ...promo,
          name: promo.name ? promo.name.slice(0, 50) : undefined,
          description: promo.description
            ? promo.description.slice(0, 50)
            : undefined,
          externalReferenceCode: rawPromoErc.slice(0, 50),
          targetSegmentERC:
            matchingSeg?.externalReferenceCode ||
            sanitizedSegments[0]?.externalReferenceCode,
        };
      });

      this.logger.info(
        `Generated ${sanitizedSegments.length} user segments and ${sanitizedPromotions.length} promotions.`,
        {
          sessionId,
        }
      );

      await this.persistence.updateSessionContext(sessionId, {
        userSegmentsDataList: sanitizedSegments,
        promotionsDataList: sanitizedPromotions,
      });

      return await this.completeSyncStep(sessionId, S.GENERATE_PROMO_DATA);
    } catch (error) {
      this.logger.error('Failed to generate promotion and segment data', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        sessionId,
        stepKey: S.GENERATE_PROMO_DATA,
        status: 'FAILED',
        errorDetails: error.message,
      });
      throw error;
    }
  }

  async _runCreateUserSegmentsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, userSegmentsDataList, accountDataList } = session.context;

    try {
      if (!userSegmentsDataList || userSegmentsDataList.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_USER_SEGMENTS,
          'BYPASSED'
        );
      }

      this.logger.info(
        `Creating ${userSegmentsDataList.length} Account Groups representing user segments...`,
        { sessionId }
      );

      for (const seg of userSegmentsDataList) {
        this.logger.debug(
          `Creating Account Group: ${seg.name} (${seg.externalReferenceCode})`,
          { sessionId }
        );

        // 1. Create the Account Group in Liferay if it doesn't exist
        let group = await this.liferay.getAccountGroupByERC(
          config,
          seg.externalReferenceCode
        );
        if (!group) {
          group = await this._runWithRetry(
            () =>
              this.liferay.createAccountGroup(config, {
                name: seg.name,
                description: seg.description,
                externalReferenceCode: seg.externalReferenceCode,
              }),
            `create-account-group:${seg.name}`
          );
        }

        // 2. Associate accounts with this group to qualify them
        if (accountDataList && accountDataList.length > 0) {
          // Assign 1-2 accounts to this group to make the segment populated
          const targetAccounts = accountDataList.slice(0, 2);
          for (const acc of targetAccounts) {
            if (acc.externalReferenceCode) {
              this.logger.debug(
                `Assigning Account ${acc.name} to Group ${seg.name}`,
                { sessionId }
              );
              await this._runWithRetry(
                () =>
                  this.liferay.assignAccountToGroup(
                    config,
                    seg.externalReferenceCode,
                    acc.externalReferenceCode
                  ),
                `assign-account-to-group:${acc.name}`
              );
            }
          }
        }
      }

      return await this.completeSyncStep(sessionId, S.CREATE_USER_SEGMENTS);
    } catch (error) {
      this.logger.error('Failed to create account groups / segments', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        sessionId,
        stepKey: S.CREATE_USER_SEGMENTS,
        status: 'FAILED',
        errorDetails: error.message,
      });
      throw error;
    }
  }

  async _runCreatePromotionsStep(sessionId) {
    const session = await this.persistence.getSession(sessionId);
    const { config, promotionsDataList, productDataList, pricingDataList } =
      session.context;

    try {
      if (!promotionsDataList || promotionsDataList.length === 0) {
        return await this.completeSyncStep(
          sessionId,
          S.CREATE_PROMOTIONS,
          'BYPASSED'
        );
      }

      // Resolve Catalog ID
      let catalogId = config.catalogId;
      if (!catalogId) {
        const catalogsRes = await this.liferay.getCatalogs(config);
        const catalogsList = Array.isArray(catalogsRes)
          ? catalogsRes
          : catalogsRes?.items || [];
        catalogId = catalogsList[0]?.id;
      }
      if (!catalogId) {
        throw new Error(
          'No default commerce catalog found to associate promotions.'
        );
      }

      // Resolve Default Currency Code
      const currencyCode = config.currencyCode || 'USD';

      this.logger.info(
        `Creating ${promotionsDataList.length} Commerce Promotions...`,
        { sessionId }
      );

      for (const promo of promotionsDataList) {
        this.logger.debug(
          `Creating Promotion Price List: ${promo.name} (${promo.externalReferenceCode})`,
          { sessionId }
        );

        // 1. Create the Promotion Price List
        let liferayPriceList = await this.liferay.getPriceListByERC(
          config,
          promo.externalReferenceCode
        );
        if (!liferayPriceList) {
          liferayPriceList = await this._runWithRetry(
            () =>
              this.liferay.createPriceList(config, {
                catalogId,
                currencyCode,
                name: promo.name,
                externalReferenceCode: promo.externalReferenceCode,
                active: true,
                neverExpire: true,
                type: 'promotion',
              }),
            `create-price-list:${promo.name}`
          );
        }

        // 2. Link Promotion Price List to the Account Group Segment
        if (promo.targetSegmentERC) {
          this.logger.debug(
            `Linking Promotion ${promo.name} to Account Group ${promo.targetSegmentERC}`,
            { sessionId }
          );

          // Resolve the account group from Liferay to get its ID
          const accountGroup = await this.liferay.getAccountGroupByERC(
            config,
            promo.targetSegmentERC
          );
          if (!accountGroup) {
            throw new Error(
              `Target Account Group segment ${promo.targetSegmentERC} not found.`
            );
          }

          await this._runWithRetry(
            () =>
              this.liferay.createPriceListAccountGroup(
                config,
                promo.externalReferenceCode,
                {
                  priceListId: liferayPriceList.id,
                  accountGroupId: accountGroup.id,
                  accountGroupExternalReferenceCode: promo.targetSegmentERC,
                }
              ),
            `link-promo-to-segment:${promo.name}`
          );
        }

        // 3. Create Promotional Price Entries for products
        if (productDataList && productDataList.length > 0) {
          const promoEntries = [];

          for (const product of productDataList) {
            // Find base price of the product
            let basePrice = 100; // Default fallback price
            if (pricingDataList?.priceEntries) {
              const matchedEntry = pricingDataList.priceEntries.find(
                (pe) =>
                  pe.skuExternalReferenceCode === product.sku ||
                  pe.sku === product.sku
              );
              if (matchedEntry?.price) {
                basePrice = matchedEntry.price;
              }
            }

            // Calculate promotional price with discount percentage
            const discountedPrice = parseFloat(
              (basePrice * (1 - promo.discountPercentage / 100)).toFixed(2)
            );

            // Resolve target SKU details to create the price entry for
            const allSkus = [
              ...(product.skus || []),
              ...(product.skuVariants || []),
            ];
            const activeSkus = allSkus.filter(
              (sku) => sku.id && sku.id !== 50000
            );

            if (activeSkus.length === 0) {
              const skuId = product.id;
              const skuERC = product.sku || product.externalReferenceCode;
              promoEntries.push({
                price: discountedPrice,
                priceListId: liferayPriceList.id,
                skuId,
                skuExternalReferenceCode: skuERC,
                externalReferenceCode: `${promo.externalReferenceCode}-PE-${skuERC}`,
                active: true,
              });
            } else {
              for (const sku of activeSkus) {
                const skuId = sku.id;
                const skuERC = sku.externalReferenceCode || sku.sku;
                promoEntries.push({
                  price: discountedPrice,
                  priceListId: liferayPriceList.id,
                  skuId,
                  skuExternalReferenceCode: skuERC,
                  externalReferenceCode: `${promo.externalReferenceCode}-PE-${skuERC}`,
                  active: true,
                });
              }
            }
          }

          await this.liferay.createPriceEntriesBatch(config, promoEntries, {
            sessionId,
            externalReferenceCode: liferayPriceList.externalReferenceCode,
            priceListExternalReferenceCode:
              liferayPriceList.externalReferenceCode,
            isPromotion: true,
          });
        }
      }

      return await this.completeSyncStep(sessionId, S.CREATE_PROMOTIONS);
    } catch (error) {
      this.logger.error('Failed to create promotions / pricing rules', {
        sessionId,
        error: error.message,
      });
      await this.persistence.createBatch({
        sessionId,
        stepKey: S.CREATE_PROMOTIONS,
        status: 'FAILED',
        errorDetails: error.message,
      });
      throw error;
    }
  }
}

module.exports = { PromoGenerator };
