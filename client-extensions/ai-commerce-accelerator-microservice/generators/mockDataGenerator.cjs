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
    const { generateBulkPricing, generateTierPricing } = options;
    const PRICE_LIST_ERC = 'AICA-PL-GENERAL';
    const hasPromotion = Math.random() < ENV.PRICING_PROMOTION_RATIO;
    const hasBulk =
      generateBulkPricing && Math.random() < ENV.PRICING_BULK_RATIO;
    const hasTier =
      generateTierPricing && Math.random() < ENV.PRICING_TIER_RATIO;

    const entries = [];

    const buildPriceEntry = (sku, price) => {
      const priceEntryErc = createERC(ERC_PREFIX.PRICE_ENTRY);
      const promoPrice = hasPromotion ? Math.round(price * 0.85) : null;

      const entry = {
        price,
        promoPrice,
        sku: {
          basePrice: price,
          basePromoPrice: promoPrice,
        },
        skuExternalReferenceCode: sku,
        priceListExternalReferenceCode: PRICE_LIST_ERC,
        discountDiscovery: false,
        externalReferenceCode: priceEntryErc,
      };

      if (hasBulk || hasTier) {
        const isBulk = hasBulk;
        entry.bulkPricing = isBulk;

        entry.tierPrices = [
          {
            minimumQuantity: 5,
            price: Math.round(price * (isBulk ? 0.9 : 0.92)),
            promoPrice: hasPromotion ? Math.round(price * 0.75) : null,
            discountDiscovery: false,
            externalReferenceCode: createERC(ERC_PREFIX.TIER_PRICE),
          },
          {
            minimumQuantity: 10,
            price: Math.round(price * 0.8),
            promoPrice: hasPromotion ? Math.round(price * 0.65) : null,
            discountDiscovery: false,
            externalReferenceCode: createERC(ERC_PREFIX.TIER_PRICE),
          },
        ];
      }

      return entry;
    };

    entries.push(buildPriceEntry(baseSku, basePrice));

    for (const variant of skuVariants) {
      entries.push(buildPriceEntry(variant.sku, variant.price));
    }

    return entries;
  }

  async generateAccountData(count = 1, config, categories = [], options = {}) {
    const { liferay } = this.ctx;
    const accounts = [];
    let companies = [
      'Solutions Inc',
      'Global Manufacturing',
      'Creative Design Studio',
      'Green Energy Corp',
      'Digital Marketing Pro',
      'Healthcare Partners',
      'Construction Plus',
      'Retail Experts',
      'Financial Advisors',
      'Education First',
    ];

    if (categories && categories.length > 0) {
      const companySuffixes = [
        'Solutions Inc',
        'Manufacturing',
        'Design Studio',
        'Energy Corp',
        'Marketing Pro',
        'Partners',
        'Plus',
        'Experts',
        'Advisors',
        'First',
      ];
      companies = companySuffixes.map((suffix) => `${categories[0]} ${suffix}`);
    }

    const countriesFetched = await liferay.getCountries(config);
    let countries = countriesFetched || [];

    if (!countries || countries.length === 0) {
      this.logger?.warn?.(
        'No countries found in Liferay. Using default fallback for account generation.'
      );
      countries = [
        {
          id: 0,
          name: 'United States',
          a2: 'US',
          title_i18n: { en_US: 'United States' },
        },
      ];
    }

    const countryToRegionsCache = new Map();

    for (let i = 0; i < count; i++) {
      const companyName = companies[i % companies.length];
      const accountEmail = `contact@${companyName.toLowerCase().replace(/\s+/g, '')}.com`;
      const accountDomain = `${companyName.toLowerCase().replace(/\s+/g, '')}.com`;

      const country = countries[Math.floor(Math.random() * countries.length)];

      let region = { name: null };
      if (country && country.id) {
        // Fetch regions once per country and cache
        if (!countryToRegionsCache.has(country.id)) {
          const regions = await liferay.getCountryRegions(config, country.id);
          countryToRegionsCache.set(country.id, regions || []);
        }

        const regions = countryToRegionsCache.get(country.id);
        if (regions && regions.length > 0) {
          region = regions[Math.floor(Math.random() * regions.length)];
        }
      }

      const location = {
        country: country?.name || 'United States',
        region: region?.name || null,
        city: randomString(6),
        zip: `${Math.floor(Math.random() * 99999) + 10000}`,
      };

      const account = {
        name: `${companyName} ${i + 1}`,
        type: 'business',
        taxId: `TAX-${String(getRandomInt(1_000_000)).padStart(6, '0')}`,
        externalReferenceCode: createERC(ERC_PREFIX.ACCOUNT),
        description: `Professional ${companyName.toLowerCase()} providing quality services since 2020.`,
        accountContactInformation: {
          emailAddresses: [
            {
              emailAddress: accountEmail,
              primary: true,
              type: 'email-address',
            },
          ],
          webUrls: [
            {
              url: `http://${accountDomain}`,
              urlType: 'Website',
              primary: false,
            },
          ],
        },
        domains: [accountDomain],
        billingAddress: {
          addressCountry: location.country,
          addressRegion: location.region,
          addressLocality: location.city,
          postalCode: location.zip,
          streetAddressLine1: `${100 + i} Main St`,
          name: 'Billing Address',
        },
        shippingAddress: {
          addressCountry: location.country,
          addressRegion: location.region,
          addressLocality: location.city,
          postalCode: location.zip,
          streetAddressLine1: `${200 + i} Second St`,
          name: 'Shipping Address',
        },
        headOfficeAddress: {
          addressCountry: location.country,
          addressRegion: location.region,
          addressLocality: location.city,
          postalCode: location.zip,
          streetAddressLine1: `${500 + i} Corporate Ave`,
          name: 'Head Office',
        },
      };
      accounts.push(account);
    }

    const validate = this.schemas.account;
    if (validate) {
      const isValid = validate({ accounts });
      if (!isValid) {
        this.logger?.error?.('Mock account data failed schema validation:', {
          errors: validate.errors,
          correlationId: options?.correlationId,
        });
      } else {
        this.logger?.info?.(
          'Mock account data validated successfully against schema.',
          { correlationId: options?.correlationId }
        );
      }
    } else {
      this.logger?.warn?.(
        'Account schema not compiled, skipping mock data validation.'
      );
    }

    return accounts;
  }

  async generateWarehouseData(count = 1, config) {
    const warehouses = [];
    const cities = [
      'New York',
      'Los Angeles',
      'Chicago',
      'Houston',
      'Phoenix',
      'Philadelphia',
      'San Antonio',
      'San Diego',
      'Dallas',
      'San Jose',
    ];
    const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'TX', 'CA', 'TX', 'CA'];

    for (let i = 0; i < count; i++) {
      const cityIndex = i % cities.length;
      warehouses.push({
        name: { en_US: `Mock Warehouse ${i + 1} (${cities[cityIndex]})` },
        description: {
          en_US: `Primary distribution center for the ${cities[cityIndex]} region.`,
        },
        country: 'US',
        region: states[cityIndex],
        city: cities[cityIndex],
        street1: `${1000 + i} Industrial Way`,
        zip: `${10000 + i}`,
        latitude: 34.0522 + (Math.random() - 0.5),
        longitude: -118.2437 + (Math.random() - 0.5),
        active: true,
        externalReferenceCode: createERC(ERC_PREFIX.WAREHOUSE),
      });
    }

    const validate = this.schemas.warehouse;
    if (validate) {
      const isValid = validate({ warehouses });
      if (!isValid) {
        this.logger?.error?.('Mock warehouse data failed schema validation:', {
          errors: validate.errors,
          correlationId: config?.correlationId,
        });
      }
    }

    return warehouses;
  }

  generateOrderData(count = 1, extraArgs = {}, accounts = []) {
    const orders = [];
    const orderStatuses = [0, 1, 2, 10]; // Pending, Processing, Shipped, Completed

    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts provided for mock order generation.');
    }

    for (let i = 0; i < count; i++) {
      const account = accounts[i % accounts.length];
      const orderDate = randomPastDate(30).toISOString();

      orders.push({
        accountId: account.id || account.externalReferenceCode,
        externalReferenceCode: createERC(ERC_PREFIX.ORDER),
        orderStatus:
          orderStatuses[Math.floor(Math.random() * orderStatuses.length)],
        orderDate,
        items: [
          {
            sku: `SKU-MOCK-${String(i + 1).padStart(3, '0')}`,
            quantity: Math.floor(Math.random() * 5) + 1,
          },
        ],
      });
    }

    const validate = this.schemas.order;
    if (validate) {
      const isValid = validate({ orders });
      if (!isValid) {
        this.logger?.error?.('Mock order data failed schema validation:', {
          errors: validate.errors,
        });
      }
    }

    return orders;
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

module.exports = MockDataGenerator;
