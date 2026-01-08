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
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

const ajv = new Ajv({ removeAdditional: true });
addFormats(ajv);

class MockDataGenerator {
  constructor(ctx) {
    this.ctx = ctx || {};
    this.logger = this.ctx.logger;
    this.categoryData = null;
    this.specificationValues = null;
    this.pricingData = null;
    this.schemas = {};
    this.countries = [];
    this.regions = [];
    this._countriesAndRegions = [];
    this._loadAndCompileSchemas();
    this.loadConfigurationData();
  }

  _loadSchema(schemaName) {
    try {
      const schemaPath = path.join(
        __dirname,
        '..',
        'ai-schemas',
        `${schemaName}.json`
      );
      if (fs.existsSync(schemaPath)) {
        return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      }
      this.logger?.warn?.(
        `Schema ${schemaName}.json not found at ${schemaPath}`
      );
      return null;
    } catch (error) {
      this.logger?.error?.(`Error loading schema ${schemaName}.json:`, error);
      return null;
    }
  }

  _compileSchema(schemaName) {
    const schemaDef = this._loadSchema(schemaName);
    if (schemaDef) {
      try {
        this.schemas[schemaName] = ajv.compile(schemaDef);
        this.logger?.trace?.(`Compiled schema for ${schemaName}`);
      } catch (error) {
        this.logger?.error?.(`Error compiling schema ${schemaName}:`, error);
      }
    }
  }

  _loadAndCompileSchemas() {
    this._compileSchema('account');
    this._compileSchema('product');
    this._compileSchema('order');
    this._compileSchema('warehouse');
  }

  loadConfigurationData() {
    const logger = this.logger;
    try {
      const dataDir = path.join(__dirname, '..', 'data');

      const categoriesPath = path.join(dataDir, 'categories.json');
      if (fs.existsSync(categoriesPath)) {
        this.categoryData = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
        logger?.trace?.('Loaded category configuration from categories.json');
      } else {
        logger?.warn?.('categories.json not found, using fallback data');
        this.categoryData = this.getFallbackCategoryData();
      }

      const specificationsPath = path.join(dataDir, 'specifications.json');
      if (fs.existsSync(specificationsPath)) {
        this.specificationValues = JSON.parse(
          fs.readFileSync(specificationsPath, 'utf8')
        );
        logger?.trace?.(
          'Loaded specification configuration from specifications.json'
        );
      } else {
        logger?.warn?.('specifications.json not found, using fallback data');
        this.specificationValues = this.getFallbackSpecificationData();
      }

      const pricingPath = path.join(dataDir, 'pricing.json');
      if (fs.existsSync(pricingPath)) {
        this.pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
        logger?.trace?.('Loaded pricing configuration from pricing.json');
      } else {
        logger?.warn?.('pricing.json not found, using fallback data');
        this.pricingData = this.getFallbackPricingData();
      }
    } catch (error) {
      logger?.error?.('Error loading configuration data:', error);
      logger?.trace?.('Using fallback configuration data');
      this.categoryData = this.getFallbackCategoryData();
      this.specificationValues = this.getFallbackSpecificationData();
      this.pricingData = this.getFallbackPricingData();
    }
  }

