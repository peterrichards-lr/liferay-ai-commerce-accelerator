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

class MockDataGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
  }

  generateProductData(
    category,
    count = 1,
    selectedLanguages = ['en-US'],
    config = {},
    options = {}
  ) {
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

      if (imageMode && imageMode !== 'none') {
        productData.images = [
          {
            src: 'placeholder.webp',
            title: Object.fromEntries(languageCodes.map(l => [l, 'Product Image'])),
            priority: 1
          }
        ];
      }

      if (pdfMode && pdfMode !== 'none') {
        productData.attachments = ['manual.pdf'];
      }

      if (generateSkuVariants) {
        productData.productType = 'simple';
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

  generateAccountData(
    count = 1,
    config = {},
    categories = [],
    selectedLanguages = ['en-US']
  ) {
    const accounts = [];

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
            addressType: 'other',
            name: 'Head Office',
            externalReferenceCode: `ADDR-${baseErc}-HEAD`,
          },
        ],
      };

      accounts.push(accountData);
    }

    return accounts;
  }

  generateOrderData(count = 1, config = {}, accounts = [], selectedLanguages = ['en-US']) {
    const orders = [];
    for (let i = 0; i < count; i++) {
      const account = accounts[Math.floor(Math.random() * accounts.length)];
      orders.push({
        externalReferenceCode: createERC(ERC_PREFIX.ORDER),
        accountId: account?.id,
        orderDate: randomPastDate(30).toISOString(),
        orderStatus: 0
      });
    }
    return orders;
  }

  generateWarehouseData(count = 1, config = {}, selectedLanguages = ['en-US']) {
    const warehouses = [];
    for (let i = 0; i < count; i++) {
      warehouses.push({
        externalReferenceCode: createERC(ERC_PREFIX.WAREHOUSE),
        name: `Mock Warehouse ${i + 1}`,
        description: `Description for Warehouse ${i + 1}`,
        country: 'US',
        region: 'CA'
      });
    }
    return warehouses;
  }

  generatePricingData(products = [], pricingType = 'standard', config = {}, selectedLanguages = ['en-US']) {
    return products.map(p => ({
      skuExternalReferenceCode: p.sku,
      price: getRandomInt(10, 1000)
    }));
  }
}

module.exports = MockDataGenerator;
