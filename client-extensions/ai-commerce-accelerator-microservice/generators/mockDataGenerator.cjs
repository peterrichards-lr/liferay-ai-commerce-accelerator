const {
  createERC,
  getRandomInt,
  toERCPart,
  buildStableERC,
  randomString,
  randomPastDate,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

/**
 * Stands in for `aiService`, not for Liferay.
 *
 * `GenerationFacade.generateData` picks this class instead of `this.ctx.ai`
 * when `demoMode` is set and then runs the identical standardise -> validate ->
 * product-steps -> import pipeline, validating what comes back against the same
 * `generation-schemas` entry. So the contract is settled by the code that runs:
 * every method here must return what the AI is asked to return, and the
 * translation into Liferay's DTOs belongs downstream, where live mode does it.
 *
 * Two consequences that are easy to get wrong:
 *
 * - A property the generation schema does not declare cannot be produced in
 *   live mode at all. Since #690 the provider schema is projected from these
 *   files with objects closed, so an undeclared property is demo-only data, and
 *   any pipeline behaviour that depends on it is untested where it matters.
 * - Names matter even where ajv would tolerate the alternative. `options` and
 *   `specifications` are the generation schema's; `productOptions` and
 *   `productSpecifications` are Liferay's, produced later by the product steps.
 *   Emitting the latter here let demo mode take a different branch through
 *   thirteen dual reads than live mode takes.
 *
 * `tests/mockMatchesGenerationSchemas.test.cjs` enforces both. See #652.
 */
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
    const localize = (text) =>
      Object.fromEntries(
        languageCodes.map((lc) => [lc, `${text}${localeSuffixMap[lc] || ''}`])
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
        category: {},
        baseSku: sku,
      };

      for (const lang of languageCodes) {
        const suffix = localeSuffixMap[lang] || '';
        const name = `${adj} ${category} ${i + 1}`;
        productData.name[lang] = `${name}${suffix}`;
        productData.category[lang] = `${category}${suffix}`;
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
        // The generation schema's shape, not Liferay's: a plain `name` and
        // plain string values. `toOptionValues` turns those into the
        // `{ key, name }` pairs Liferay requires, at ensure-options and again
        // at link-product-options - which is the translation live mode goes
        // through, and so the one demo mode has to go through too.
        productData.options = [
          {
            name: 'Color',
            fieldType: 'select',
            skuContributor: true,
            productOptionValues: ['Red', 'Blue', 'Green'],
          },
          {
            name: 'Size',
            fieldType: 'select',
            skuContributor: true,
            productOptionValues: ['Small', 'Medium', 'Large'],
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

      // `specifications` with a `label`, because that is what the schema
      // requires and the prompt asks for. Emitted as `productSpecifications`
      // with no label, this satisfied Liferay's DTO but never the contract the
      // facade validates, and skipped the normalisation live mode depends on.
      productData.specifications = [
        { key: 'BRAND', label: 'Brand', value: 'AICA Elite' },
        // pragma: allowlist secret
        { key: 'MATERIAL', label: 'Material', value: 'Industrial Grade' },
      ].map((template) => ({
        specificationKey: template.key,
        label: localize(template.label),
        value: localize(template.value),
      }));

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
    _selectedLanguages = ['en-US'],
    options = {}
  ) {
    const accounts = [];
    const accountType = options.accountType || 'business';

    for (let i = 0; i < count; i++) {
      const baseErc = createERC(ERC_PREFIX.ACCOUNT);
      const suffix = randomString(4);
      // 'mixed' alternates between business and person so both types are
      // represented; 'person'/'business' pin every account to that type.
      const isPerson =
        accountType === 'person' || (accountType === 'mixed' && i % 2 === 1);
      const accountName = isPerson
        ? `Mock Rider ${i + 1} (${suffix})`
        : `Mock Account ${i + 1} (${suffix})`;
      const email = isPerson
        ? `rider-${suffix.toLowerCase()}@example.com`
        : `contact-${suffix.toLowerCase()}@example.com`;

      const accountData = {
        // HARDENING: Removed placeholder ID to force physical resolution
        externalReferenceCode: baseErc,
        name: accountName,
        type: isPerson ? 'person' : 'business',
        description: isPerson
          ? `Generated mock individual account for ${accountName}.`
          : `Generated mock business account for ${accountName}.`,
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
    _selectedLanguages = ['en-US'],
    options = {}
  ) {
    const orders = [];
    const orderDateRangeDays = Number(options.orderDateRangeDays) || 30;

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
          : { sku: 'MOCK-SKU' };

      // `sku` and `quantity` only, which is all order.json declares and all the
      // prompt asks for. `skuExternalReferenceCode` and `unitPrice` used to be
      // supplied here as well; OrderGenerator resolves the SKU against
      // Liferay's purchasable SKUs and takes the price from there, so the extra
      // fields only gave demo mode a shortcut live mode never has.
      orders.push({
        externalReferenceCode: createERC(ERC_PREFIX.ORDER),
        accountId: String(account?.id || 10000 + i),
        orderDate: randomPastDate(orderDateRangeDays).toISOString(),
        orderStatus: 0,
        items: [
          {
            sku: skuObj.sku,
            quantity: getRandomInt(1, 5),
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
        name: {
          en_US: `Mock Warehouse ${i + 1}`,
        },
        description: {
          en_US: `Primary distribution center for en_US region.`,
        },
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
        if (lang === 'en_US') continue;
        warehouse.name[lang] = `Mock Warehouse ${i + 1} (${lang})`;
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
    // generation-schemas/pricing.json declares an object with required
    // `priceListName` and `priceEntries`, each entry requiring sku, price,
    // externalReferenceCode and skuExternalReferenceCode. This returned a bare
    // array of two fields, satisfying none of it. The drift went unnoticed
    // because nothing validated mock output against the generation schemas.
    // See #652.
    const priceEntries = products.map((product) => {
      const sku = product.sku || product.skus?.[0]?.sku || 'AICA-SKU';
      const price = getRandomInt(10, 1000);

      return {
        cost: Math.round(price * 0.6 * 100) / 100,
        externalReferenceCode: `AICA-PE-${sku}`,
        price,
        promoPrice: null,
        sku,
        skuExternalReferenceCode: sku,
      };
    });

    return {
      priceEntries,
      priceListName: 'AICA General Price List',
    };
  }
}

module.exports = MockDataGenerator;
