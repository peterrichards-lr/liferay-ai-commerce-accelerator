const {
  createERC,
  getRandomInt,
  toERCPart,
  buildStableERC,
  randomString,
  randomPastDate,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { orderableSkusFor } = require('../utils/orderableSkus.cjs');

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
      promo: 'generatePromoData',
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
    } else if (entityType === 'promo') {
      return this.generatePromoData(
        options.products || [],
        options.accounts || [],
        config,
        null,
        selectedLanguages,
        options
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

        // Derived from the declaration above rather than listed again, so a
        // declared value cannot end up with no SKU behind it (#751). A
        // storefront offers every value the product declares, so a value with
        // nothing to sell reads as a broken store rather than a partial
        // catalogue.
        const [colorOption, sizeOption] = productData.options;
        const colors = colorOption.productOptionValues;
        const sizes = sizeOption.productOptionValues;

        for (const color of colors) {
          for (const size of sizes) {
            const variantSku = `${sku}-${color.toUpperCase()}-${size.toUpperCase()}`;
            const variantPriceModifier = sizes.indexOf(size) * 0.1;
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
          price: basePrice,
          cost: basePrice * 0.6,
          inventoryLevel: getRandomInt(10, 100),
        },
      ];

      if (generatePriceLists) {
        productData.priceEntries = this.generatePriceEntries(
          productData,
          basePrice,
          i,
          options
        );
      }

      products.push(productData);
    }

    return products;
  }

  /**
   * One price entry per SKU Liferay will actually create, each carrying the
   * whole of the product's pricing decoration.
   *
   * `orderableSkusFor` decides which SKUs those are, and it is consulted rather
   * than re-derived here: a product with SKU-contributing options has no base
   * SKU, because `skus.cjs` replaces `lp.skus` with the variants, so an entry
   * naming it has no id for `pricing.cjs` to resolve and is refused - one
   * skipped-entry warning per product on every run.
   *
   * Bulk and tier prices used to ride on that one entry. `pricing.cjs` selects
   * tier candidates by `tierPrices` being non-empty, so its only candidate was
   * the entry it then refused, and ticking Bulk or Tier Pricing generated the
   * tiers and discarded them for every product with variants - which in demo
   * mode is every product. The option is asked for against a *product*, not a
   * SKU, so every purchasable SKU of that product carries it. Same for the
   * promotional price: the base entry was its only carrier, so it never landed
   * either.
   *
   * Tier external reference codes are keyed on the SKU for a harder reason than
   * tidiness. `addOrUpdateCommerceTierPriceEntry`, in
   * `CommerceTierPriceEntryLocalServiceImpl`, resolves an incoming tier by
   * `fetchByERC_C(erc, companyId)` - company-wide, not within the price entry -
   * and updates the row it finds without moving it to the price entry it
   * arrived under. Nine variants sharing one ERC would leave a single tier row
   * hanging off whichever variant reached Liferay first, holding the last price
   * written, and report no error at all. See #782.
   */
  generatePriceEntries(product, basePrice, productIndex, options = {}) {
    const catalogId = options.catalogId;
    const generalListERC =
      options.priceListERC ||
      (catalogId
        ? buildStableERC(ERC_PREFIX.PRICE_LIST, ['GENERAL', catalogId])
        : 'AICA-PL-GENERAL');

    const onPromotion = productIndex % 5 === 0;

    // Bulk and tier pricing are the same two-tier shape with different
    // thresholds; `bulkPricing` is what tells Liferay - and the step filters in
    // `pricing.cjs` - which of the two was asked for.
    const tiers = options.generateBulkPricing
      ? [
          { factor: 0.9, minimumQuantity: 10 },
          { factor: 0.8, minimumQuantity: 50 },
        ]
      : options.generateTierPricing
        ? [
            { factor: 0.95, minimumQuantity: 5 },
            { factor: 0.85, minimumQuantity: 20 },
          ]
        : [];

    // The run's mode is passed rather than left to the product. Mock products
    // built without variants carry neither `skuVariants` nor a contributing
    // option, so this changes nothing here today - but it is the same call the
    // orders path had to correct (#810), and leaving it to be inferred is what
    // made that defect possible.
    return orderableSkusFor(product, {
      variants: options.generateSkuVariants !== false,
    }).map((sku) => {
      const skuERC = sku.externalReferenceCode || sku.sku;
      const price =
        typeof sku.price === 'number'
          ? sku.price
          : basePrice * (1 + (sku.priceModifier || 0));

      const entry = {
        price,
        promoPrice: onPromotion ? price * 0.8 : null,
        skuExternalReferenceCode: skuERC,
        priceListExternalReferenceCode: generalListERC,
        externalReferenceCode: buildStableERC('PE', [skuERC, generalListERC]),
        discountDiscovery: false,
      };

      if (tiers.length > 0) {
        entry.bulkPricing = Boolean(options.generateBulkPricing);
        entry.tierPrices = tiers.map((tier) => ({
          minimumQuantity: tier.minimumQuantity,
          price: price * tier.factor,
          externalReferenceCode: buildStableERC('TP', [
            skuERC,
            generalListERC,
            String(tier.minimumQuantity),
          ]),
        }));
      }

      return entry;
    });
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
      // No externalReferenceCode: the schema no longer declares one, because
      // the warehouse step assigns it from the location after validation. The
      // guard test requires every property emitted here to be declared, and
      // since #690 the projected provider schema closes objects, so a field
      // this schema omits cannot arrive from the model either (#730).
      const warehouse = {
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

  /**
   * `promo.json` declares an object with required `userSegments` and
   * `promotions`, and every promotion's `targetSegmentName` has to match a
   * segment `name` exactly - PromoGenerator pairs them by name, and an
   * unmatched promotion is created without a segment.
   *
   * ERCs are AICA-prefixed rather than the `SEG-`/`PROMO-` forms the prompt
   * suggests, because deletion discovery only manifests entities whose ERC
   * starts `AICA-`. That is a value, not a shape: the schema constrains
   * neither, and demo data that cannot be deleted is worse than demo data that
   * looks slightly different from a model's.
   */
  generatePromoData(
    products = [],
    accounts = [],
    _config = {},
    _model = null,
    _selectedLanguages = ['en-US'],
    _options = {}
  ) {
    const anchorAccount = accounts[0]?.name || 'established trade accounts';
    const anchorProduct =
      products[0]?.name?.en_US || products[0]?.name || 'the catalog';

    const userSegments = [
      {
        description: `Repeat buyers such as ${anchorAccount}, ordering across the catalog on a regular cycle.`,
        name: 'Frequent Buyers',
      },
      {
        description: `Trade accounts buying ${anchorProduct} and similar lines in bulk for on-site work.`,
        name: 'Volume Contractors',
      },
    ].map((segment) => ({
      ...segment,
      externalReferenceCode: buildStableERC(ERC_PREFIX.USER_SEGMENT, [
        segment.name,
      ]),
    }));

    const promotions = [
      { discountPercentage: 10, targetSegmentName: 'Frequent Buyers' },
      { discountPercentage: 20, targetSegmentName: 'Volume Contractors' },
    ].map(({ discountPercentage, targetSegmentName }) => ({
      description: `${discountPercentage}% off for ${targetSegmentName.toLowerCase()} across the generated catalog.`,
      discountPercentage,
      externalReferenceCode: buildStableERC(ERC_PREFIX.PROMOTION, [
        targetSegmentName,
        String(discountPercentage),
      ]),
      name: `${discountPercentage}% off for ${targetSegmentName}`,
      targetSegmentName,
    }));

    return { promotions, userSegments };
  }
}

module.exports = MockDataGenerator;
