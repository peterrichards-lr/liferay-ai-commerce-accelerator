const fs = require('fs');
const path = require('path');

const { logger } = require('../utils/logger.cjs');

class MockDataGenerator {
  constructor() {
    this.categoryData = null;
    this.specificationValues = null;
    this.pricingData = null;
    this.loadConfigurationData();
  }

  loadConfigurationData() {
    try {
      const dataDir = path.join(__dirname, '..', 'data');

      const categoriesPath = path.join(dataDir, 'categories.json');
      if (fs.existsSync(categoriesPath)) {
        this.categoryData = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'));
        logger.trace('Loaded category configuration from categories.json');
      } else {
        logger.warn('categories.json not found, using fallback data');
        this.categoryData = this.getFallbackCategoryData();
      }

      const specificationsPath = path.join(dataDir, 'specifications.json');
      if (fs.existsSync(specificationsPath)) {
        this.specificationValues = JSON.parse(
          fs.readFileSync(specificationsPath, 'utf8')
        );
        logger.trace(
          'Loaded specification configuration from specifications.json'
        );
      } else {
        logger.warn('specifications.json not found, using fallback data');
        this.specificationValues = this.getFallbackSpecificationData();
      }

      const pricingPath = path.join(dataDir, 'pricing.json');
      if (fs.existsSync(pricingPath)) {
        this.pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
        logger.trace('Loaded pricing configuration from pricing.json');
      } else {
        logger.warn('pricing.json not found, using fallback data');
        this.pricingData = this.getFallbackPricingData();
      }
    } catch (error) {
      logger.error('Error loading configuration data:', error);
      logger.trace('Using fallback configuration data');
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

  generateProductData(
    category,
    count = 1,
    selectedLanguages = ['en-US'],
    options = {}
  ) {
    const products = [];
    const languageCodes = selectedLanguages.map((lang) =>
      lang.replace('-', '_')
    );

    const data =
      this.categoryData[category] || this.categoryData['Electronics'];
    const pricing =
      this.pricingData[category] || this.pricingData['Electronics'];

    for (let i = 0; i < count; i++) {
      const baseName = data.names[i % data.names.length];
      const basePrice = this.calculatePrice(pricing, data.options, i);
      const baseSku = `${category.toUpperCase().substr(0, 3)}-${String(
        i + 1
      ).padStart(3, '0')}`;

      const productName = `${baseName} ${i + 1}`;
      const baseDescription = `High-quality ${baseName.toLowerCase()} perfect for everyday use. Features premium materials and excellent craftsmanship.`;
      const baseShortDescription = `Premium ${baseName.toLowerCase()} with great value.`;
      const baseMetaDescription = `Shop ${baseName} - Premium quality at great prices`;
      const baseMetaKeyword = `${baseName.toLowerCase()}, ${category.toLowerCase()}, premium, quality`;
      const baseMetaTitle = `${baseName} - Premium ${category}`;

      const name = {};
      const description = {};
      const shortDescription = {};
      const urls = {};
      const metaDescription = {};
      const metaKeyword = {};
      const metaTitle = {};

      languageCodes.forEach((langCode) => {
        const suffix = langCode === 'en_US' ? '' : ` (${langCode})`;
        name[langCode] = `${productName}${suffix}`;
        description[langCode] = `${baseDescription}${suffix}`;
        shortDescription[langCode] = `${baseShortDescription}${suffix}`;
        urls[langCode] = `${productName.toLowerCase().replace(/\s+/g, '-')}${
          suffix ? `-${langCode.toLowerCase()}` : ''
        }`;
        metaDescription[langCode] = `${baseMetaDescription}${suffix}`;
        metaKeyword[langCode] = `${baseMetaKeyword}${suffix}`;
        metaTitle[langCode] = `${baseMetaTitle}${suffix}`;
      });

      if (i === 0) {
        logger.trace('Generated multilingual content for first product:', {
          name,
          description: description,
          languageCodes,
        });
      }

      const productData = {
        active: true,
        catalogId: options.catalogId,
        name,
        description,
        shortDescription,
        urls,
        productType: 'simple',
        externalReferenceCode: `${baseSku}-${Date.now()}`,
        metaDescription,
        metaKeyword,
        metaTitle,
        skus: [
          {
            cost: Math.round(basePrice * 0.6),
            externalReferenceCode: baseSku,
            inventoryLevel: Math.floor(Math.random() * 50) + 10,
            neverExpire: true,
            price: basePrice,
            published: true,
            purchasable: true,
            sku: baseSku,
          },
        ],
      };

      if (options.generateSpecifications) {
        productData.productSpecifications = this.generateSpecifications(
          category,
          i,
          languageCodes
        );
      }

      if (
        options.generateSkuVariants &&
        data.options &&
        data.options.length > 0
      ) {
        productData.skuVariants = this.generateSkuVariants(
          baseSku,
          data.options,
          basePrice,
          category
        );
        productData.defaultSku = baseSku;
      }

      products.push(productData);
    }

    return products;
  }

  calculatePrice(pricingConfig, options, productIndex) {
    const { min, max } = pricingConfig.basePrice;
    let basePrice = Math.floor(Math.random() * (max - min) + min);

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

    for (const value1 of option1.values.slice(0, 3)) {
      for (const value2 of option2.values.slice(0, 3)) {
        if (variantCount >= maxVariants) break;

        const priceModifier = (Math.random() - 0.5) * 0.4;
        const variantPrice = Math.round(basePrice * (1 + priceModifier));

        const variant = {
          sku: `${baseSku}-${value1.substr(0, 2).toUpperCase()}-${value2
            .substr(0, 2)
            .toUpperCase()}`,
          options: {
            [`${category.toLowerCase()}-${option1.name
              .toLowerCase()
              .replace(/\s+/g, '-')}`]: value1,
            [`${category.toLowerCase()}-${option2.name
              .toLowerCase()
              .replace(/\s+/g, '-')}`]: value2,
          },
          priceModifier: Math.round(priceModifier * 100),
          price: variantPrice,
          inStock: Math.random() > 0.1,
        };

        variants.push(variant);
        variantCount++;
      }
      if (variantCount >= maxVariants) break;
    }

    return variants;
  }

  generateAccountData(count = 1) {
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

    for (let i = 0; i < count; i++) {
      const companyName = companies[i % companies.length];
      const account = {
        name: `${companyName} ${i + 1}`,
        type: 'business',
        taxId: `TAX-${String(Math.floor(Math.random() * 999999)).padStart(
          6,
          '0'
        )}`,
        externalReferenceCode: `ACC-${Date.now()}-${i}`,
        accountContactInformation: {
          emailAddresses: [
            {
              emailAddress: `contact@${companyName
                .toLowerCase()
                .replace(/\s+/g, '')}.com`,
              primary: true,
              type: 'email-address',
            },
          ],
          postalAddresses: [],
          telephones: [],
        },
        description: `Professional ${companyName.toLowerCase()} providing quality services since 2020.`,
      };
      accounts.push(account);
    }

    return accounts;
  }

  generateOrderData(count = 10) {
    const orders = [];
    const orderStatuses = [0, 1, 2, 10, 15]; // numeric statuses: open, in-progress, shipped, completed, cancelled
    const paymentStatuses = [0, 1, 2, 3]; // numeric statuses: pending, authorized, paid, failed

    for (let i = 0; i < count; i++) {
      const orderTotal = Math.floor(Math.random() * 2000) + 100;
      const itemCount = Math.floor(Math.random() * 5) + 1;

      const order = {
        orderDate: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
        orderStatus:
          orderStatuses[Math.floor(Math.random() * orderStatuses.length)],
        total: orderTotal,
        currency: 'USD',
        itemCount,
        externalReferenceCode: `ORD-${Date.now()}-${i}`,
        customerName: `Customer ${i + 1}`,
        shippingAddress: {
          street: `${100 + i} Main Street`,
          city: 'Sample City',
          zip: `${10000 + i}`,
          country: 'US',
        },
      };

      orders.push(order);
    }

    return orders;
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
          content: `Why Choose ${productName}?\n\n✓ Premium Quality: Built with the finest materials\n✓ Innovative Design: Modern styling meets functionality  \n✓ Great Value: Competitive pricing without compromise\n✓ Customer Satisfaction: Backed by thousands of reviews\n✓ Trusted Brand: Years of excellence in ${category.toLowerCase()}\n\nPerfect for both personal and professional use. Ideal gift for anyone who appreciates quality and performance.`,
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

    const numSpecs = Math.floor(Math.random() * 3) + 5;
    const selectedSpecs = specsForCategory.slice(0, numSpecs);

    for (const specKey of selectedSpecs) {
      const possibleValues = categoryValues[specKey];
      if (possibleValues) {
        const baseValue = possibleValues[productIndex % possibleValues.length];
        const baseName = specKey
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
          priority: Math.floor(Math.random() * 10) + 1,
          externalReferenceCode: `SPEC-${specKey.toUpperCase()}-${Date.now()}-${productIndex}`,
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
          externalReferenceCode: `SPEC-CAT-${category
            .toUpperCase()
            .replace(/\s+/g, '')}-${baseTitle
            .toUpperCase()
            .replace(/\s+/g, '')}-${Date.now()}`,
        });
      }
    }

    return specCategories;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reloadConfiguration() {
    logger.trace('Reloading configuration data...');
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

module.exports = { MockDataGenerator };
