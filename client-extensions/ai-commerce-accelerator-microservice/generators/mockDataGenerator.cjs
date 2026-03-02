const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const {
  createERC,
  buildSpecCatERC,
  getRandomInt,
  toERCPart,
  randomString,
  randomPastDate,
  randomFutureDate,
} = require('../utils/misc.cjs');
const { ERC_PREFIX, ENV } = require('../utils/constants.cjs');
const { asItems } = require('../utils/liferayUtils.cjs');

class MockDataGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
    this.schemas = {};
    this._loadSchemas();
  }

  _loadSchemas() {
    const schemaDir = path.join(__dirname, '../ai-schemas');
    const files = fs.readdirSync(schemaDir);
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    for (const file of files) {
      if (file.endsWith('.json')) {
        const schemaName = path.basename(file, '.json');
        const schemaContent = JSON.parse(
          fs.readFileSync(path.join(schemaDir, file), 'utf8')
        );
        this.schemas[schemaName] = ajv.compile(schemaContent);
      }
    }
  }

  generateProducts(config, options = {}) {
    const count = options.count || options.productCount || 1;
    const category =
      Array.isArray(options.categories) && options.categories.length
        ? options.categories[0]
        : 'Electronics';
    const selectedLanguages =
      options.selectedLanguages && options.selectedLanguages.length
        ? options.selectedLanguages
        : ['en-US'];

    const products = this.generateProductData(
      category,
      count,
      selectedLanguages,
      config,
      options
    );

    return {
      created: products.length,
      products,
      errors: [],
      batchId: null,
    };
  }

  async generateAccounts(config, options = {}) {
    const count = options.accountCount || 1;
    const categories = options.categories || [];
    const accounts = await this.generateAccountData(
      count,
      config,
      categories,
      options
    );

    return {
      created: accounts.length,
      accounts,
      errors: [],
      batchId: null,
    };
  }

  generateProductData(
    category,
    count = 1,
    selectedLanguages = ['en-US'],
    config = {},
    options = {}
  ) {
    const logger = this.logger;
    const products = [];

    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const {
      generateSkuVariants,
      generatePriceLists,
      generateBulkPricing,
      generateTierPricing,
      imageMode,
      imageRatio,
      pdfMode,
      pdfRatio,
    } = options;

    const categoryCode = toERCPart(category, 3);
    const localeSuffixMap = Object.fromEntries(
      languageCodes.map((lc) => [lc, lc === 'en_US' ? '' : ` (${lc})`])
    );

    for (let i = 0; i < count; i++) {
      const baseErc = createERC(ERC_PREFIX.PRODUCT);
      const basePrice = getRandomInt(500, 1500);
      const pricing = { basePrice };
      const sku = `SKU-${categoryCode}-${String(i + 1).padStart(3, '0')}`;

      const productData = {
        externalReferenceCode: baseErc,
        name: {},
        description: {},
        productType: 'simple',
        active: true,
        catalogId: config.catalogId,
        category: category,
      };

      for (const lang of languageCodes) {
        const suffix = localeSuffixMap[lang] || '';
        productData.name[lang] = `Mock ${category} Product ${i + 1}${suffix}`;
        productData.description[lang] =
          `High quality ${category.toLowerCase()} item for professional use.${suffix}`;
      }

      // Add image metadata placeholders if images are enabled
      if (imageMode && imageMode !== 'none') {
        productData.images = [
          {
            src: 'placeholder.webp',
            title: Object.fromEntries(languageCodes.map(l => [l, 'Product Image'])),
            priority: 1
          }
        ];
      }

      // Add attachment metadata placeholders if PDFs are enabled
      if (pdfMode && pdfMode !== 'none') {
        productData.attachments = ['manual.pdf'];
      }

      if (generateSkuVariants) {
        productData.productType = 'simple'; // Initial type is always simple
        productData.options = [
          {
            name: { en_US: 'Color' },
            fieldType: 'select',
            skuContributor: true,
            required: true,
            values: [
              { name: { en_US: 'Red' }, key: 'red' },
              { name: { en_US: 'Blue' }, key: 'blue' },
              { name: { en_US: 'Green' }, key: 'green' },
            ],
          },
          {
            name: { en_US: 'Size' },
            fieldType: 'select',
            skuContributor: true,
            required: true,
            values: [
              { name: { en_US: 'Small' }, key: 'small' },
              { name: { en_US: 'Medium' }, key: 'medium' },
              { name: { en_US: 'Large' }, key: 'large' },
            ],
          },
        ];

        productData.skuVariants = [];
        for (const color of ['red', 'blue']) {
          for (const size of ['small', 'medium']) {
            const variantSku = `${sku}-${color.toUpperCase()}-${size.toUpperCase()}`;
            const variantPrice = basePrice + (size === 'medium' ? 50 : 0);

            const variant = {
              sku: variantSku,
              externalReferenceCode: variantSku,
              price: variantPrice,
              active: true,
              published: true,
              purchasable: true,
              skuOptions: [
                { key: 'color', value: color },
                { key: 'size', value: size },
              ],
            };
            productData.skuVariants.push(variant);
          }
        }

        if (generatePriceLists) {
          productData.priceEntries = this.generatePriceEntries(
            sku,
            basePrice,
            pricing,
            i,
            productData.skuVariants,
            options
          );
        }
      } else {
        productData.skus = [
          {
            sku: sku,
            externalReferenceCode: sku,
            published: true,
            purchasable: true,
          },
        ];
        productData.defaultSku = sku;
        productData.productType = 'simple';

        if (generatePriceLists) {
          productData.priceEntries = this.generatePriceEntries(
            sku,
            basePrice,
            pricing,
            i,
            productData.skuVariants,
            options
          );
        }
      }

      products.push(productData);
    }

    const validate = this.schemas.product;
    if (validate) {
      const payload = { products: products };
      const isValid = validate(payload);
      if (!isValid) {
        logger?.error?.('Mock product data failed schema validation:', {
          errors: validate.errors,
          payload: JSON.stringify(payload, null, 2),
          correlationId: options?.correlationId,
        });
      } else {
        this.logger?.info?.(
          'Mock product data validated successfully against schema.',
          { correlationId: options?.correlationId }
        );
      }
    }

    return products;
  }

  generatePriceEntries(
    baseSku,
    basePrice,
    pricingConfig,
    productIndex,
    skuVariants = [],
    options = {}
  ) {
    const entries = [];
    const baseErc = createERC(ERC_PREFIX.BATCH);

    const mainEntry = {
      price: basePrice,
      skuExternalReferenceCode: baseSku,
      priceListExternalReferenceCode: 'AICA-PL-GENERAL',
      externalReferenceCode: `PE-${baseSku}-GEN-${baseErc}`,
      discountDiscovery: false,
      sku: {
        basePrice: basePrice,
        basePromoPrice: productIndex % 5 === 0 ? basePrice * 0.8 : null,
      },
    };

    if (options.generateBulkPricing) {
      mainEntry.bulkPricing = true;
      mainEntry.tierPrices = [
        {
          minimumQuantity: 10,
          price: basePrice * 0.9,
          externalReferenceCode: `TP-${baseSku}-B10-${baseErc}`,
        },
        {
          minimumQuantity: 50,
          price: basePrice * 0.8,
          externalReferenceCode: `TP-${baseSku}-B50-${baseErc}`,
        },
      ];
    } else if (options.generateTierPricing) {
      mainEntry.bulkPricing = false;
      mainEntry.tierPrices = [
        {
          minimumQuantity: 5,
          price: basePrice * 0.95,
          externalReferenceCode: `TP-${baseSku}-T5-${baseErc}`,
        },
        {
          minimumQuantity: 20,
          price: basePrice * 0.85,
          externalReferenceCode: `TP-${baseSku}-T20-${baseErc}`,
        },
      ];
    }

    entries.push(mainEntry);

    for (const variant of skuVariants) {
      const vEntry = {
        price: variant.price,
        skuExternalReferenceCode: variant.sku,
        priceListExternalReferenceCode: 'AICA-PL-GENERAL',
        externalReferenceCode: `PE-${variant.sku}-GEN-${baseErc}`,
        discountDiscovery: false,
        sku: {
          basePrice: variant.price,
          basePromoPrice: null,
        },
      };
      entries.push(vEntry);
    }

    return entries;
  }

  async generateAccountData(
    count = 1,
    config = {},
    categories = [],
    options = {}
  ) {
    const accounts = [];
    const languageId = config.languageId || 'en_US';

    for (let i = 0; i < count; i++) {
      const baseErc = createERC(ERC_PREFIX.ACCOUNT);
      const accountName = `Mock Account ${i + 1} (${randomString(4)})`;

      const accountData = {
        externalReferenceCode: baseErc,
        name: accountName,
        type: 'business',
        description: `Generated mock business account for ${accountName}.`,
        postalAddresses: [
          {
            addressLine1: `${getRandomInt(100, 999)} Main St`,
            addressLocality: 'Los Angeles',
            addressRegion: 'CA',
            countryId: 'US',
            postalCode: '90001',
            addressType: 'other', // Head office address
            name: 'Head Office',
            externalReferenceCode: `ADDR-${baseErc}-HEAD`,
          },
        ],
      };

      accounts.push(accountData);
    }

    const validate = this.schemas.account;
    if (validate) {
      const payload = { accounts: accounts };
      const isValid = validate(payload);
      if (!isValid) {
        this.logger?.error?.('Mock account data failed schema validation:', {
          errors: validate.errors,
          correlationId: options?.correlationId,
        });
      }
    }

    return accounts;
  }
}

module.exports = MockDataGenerator;