  getFallbackCategoryData() {
    return {
      Electronics: {
        names: [
          'SmartPhone Pro',
          'Wireless Headphones',
          'Gaming Laptop',
          'Smart Watch',
          'Bluetooth Speaker',
        ],
        options: [
          { name: 'Color', values: ['Black', 'White', 'Silver', 'Space Gray'] },
          { name: 'Storage', values: ['64GB', '128GB', '256GB', '512GB'] },
        ],
        specs: ['Screen Size', 'Battery Life', 'Processor', 'RAM', 'Warranty'],
      },
      Clothing: {
        names: [
          'Cotton T-Shirt',
          'Denim Jeans',
          'Wool Sweater',
          'Running Shoes',
          'Baseball Cap',
        ],
        options: [
          { name: 'Size', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
          { name: 'Color', values: ['Black', 'White', 'Navy', 'Red', 'Gray'] },
        ],
        specs: ['Material', 'Care Instructions', 'Fit', 'Season', 'Brand'],
      },
      'Home & Garden': {
        names: [
          'Garden Hose',
          'Patio Umbrella',
          'Flower Pot',
          'Outdoor Chair',
          'BBQ Grill',
        ],
        options: [
          { name: 'Size', values: ['Small', 'Medium', 'Large'] },
          { name: 'Material', values: ['Wood', 'Metal', 'Plastic', 'Glass'] },
        ],
        specs: [
          'Dimensions',
          'Weight',
          'Material',
          'Weather Resistance',
          'Assembly Required',
        ],
      },
    };
  }

  getFallbackSpecificationData() {
    return {
      Electronics: {
        'screen-size': ['5.4"', '6.1"', '6.7"', '12.9"', '13.3"'],
        'battery-life': [
          '8 hours',
          '12 hours',
          '16 hours',
          '24 hours',
          '48 hours',
        ],
        processor: [
          'A15 Bionic',
          'Snapdragon 888',
          'Intel i7',
          'M1 Pro',
          'AMD Ryzen 7',
        ],
        ram: ['4GB', '8GB', '16GB', '32GB', '64GB'],
        warranty: [
          '1 Year',
          '2 Years',
          '3 Years',
          'Extended Warranty Available',
        ],
      },
    };
  }

  getFallbackPricingData() {
    return {
      Electronics: { basePrice: { min: 50, max: 2000 }, priceModifiers: {} },
      Clothing: { basePrice: { min: 15, max: 300 }, priceModifiers: {} },
      'Home & Garden': { basePrice: { min: 20, max: 800 }, priceModifiers: {} },
    };
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
    const count = options.count || options.accountCount || 1;
    const accounts = await this.generateAccountData(count, config);
    return {
      created: accounts.length,
      accounts,
      errors: [],
    };
  }

  generateOrders(config, options = {}) {
    const count = options.count || options.orderCount || 1;
    const currencyCode = options.currencyCode || config?.currencyCode || 'USD';
    const orders = this.generateOrderData(count, { currencyCode });
    return {
      created: orders.length,
      orders,
      errors: [],
    };
  }

  generateProductData(
    category,
    count = 1,
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const logger = this.logger;
    const products = [];

    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const data =
      this.categoryData[category] || this.categoryData['Electronics'];
    const pricing =
      this.pricingData[category] || this.pricingData['Electronics'];

    const { catalogId, generateSpecifications, generateSkuVariants } = options;

    const categoryCode = toERCPart(category, 3);
    const localeSuffixMap = Object.fromEntries(
      languageCodes.map((lc) => [lc, lc === 'en_US' ? '' : ` (${lc})`])
    );

    for (let i = 0; i < count; i++) {
      const baseName = data.names[i % data.names.length];
      const baseNameLower = baseName.toLowerCase();
      const productName = `${baseName} ${i + 1}`;

      const basePrice = this.calculatePrice(pricing, data.options, i);

      const nameCode = toERCPart(baseName, 6);
      const rand = randomString(3, true);
      const skuRoot = `${ERC_PREFIX.PRODUCT}-${categoryCode}-${nameCode}-${rand}`;

      const sku = `${skuRoot}-${String(i + 1).padStart(3, '0')}`;
      const externalReferenceCode = createERC(ERC_PREFIX.PRODUCT);

      const baseDescription = `High-quality ${baseNameLower} perfect for everyday use. Features premium materials and excellent craftsmanship.`;
      const baseShortDescription = `Premium ${baseNameLower} with great value.`;
      const baseMetaDescription = `Shop ${baseName} - Premium quality at great prices`;
      const baseMetaKeyword = `${baseNameLower}, ${category.toLowerCase()}, premium, quality`;
      const baseMetaTitle = `${baseName} - Premium ${category}`;

      const name = {};
      const description = {};
      const shortDescription = {};
      const urls = {};
      const metaDescription = {};
      const metaKeyword = {};
      const metaTitle = {};

      const baseSlug = productName.toLowerCase().replace(/\s+/g, '-') ;

      for (const lc of languageCodes) {
        const suffix = localeSuffixMap[lc];
        name[lc] = `${productName}${suffix}`;
        description[lc] = `${baseDescription}${suffix}`;
        shortDescription[lc] = `${baseShortDescription}${suffix}`;
        urls[lc] = `${baseSlug}${suffix ? `-${lc.toLowerCase()}` : ''}`;
        metaDescription[lc] = `${baseMetaDescription}${suffix}`;
        metaKeyword[lc] = `${baseMetaKeyword}${suffix}`;
        metaTitle[lc] = `${baseMetaTitle}${suffix}`;
      }

      if (i === 0) {
        logger?.trace?.('Generated multilingual content for first product:', {
          name,
          description,
          languageCodes,
        });
      }

      const productData = {
        active: true,
        catalogId,
        name,
        description,
        shortDescription,
        urls,
        baseSku: sku,
        productType: 'simple',
        externalReferenceCode,
        metaDescription,
        metaKeyword,
        metaTitle,
        skus: [
          {
            cost: Math.round(basePrice * 0.6),
            externalReferenceCode: sku,
            inventoryLevel: 10 + getRandomInt(41),
            neverExpire: true,
            price: basePrice,
            published: true,
            purchasable: true,
            sku,
          },
        ],
      };

      if (generateSpecifications) {
        productData.productSpecifications = this.generateSpecifications(
          category,
          i,
          languageCodes
        );
      }

      if (
        generateSkuVariants &&
        Array.isArray(data.options) &&
        data.options.length > 0
      ) {
        productData.options = data.options;
        productData.skuVariants = this.generateSkuVariants(
          sku,
          data.options,
          basePrice,
          category
        );
        productData.defaultSku = sku;
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
        });
        throw new Error('Mock product data failed schema validation.');
      }
      logger?.trace?.(
        'Mock product data validated successfully against schema.'
      );
    } else {
      logger?.warn?.(
        'Product schema not compiled, skipping mock data validation.'
      );
    }

