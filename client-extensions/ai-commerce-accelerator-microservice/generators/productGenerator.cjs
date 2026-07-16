const BaseGenerator = require('./baseGenerator.cjs');
const { WORKFLOW_STEPS } = require('../utils/constants.cjs');

const metadata = require('./product-steps/metadata.cjs');
const generation = require('./product-steps/generation.cjs');
const categories = require('./product-steps/categories.cjs');
const specifications = require('./product-steps/specifications.cjs');
const products = require('./product-steps/products.cjs');
const skus = require('./product-steps/skus.cjs');
const pricing = require('./product-steps/pricing.cjs');
const media = require('./product-steps/media.cjs');
const inventory = require('./product-steps/inventory.cjs');

const S = WORKFLOW_STEPS;

class ProductGenerator extends BaseGenerator {
  constructor(ctx) {
    super(ctx);

    // To preserve backwards compatibility with `this` usage inside the extracted step files,
    // we bind them to the ProductGenerator instance.
    this.steps = {
      [S.LOAD_METADATA]: metadata.runLoadMetadataStep.bind(this),
      [S.GENERATE_PRODUCT_DATA]:
        generation.runProductDataGenerationStep.bind(this),
      [S.ENSURE_CATEGORIES]: categories.runEnsureCategoriesStep.bind(this),
      [S.ENSURE_SPECIFICATION_CATEGORIES]:
        specifications.runEnsureSpecificationCategoriesStep.bind(this),
      [S.ENSURE_SPECIFICATIONS]:
        specifications.runEnsureSpecificationsStep.bind(this),
      [S.ENSURE_OPTIONS]: specifications.runEnsureOptionsStep.bind(this),
      [S.CREATE_PRODUCTS]: products.runProductCreationStep.bind(this),
      [S.RESOLVE_PRODUCT_IDS]: products.runResolveProductIdsStep.bind(this),
      [S.LINK_PRODUCT_OPTIONS]: skus.runLinkProductOptionsStep.bind(this),
      [S.CREATE_PRODUCT_SKUS]: skus.runProductSkusStep.bind(this),
      [S.RESOLVE_SKU_IDS]: skus.runResolveSkuIdsStep.bind(this),
      [S.UPDATE_CATALOG_CONFIG]:
        pricing.runUpdateCatalogConfigurationStep.bind(this),
      [S.GENERATE_PRICE_LISTS]: pricing.runGeneratePriceListsStep.bind(this),
      [S.GENERATE_BULK_PRICING]: pricing.runGenerateBulkPricingStep.bind(this),
      [S.GENERATE_TIER_PRICING]: pricing.runGenerateTierPricingStep.bind(this),
      [S.ATTACH_IMAGES]: media.runAttachImagesStep.bind(this),
      [S.ATTACH_PDFS]: media.runAttachPdfsStep.bind(this),
      [S.UPDATE_INVENTORY]: inventory.runUpdateInventoryStep.bind(this),
    };
  }

  // Exposed helper methods required by the extracted steps
  _cleanProductForLiferay(product, options = {}) {
    return products.cleanProductForLiferay.call(this, product, options);
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
