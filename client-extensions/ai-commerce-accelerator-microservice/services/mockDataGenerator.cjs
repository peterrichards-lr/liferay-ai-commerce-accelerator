const fs = require('fs');
const path = require('path');

const MOCK_IMAGE_BASE64 =
  'data:image/webp;base64,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';
const MOCK_PDF_BASE64 =
  'data:application/pdf;base64,JVBERi0xLjMKJcTl8uXrp/Og0MTGCjQgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL091dGxpbmVzIDIgMCBSCi9QYWdlcyAzIDAgUgo+PgplbmRvYmoKCjIgMCBvYmoKPDwKL1R5cGUgL091dGxpbmVzCi9Db3VudCAwCj4+CmVuZG9iagoKMyAwIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWzQgMCBSXQo+PgplbmRvYmoKCjQgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAzIDAgUgovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9GMSA5IDAgUgo+Pgo+PgovTWVkaWFCb3ggWzAuMDAwIDAuMDAwIDYxMi4wMDAgNzkyLjAwMF0KL0NvbnRlbnRzIDUgMCBSCj4+CmVuZG9iagoKNSAwIG9iago8PAovTGVuZ3RoIDQ0Cj4+CnN0cmVhbQpCVAovRjEgMTggVGYKNTcuMzc1IDcyMi4yOCBUZAooUHJvZHVjdCBEb2N1bWVudGF0aW9uKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCgo2IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL1RpbWVzLVJvbWFuCj4+CmVuZG9iagoKOSAwIG9iago8PAovVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL0Jhc2VGb250IC9IZWx2ZXRpY2EKPj4KZW5kb2JqCgp4cmVmCjAgMTAKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNzQgMDAwMDAgbiAKMDAwMDAwMDEyMCAwMDAwMCBuIAowMDAwMDAwMTc3IDAwMDAwIG4gCjAwMDAwMDAzNjQgMDAwMDAgbiAKMDAwMDAwMDQ2NiAwMDAwMCBuIAowMDAwMDAwNTMzIDAwMDAwIG4gCjAwMDAwMDA1NjEgMDAwMDAgbiAKMDAwMDAwMDU4OSAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9TaXplIDEwCi9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgo2NTcKJSVFT0Y=';

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
        console.log('Loaded category configuration from categories.json');
      } else {
        console.warn('categories.json not found, using fallback data');
        this.categoryData = this.getFallbackCategoryData();
      }

      const specificationsPath = path.join(dataDir, 'specifications.json');
      if (fs.existsSync(specificationsPath)) {
        this.specificationValues = JSON.parse(
          fs.readFileSync(specificationsPath, 'utf8')
        );
        console.log(
          'Loaded specification configuration from specifications.json'
        );
      } else {
        console.warn('specifications.json not found, using fallback data');
        this.specificationValues = this.getFallbackSpecificationData();
      }

      const pricingPath = path.join(dataDir, 'pricing.json');
      if (fs.existsSync(pricingPath)) {
        this.pricingData = JSON.parse(fs.readFileSync(pricingPath, 'utf8'));
        console.log('Loaded pricing configuration from pricing.json');
      } else {
        console.warn('pricing.json not found, using fallback data');
        this.pricingData = this.getFallbackPricingData();
      }
    } catch (error) {
      console.error('Error loading configuration data:', error);
      console.log('Using fallback configuration data');
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
        console.log('Generated multilingual content for first product:', {
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
        options.generateAttachments ||
        options.imageRatio > 0 ||
        options.pdfRatio > 0
      ) {
        productData.attachments = [];

        if (options.generateAttachments) {
          productData.attachments.push(
            { title: { en_US: `${baseName} Manual` } },
            { title: { en_US: `${baseName} Warranty` } }
          );
        }

        if (
          options.imageRatio > 0 &&
          Math.random() * 100 < options.imageRatio
        ) {
          productData.attachments.push({
            title: { en_US: `${baseName} Product Image` },
            type: 'image',
            src: `https://picsum.photos/800/600?random=${i}`,
            priority: 1,
          });
        }

        if (options.pdfRatio > 0 && Math.random() * 100 < options.pdfRatio) {
          productData.attachments.push({
            title: { en_US: `${baseName} Product Documentation` },
            contentType: 'application/pdf',
            attachment: MOCK_PDF_BASE64,
            priority: 2,
          });
        }
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
    console.log('Reloading configuration data...');
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