    return products;
  }

  calculatePrice(pricingConfig, options, productIndex) {
    const { min, max } = pricingConfig.basePrice;
    let basePrice = min + getRandomInt(Math.max(1, max - min + 1));

    if (pricingConfig.priceModifiers && options) {
      for (const option of options) {
        const modifiers = pricingConfig.priceModifiers[option.name];
        if (modifiers) {
          const selectedValue =
            option.values[productIndex % option.values.length];
          const modifier = modifiers[selectedValue] || 0;
          basePrice += modifier;
        }
      }
    }

    return Math.max(basePrice, min);
  }

  generateSkuVariants(baseSku, options, basePrice, category) {
    if (!options || options.length === 0) return [];

    const variants = [];
    const maxVariants = 8;
    let variantCount = 0;

    const option1 = options[0];
    const option2 = options[1] || { values: ['Standard'] };
    const toKey = (s) => String(s).toLowerCase().replace(/\s+/g, '-');

    for (const value1 of option1.values.slice(0, 3)) {
      for (const value2 of option2.values.slice(0, 3)) {
        if (variantCount >= maxVariants) break;

        const priceModifier = (getRandomInt(401) - 200) / 1000;
        const variantPrice = Math.round(basePrice * (1 + priceModifier));

        const variant = {
          sku: `${baseSku}-${value1.slice(0, 2).toUpperCase()}-${value2
            .slice(0, 2)
            .toUpperCase()}`,
          options: {
            [`${toKey(category)}-${toKey(option1.name)}`]: value1,
            [`${toKey(category)}-${toKey(option2.name)}`]: value2,
          },
          priceModifier: Math.round(priceModifier * 100),
          price: variantPrice,
          published: true,
          purchasable: true,
          neverExpire: true,
          inStock: getRandomInt(10) > 1,
        };

        variants.push(variant);
        variantCount++;
      }
      if (variantCount >= maxVariants) break;
    }

    return variants;
  }

  async generateAccountData(count = 1, config) {
    const { liferay } = this.ctx;
    const accounts = [];
    const companies = [
      'Tech Solutions Inc',
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

    const countries = await liferay.getCountries(config);

    for (let i = 0; i < count; i++) {
      const companyName = companies[i % companies.length];
      const accountEmail = `contact@${companyName
        .toLowerCase()
        .replace(/\s+/g, '')}.com`;
      const accountDomain = `${companyName
        .toLowerCase()
        .replace(/\s+/g, '')}.com`;

      let country;
      let regions = [];
      while (regions.length === 0) {
        country = countries[Math.floor(Math.random() * countries.length)];
        regions = await liferay.getCountryRegions(config, country.id);
      }
      const region = regions[Math.floor(Math.random() * regions.length)];
      
      const location = {
        country: country.name,
        region: region.name,
        city: randomString(6),
        zip: `${Math.floor(Math.random() * 99999) + 10000}`,
      }

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
      const payload = { accounts: accounts };
      const isValid = validate(payload);
      if (!isValid) {
        this.logger?.error?.('Mock account data failed schema validation:', {
          errors: validate.errors,
          payload: JSON.stringify(payload, null, 2),
        });
        throw new Error('Mock account data failed schema validation.');
      }
      this.logger?.trace?.(
        'Mock account data validated successfully against schema.'
      );
    } else {
      this.logger?.warn?.(
        'Account schema not compiled, skipping mock data validation.'
      );
    }

    return accounts;
  }

  generateOrderData(count = 10, opts = {}, accounts = []) {
    const orders = [];
    const orderStatuses = [0, 1, 2, 10, 15];
    const paymentStatuses = [0, 1, 2, 3];
    const currencyCode = opts.currencyCode || 'USD';

    for (let i = 0; i < count; i++) {
      const orderTotal = 100 + getRandomInt(2000);
      const itemCount = 1 + getRandomInt(5);

      const order = {
        orderDate: randomPastDate().toISOString(),
        orderStatus: orderStatuses[getRandomInt(orderStatuses.length)],
        total: orderTotal,
        currency: currencyCode,
        itemCount,
        externalReferenceCode: `${createERC(ERC_PREFIX.ORDER)}-${i}`,
        customerName: `Customer ${i + 1}`,
        shippingAddress: {
          street: `${100 + i} Main Street`,
          city: 'Sample City',
          zip: `${10000 + i}`,
          country: 'US',
        },
        paymentStatuses: paymentStatuses[getRandomInt(paymentStatuses.length)],
        items: [],
      };

      if (accounts.length > 0) {
        order.accountId = String(accounts[i % accounts.length].id);
      }

      orders.push(order);
    }

    const validate = this.schemas.order;
    if (validate) {
      const payload = { orders: orders };
      const isValid = validate(payload);
      if (!isValid) {
        this.logger?.error?.('Mock order data failed schema validation:', {
          errors: validate.errors,
          payload: JSON.stringify(payload, null, 2),
        });
        throw new Error('Mock order data failed schema validation.');
      }
      this.logger?.trace?.(
        'Mock order data validated successfully against schema.'
      );
    } else {
      this.logger?.warn?.(
        'Order schema not compiled, skipping mock data validation.'
      );
    }

    return orders;
  }

  async generateWarehouseData(count = 1, config) {
    const { liferay } = this.ctx;
    const warehouses = [];

    const countries = await liferay.getCountries(config);

    for (let i = 0; i < count; i++) {

      let country;
      let regions = [];
      while (regions.length === 0) {
        country = countries[Math.floor(Math.random() * countries.length)];
        regions = await liferay.getCountryRegions(config, country.id);
      }
      const region = regions[Math.floor(Math.random() * regions.length)];
      
      const location = {
        country: country.name,
        region: region.name,
        city: randomString(6),
        zip: `${Math.floor(Math.random() * 99999) + 10000}`,
      }

      const warehouse = {
        id: Math.floor(Math.random() * 10000),
        name: `Warehouse ${i + 1}`,
        externalReferenceCode: createERC(ERC_PREFIX.WAREHOUSE),
        country: location.country,
        region: location.region,
        city: location.city,
        street1: `${100 + i} Main Street`,
        zip: location.zip,
        latitude: Math.random() * 180 - 90,
        longitude: Math.random() * 360 - 180,
      };
      warehouses.push(warehouse);
    }

    return warehouses;
  }

  generatePDFContent(product, category) {
    const productName = product.name?.en_US || product.name;

    return {
      title: `Product Documentation - ${productName}`,
      sections: [
        {
          title: 'Technical Specifications',
          content: `${productName} features industry-leading specifications designed for optimal performance:\n\n• Premium build quality with attention to detail\n• Engineered for durability and reliability\n• Tested to meet international standards\n• Compatible with industry standards\n• Energy efficient design\n\nDimensions: Various sizes available\nWeight: Optimized for portability\nMaterial: High-grade components`,
        },
        {
          title: 'Warranty Information',
          content: `Limited Warranty Coverage for ${productName}:\n\n• 2-year manufacturer warranty included\n• Coverage includes manufacturing defects\n• 30-day return policy for unused items\n• Customer support available 24/7\n• Warranty registration recommended\n\nFor warranty claims, contact:\nSupport Phone: 1-800-SUPPORT\nEmail: warranty@company.com\nOnline: www.company.com/warranty`,
        },
        {
          title: 'Marketing Highlights',
          content: `Why Choose ${productName}?\n\n✓ Premium Quality: Built with the finest materials\n✓ Innovative Design: Modern styling meets functionality  \n✓ Great Value: Competitive pricing without compromise\n✓ Customer Satisfaction: Backed by thousands of reviews\n✓ Trusted Brand: Years of excellence in ${category.toLowerCase()}

Perfect for both personal and professional use. Ideal gift for anyone who appreciates quality and performance.`,
        },
        {
          title: 'Usage Guidelines',
          content: `Getting Started with ${productName}:\n\n1. Unpack carefully and check all components\n2. Review quick start guide included in package\n3. Follow setup instructions step by step\n4. Register your product for warranty coverage\n5. Enjoy your new ${productName}!\n\nDaily Use Tips:\n• Regular cleaning maintains performance\n• Store in appropriate conditions\n• Handle with care to prevent damage\n• Follow maintenance schedule as recommended`,
        },
        {
          title: 'Safety & Compliance',
          content: `Safety Information for ${productName}:\n\n⚠ Important Safety Notices:\n• Read all instructions before use\n• Keep away from water unless waterproof\n• Adult supervision required for children\n• Do not disassemble without authorization\n\nCompliance Certifications:\n✓ CE Marking (European Conformity)\n✓ FCC Approved (Federal Communications Commission)\n✓ RoHS Compliant (Restriction of Hazardous Substances)\n✓ ISO 9001 Quality Management\n\nFor complete safety information, visit our website or contact customer service.`,
        },
      ],
    };
  }

  generateSpecifications(category, productIndex, languageCodes = ['en_US']) {
    const categoryValues =
      this.specificationValues[category] ||
      this.specificationValues['Electronics'];
    const specifications = [];

    const specsForCategory = Object.keys(categoryValues);

    const numSpecs = 5 + getRandomInt(3);
    const selectedSpecs = specsForCategory.slice(0, numSpecs);

    for (const specKey of selectedSpecs) {
      const possibleValues = categoryValues[specKey];
      if (possibleValues) {
        const baseValue = possibleValues[productIndex % possibleValues.length];
        const baseName =
          specKey
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        const label = {};
        const value = {};

        languageCodes.forEach((langCode) => {
          const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
          label[langCode] = `${baseName}${suffix}`;
          value[langCode] = `${baseValue}${suffix}`;
        });

        specifications.push({
          key: specKey,
          label: label,
          value: value,
          priority: 1 + getRandomInt(10),
          externalReferenceCode: `${createERC(
            ERC_PREFIX.SPECIFICATION
          )}-${productIndex}`,
        });
      }
    }

    return specifications;
  }

  generateSpecificationCategories(categories, selectedLanguages = ['en_US']) {
    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );
    const specCategories = [];

    const categoryMappings = {
      Electronics: [
        'Technical Specs',
        'Performance',
        'Connectivity',
        'Physical',
      ],
      Clothing: [
        'Material & Care',
        'Fit & Style',
        'Design Details',
        'Product Info',
      ],
      'Home & Garden': [
        'Dimensions & Weight',
        'Materials',
        'Features',
        'Care & Maintenance',
      ],
      Sports: ['Performance', 'Durability', 'Safety', 'Specifications'],
      Books: [
        'Publication Info',
        'Physical Properties',
        'Content Details',
        'Availability',
      ],
    };

    for (const category of categories) {
      const categoryGroups =
        categoryMappings[category] || categoryMappings['Electronics'];

      for (let i = 0; i < categoryGroups.length; i++) {
        const baseTitle = categoryGroups[i];
        const baseDescription = `Specifications related to ${baseTitle.toLowerCase()} for ${category.toLowerCase()} products`;

        const title = {};
        const description = {};

        languageCodes.forEach((langCode) => {
          const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
          title[langCode] = `${baseTitle}${suffix}`;
          description[langCode] = `${baseDescription}${suffix}`;
        });

        specCategories.push({
          key: `${category.toLowerCase().replace(/\s+/g, '-')}-${baseTitle
            .toLowerCase()
            .replace(/\s+/g, '-')}`,
          title: title,
          description: description,
          priority: i + 1,
          externalReferenceCode: buildSpecCatERC(category, baseTitle),
        });
      }
    }

    return specCategories;
  }

  reloadConfiguration() {
    const logger = this.logger;
    logger?.trace?.('Reloading configuration data...');
    this.loadConfigurationData();
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