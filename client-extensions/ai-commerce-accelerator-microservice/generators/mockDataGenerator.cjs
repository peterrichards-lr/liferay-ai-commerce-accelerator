const {
  createERC,
  getRandomInt,
  toERCPart,
  buildStableERC,
  randomString,
  randomPastDate,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

class MockDataGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.logger = ctx.logger;
  }

  /**
   * Generic generate method to match GenerationFacade signature.
   */
  async generate(entityType, count, config, options = {}) {
    const methodMap = {
      product: 'generateProductData',
      account: 'generateAccountData',
      order: 'generateOrderData',
      warehouse: 'generateWarehouseData',
      pricing: 'generatePricingData',
    };

    const methodName = methodMap[entityType];
    if (!methodName || typeof this[methodName] !== 'function') {
      throw new Error(
        `MockDataGenerator: Unsupported entity type: ${entityType}`
      );
    }

    const selectedLanguages = options.selectedLanguages || ['en-US'];

    if (entityType === 'product') {
      return this.generateProductData(
        options.category || 'Electronics',
        count,
        config,
        null, // model
        selectedLanguages,
        options
      );
    } else if (entityType === 'account') {
      return this.generateAccountData(
        count,
        config,
        null, // model
        options.categories || [],
        selectedLanguages
      );
    } else if (entityType === 'order') {
      return this.generateOrderData(
        options.products || [],
        options.accounts || [],
        count,
        config,
        null,
        selectedLanguages
      );
    } else if (entityType === 'warehouse') {
      return this.generateWarehouseData(count, config, null, selectedLanguages);
    } else if (entityType === 'pricing') {
      return this.generatePricingData(
        options.products || [],
        options.pricingType || 'standard',
        config,
        null,
        selectedLanguages
      );
    }
  }

  async generateProducts(config, options) {
    const count = options.productCount || options.count || 1;
    const products = this.generateProductData(
      options.category || 'Electronics',
      count,
      config,
      null, // model
      options.selectedLanguages || ['en-US'],
      options
    );

    if (options.onProgress) {
      options.onProgress(100);
    }

    return {
      created: products.length,
      products,
      errors: [],
    };
  }

  async generateOrders(config, options) {
    const count = options.orderCount || options.count || 1;
    // We need some mock accounts and products to link to orders
    const accounts = this.generateAccountData(5);
    const products = this.generateProductData('Electronics', 10);

    const orders = this.generateOrderData(
      products,
      accounts,
      count,
      config,
      null,
      options.selectedLanguages || ['en-US']
    );

    if (options.onProgress) {
      options.onProgress(100);
    }

    return {
      created: orders.length,
      orders,
      errors: [],
    };
  }

  generateProductData(
    category,
    count = 1,
    config = {},
    _model = null,
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const products = [];

    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const { generateSkuVariants, generatePriceLists } = options;

    const categoryCode = toERCPart(category, 3);
    const localeSuffixMap = Object.fromEntries(
      languageCodes.map((lc) => [lc, lc === 'en_US' ? '' : ` (${lc})`])
    );

    // Realistic content templates
    const adjectives = [
      'Professional',
      'Industrial',
      'Advanced',
      'Ultra',
      'Smart',
      'Elite',
    ];
    const features = [
      'High Performance',
      'Eco-Friendly',
      'Durable Design',
      'Cutting Edge',
      'Versatile',
    ];

    for (let i = 0; i < count; i++) {
      const baseErc = createERC(ERC_PREFIX.PRODUCT);
      const basePrice = getRandomInt(500, 1500);
      const sku = `SKU-${categoryCode}-${String(i + 1).padStart(3, '0')}`;
      const adj = adjectives[i % adjectives.length];
      const feat = features[i % features.length];

      const productData = {
        // HARDENING: Removed placeholder ID to force physical resolution
        externalReferenceCode: baseErc,
        name: {},
        description: {},
        shortDescription: {},
        urls: {},
        productType: 'simple',
        active: true,
        catalogId: config.catalogId,
        category: category,
        baseSku: sku,
        productStatus: 0, // Published
      };

      for (const lang of languageCodes) {
        const suffix = localeSuffixMap[lang] || '';
        const name = `${adj} ${category} ${i + 1}`;
        productData.name[lang] = `${name}${suffix}`;
        productData.description[lang] =
          `The ${name} is a ${feat.toLowerCase()} solution designed for ${category.toLowerCase()} professionals. It offers reliability and performance in any environment.${suffix}`;
        productData.shortDescription[lang] =
          `${adj} ${category} with ${feat.toLowerCase()}.${suffix}`;
        productData.urls[lang] =
          `${name.toLowerCase().replace(/\s+/g, '-')}-${i + 1}`;
      }

      // Metadata (Optional in schema but good for realism)
      productData.metaTitle = { ...productData.name };
      productData.metaDescription = { ...productData.shortDescription };

      if (options.imageMode && options.imageMode !== 'none') {
        productData.images = [
          {
            src: 'https://picsum.photos/1024/1024',
            title: Object.fromEntries(
              languageCodes.map((l) => [l, productData.name[l]])
            ),
            priority: 1,
            type: 'main',
          },
        ];
      }

      if (options.pdfMode && options.pdfMode !== 'none') {
        productData.attachments = [`manual-${sku.toLowerCase()}.pdf`];
      }

      if (generateSkuVariants) {
        productData.productOptions = [
          {
            name: { en_US: 'Color' },
            fieldType: 'select',
            skuContributor: true,
            productOptionValues: [
              { name: { en_US: 'Red' }, key: 'red' },
              { name: { en_US: 'Blue' }, key: 'blue' },
              { name: { en_US: 'Green' }, key: 'green' },
            ],
          },
          {
            name: { en_US: 'Size' },
            fieldType: 'select',
            skuContributor: true,
            productOptionValues: [
              { name: { en_US: 'Small' }, key: 'small' },
              { name: { en_US: 'Medium' }, key: 'medium' },
              { name: { en_US: 'Large' }, key: 'large' },
            ],
          },
        ];

        productData.skuVariants = [];
        // Generate a subset of combinations for realism
        const colors = ['Red', 'Blue'];
        const sizes = ['Small', 'Medium'];

        for (const color of colors) {
          for (const size of sizes) {
            const variantSku = `${sku}-${color.toUpperCase()}-${size.toUpperCase()}`;
            const variantPriceModifier = size === 'Medium' ? 0.1 : 0;
            const variantPrice = basePrice * (1 + (variantPriceModifier || 0));

            productData.skuVariants.push({
              // HARDENING: Removed placeholder ID to force physical resolution
              sku: variantSku,
              options: {
                Color: color,
                Size: size,
              },
              price: variantPrice,
              priceModifier: variantPriceModifier,
              inStock: true,
              externalReferenceCode: variantSku, // Ensure ERC is present for resolution
            });
          }
        }
      }

      // Add mock specifications
      productData.productSpecifications = [
        {
          specificationKey: 'brand',
          value: { en_US: 'AICA Elite' },
        },
        {
          specificationKey: 'material',
          value: { en_US: 'Industrial Grade' },
        },
      ];

      // Every product must have at least one SKU object in the 'skus' array
      productData.skus = [
        {
          // HARDENING: Removed placeholder ID to force physical resolution
          sku: sku,
          externalReferenceCode: sku,
          published: true,
          purchasable: true,
          price: basePrice,
          cost: basePrice * 0.6,
          inventoryLevel: getRandomInt(10, 100),
          neverExpire: true,
        },
      ];

      if (generatePriceLists) {
        productData.priceEntries = this.generatePriceEntries(
          sku,
          basePrice,
          i,
          productData.skuVariants || [],
          options
        );
      }

      products.push(productData);
    }

    return products;
  }

  generatePriceEntries(
    baseSku,
    basePrice,
    productIndex,
    skuVariants = [],
    options = {}
  ) {
    const entries = [];
    const catalogId = options.catalogId;
    const generalListERC =
      options.priceListERC ||
      (catalogId
        ? buildStableERC(ERC_PREFIX.PRICE_LIST, ['GENERAL', catalogId])
        : 'AICA-PL-GENERAL');

    const mainEntry = {
      price: basePrice,
      promoPrice: productIndex % 5 === 0 ? basePrice * 0.8 : null,
      skuExternalReferenceCode: baseSku,
      priceListExternalReferenceCode: generalListERC,
      externalReferenceCode: buildStableERC('PE', [baseSku, generalListERC]),
      discountDiscovery: false,
    };

    if (options.generateBulkPricing) {
      mainEntry.bulkPricing = true;
      mainEntry.tierPrices = [
        {
          minimumQuantity: 10,
          price: basePrice * 0.9,
          externalReferenceCode: buildStableERC('TP', [
            baseSku,
            generalListERC,
            '10',
          ]),
        },
        {
          minimumQuantity: 50,
          price: basePrice * 0.8,
          externalReferenceCode: buildStableERC('TP', [
            baseSku,
            generalListERC,
            '50',
          ]),
        },
      ];
    } else if (options.generateTierPricing) {
      mainEntry.bulkPricing = false;
      mainEntry.tierPrices = [
        {
          minimumQuantity: 5,
          price: basePrice * 0.95,
          externalReferenceCode: buildStableERC('TP', [
            baseSku,
            generalListERC,
            '5',
          ]),
        },
        {
          minimumQuantity: 20,
          price: basePrice * 0.85,
          externalReferenceCode: buildStableERC('TP', [
            baseSku,
            generalListERC,
            '20',
          ]),
        },
      ];
    }

    entries.push(mainEntry);

    for (const variant of skuVariants) {
      const vEntry = {
        price: variant.price || basePrice * (1 + (variant.priceModifier || 0)),
        skuExternalReferenceCode: variant.sku,
        priceListExternalReferenceCode: generalListERC,
        externalReferenceCode: buildStableERC('PE', [
          variant.sku,
          generalListERC,
        ]),
        discountDiscovery: false,
      };
      entries.push(vEntry);
    }

    return entries;
  }

  async generateAccounts(config, options) {
    const count = options.accountCount || options.count || 1;
    const accounts = this.generateAccountData(
      count,
      config,
      null, // model
      options.categories || [],
      options.selectedLanguages || ['en-US']
    );

    if (options.onProgress) {
      options.onProgress(100);
    }

    return {
      created: accounts.length,
      accounts,
      errors: [],
    };
  }

  generateAccountData(
    count = 1,
    _config = {},
    _model = null,
    _categories = [],
    _selectedLanguages = ['en-US']
  ) {
    const accounts = [];

    for (let i = 0; i < count; i++) {
      const baseErc = createERC(ERC_PREFIX.ACCOUNT);
      const suffix = randomString(4);
      const accountName = `Mock Account ${i + 1} (${suffix})`;
      const email = `contact-${suffix.toLowerCase()}@example.com`;

      const accountData = {
        // HARDENING: Removed placeholder ID to force physical resolution
        externalReferenceCode: baseErc,
        name: accountName,
        type: 'business',
        description: `Generated mock business account for ${accountName}.`,
        domains: [`${suffix.toLowerCase()}.example.com`],
        accountContactInformation: {
          emailAddresses: [
            {
              emailAddress: email,
              primary: true,
              type: 'email-address',
            },
          ],
        },
        headOfficeAddress: {
          streetAddressLine1: `${getRandomInt(100, 999)} Main St`,
          addressLocality: 'Los Angeles',
          addressRegion: 'CA',
          addressCountry: 'United States',
          postalCode: '90001',
          name: 'Head Office',
        },
        billingAddress: {
          streetAddressLine1: `${getRandomInt(100, 999)} Finance Way`,
          addressLocality: 'New York',
          addressRegion: 'NY',
          addressCountry: 'United States',
          postalCode: '10001',
          name: 'Billing Dept',
        },
        shippingAddress: {
          streetAddressLine1: `${getRandomInt(100, 999)} Logistics Ave`,
          addressLocality: 'Chicago',
          addressRegion: 'IL',
          addressCountry: 'United States',
          postalCode: '60601',
          name: 'Main Warehouse',
        },
      };

      accounts.push(accountData);
    }

    return accounts;
  }

  generateOrderData(
    products = [],
    accounts = [],
    count = 1,
    _config = {},
    _model = null,
    _selectedLanguages = ['en-US']
  ) {
    const orders = [];

    // Safety fallback for Demo Mode if arrays are empty
    const poolAccounts =
      accounts.length > 0 ? accounts : this.generateAccountData(5);
    const poolProducts =
      products.length > 0
        ? products
        : this.generateProductData('Electronics', 10);

    for (let i = 0; i < count; i++) {
      const account = poolAccounts[i % poolAccounts.length];
      const product = poolProducts[i % poolProducts.length];
      const skuObj =
        product.skus && product.skus.length > 0
          ? product.skus[0]
          : { sku: 'MOCK-SKU', price: 100 };

      orders.push({
        externalReferenceCode: createERC(ERC_PREFIX.ORDER),
        accountId: account?.id || 10000 + i,
        orderDate: randomPastDate(30).toISOString(),
        orderStatus: 0,
        orderItems: [
          {
            sku: skuObj.sku,
            skuExternalReferenceCode: skuObj.sku,
            quantity: getRandomInt(1, 5),
            unitPrice: skuObj.price || 100,
          },
        ],
      });
    }
    return orders;
  }

  generateWarehouseData(
    count = 1,
    _config = {},
    _model = null,
    selectedLanguages = ['en-US']
  ) {
    const warehouses = [];
    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const catalogId = _config.catalogId || 'GLOBAL';
    for (let i = 0; i < count; i++) {
      const warehouse = {
        externalReferenceCode: buildStableERC(ERC_PREFIX.WAREHOUSE, [
          `Mock Warehouse ${i + 1}`,
          catalogId,
          'LA',
        ]),
        name: {},
        description: {},
        city: 'Los Angeles',
        street1: `${getRandomInt(100, 9999)} Commerce Blvd`,
        zip: '90001',
        country: 'US',
        region: 'CA',
        latitude: 34.0522,
        longitude: -118.2437,
        active: true,
      };

      for (const lang of languageCodes) {
        warehouse.name[lang] =
          `Mock Warehouse ${i + 1}${lang === 'en_US' ? '' : ` (${lang})`}`;
        warehouse.description[lang] =
          `Primary distribution center for ${lang} region.`;
      }

      warehouses.push(warehouse);
    }
    return warehouses;
  }

  generatePricingData(
    products = [],
    _pricingType = 'standard',
    _config = {},
    _model = null,
    _selectedLanguages = ['en-US']
  ) {
    return products.map((p) => ({
      skuExternalReferenceCode: p.sku || p.skus?.[0]?.sku,
      price: getRandomInt(10, 1000),
    }));
  }
}

module.exports = MockDataGenerator;
