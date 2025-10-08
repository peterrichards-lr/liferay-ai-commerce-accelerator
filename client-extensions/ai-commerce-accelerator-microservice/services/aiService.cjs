const OpenAI = require('openai');
const { ConfigService } = require('./configService.cjs');

// the newest OpenAI model is "gpt-4o" which was released May 13, 2024. do not change this unless explicitly requested by the user

class AIService {
  constructor() {
    this.configService = new ConfigService();
    this.openai = null;
  }

  async getOpenAIClient(requestConfig) {
    if (!this.openai) {
      if (!requestConfig) {
        throw new Error(
          'OAuth configuration required to initialize OpenAI client'
        );
      }
      const apiKey = await this.configService.getOpenAIKey(requestConfig);
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }
  async generatePDFContent(product, category, requestConfig, model = 'gpt-4o') {
    try {
      const openai = await this.getOpenAIClient(requestConfig);
      const productName = product.name?.en_US || product.name;
      const productDescription =
        product.description?.en_US || product.description;

      const prompt = `Generate comprehensive PDF content for a ${category} product named "${productName}".

            Create realistic content for:
            1. Technical Specifications (detailed specs in table format)
            2. Warranty Information (coverage, terms, contact info)
            3. Marketing Brochure (features, benefits, selling points)
            4. User Manual Excerpt (key usage instructions)
            5. Safety Information (warnings, certifications)

            Product Context:
            - Name: ${productName}
            - Category: ${category}
            - Description: ${productDescription}
            - Specifications: ${JSON.stringify(product.specifications)}

            Return as JSON with sections:
            {
                "title": "Product Documentation - [Product Name]",
                "sections": [
                    {
                        "title": "Technical Specifications",
                        "content": "[detailed specs in readable format]"
                    },
                    {
                        "title": "Warranty Information",
                        "content": "[warranty details, coverage, terms]"
                    },
                    {
                        "title": "Marketing Highlights",
                        "content": "[key features and benefits]"
                    },
                    {
                        "title": "Usage Guidelines",
                        "content": "[basic usage instructions]"
                    },
                    {
                        "title": "Safety & Compliance",
                        "content": "[safety warnings, certifications]"
                    }
                ]
            }

            Make content realistic and category-appropriate for ${category} products.`;

      const response = await (
        await this.getOpenAIClient(requestConfig)
      ).chat.completions.create({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      logger.error('Error generating PDF content:', error);
      throw error;
    }
  }
  async generateProductData(
    category,
    count = 1,
    requestConfig,
    model = 'gpt-4o',
    selectedLanguages = ['en-US']
  ) {
    try {
      // Convert language codes from hyphen to underscore format for Liferay
      const languageCodes = selectedLanguages.map((lang) =>
        lang.replace('-', '_')
      );
      const languageList = selectedLanguages.join(', ');

      const prompt = `Generate realistic product data for ${count} ${category} products with multilingual content for these languages: ${languageList}. Each product should have:
            - name (object with language codes as keys: ${languageCodes
              .map((code) => `"${code}": "translated name"`)
              .join(', ')})
            - description (object with language codes as keys for detailed, marketing-friendly descriptions)
            - shortDescription (object with language codes as keys for brief summaries)
            - urls (object with language codes as keys for lowercase names with no spaces)
            - baseSku (base SKU without variants - required for creating basic SKUs)
            - productType (simple)
            - skus (array with at least one basic SKU object with: sku, cost, price, inventoryLevel, published, purchasable, neverExpire, externalReferenceCode)
            - specifications (3-5 realistic specs with key-value pairs)
            - options (2-3 product variants contextually appropriate for ${category} products)
            - skuVariants (array of SKUs generated from option combinations with pricing variations)
            - attachments (2-3 realistic document names like manuals, warranties)
            - metaDescription (object with language codes as keys for SEO-friendly descriptions)
            - metaKeyword (object with language codes as keys for comma-separated keywords)
            - metaTitle (object with language codes as keys for SEO titles)
            - externalReferenceCode (unique identifier)

            IMPORTANT: For multilingual fields (name, description, shortDescription, urls, metaDescription, metaKeyword, metaTitle),
            create objects where each key is a language code (${languageCodes.join(
              ', '
            )}) and each value is the content translated into that language.

            For URLs, use the name in lowercase with spaces replaced by hyphens.

            Example structure:
            {
              "name": {
                ${languageCodes
                  .map(
                    (code) =>
                      `"${code}": "Product Name in ${code.replace(
                        '_',
                        '-'
                      )} language"`
                  )
                  .join(',\n                ')}
              },
              "urls": {
                ${languageCodes
                  .map(
                    (code) =>
                      `"${code}": "product-name-in-${code
                        .replace('_', '-')
                        .toLowerCase()}"`
                  )
                  .join(',\n                ')}
              },
              "baseSku": "PRODUCT-001",
              "skus": [{
                "sku": "PRODUCT-001",
                "cost": 60,
                "price": 100,
                "inventoryLevel": 25,
                "published": true,
                "purchasable": true,
                "neverExpire": true,
                "externalReferenceCode": "PRODUCT-001"
              }],
              "externalReferenceCode": "PRODUCT-001-1234567890"
            }

            For ${category} products, generate contextually appropriate options:

            Clothing: Size ["XS", "S", "M", "L", "XL", "XXL"], Color ["Black", "White", "Navy", "Red", "Gray"], Material ["Cotton", "Polyester", "Blend"]
            Electronics: Color ["Black", "White", "Silver", "Space Gray"], Storage ["32GB", "64GB", "128GB", "256GB"], Memory ["4GB", "8GB", "16GB"]
            Home & Garden: Size ["Small", "Medium", "Large"], Color ["White", "Black", "Brown", "Natural"], Material ["Wood", "Metal", "Plastic", "Glass"]
            Sports: Size ["Small", "Medium", "Large"], Color ["Red", "Blue", "Black", "Green"], Weight ["Light", "Standard", "Heavy"]
            Books: Format ["Hardcover", "Paperback", "eBook"], Language ["English", "Spanish", "French"], Edition ["1st", "2nd", "Revised"]
            Automotive: Size ["Compact", "Standard", "Large"], Color ["Black", "White", "Silver", "Red"], Type ["Standard", "Premium", "Sport"]
            Health & Beauty: Size ["Travel", "Regular", "Family"], Scent ["Unscented", "Fresh", "Floral", "Citrus"], SPF ["15", "30", "50", "100"]
            Toys & Games: Age ["3-5", "6-8", "9-12", "13+"], Color ["Multi", "Red", "Blue", "Pink"], Size ["Mini", "Standard", "Large"]
            Food & Beverage: Size ["Small", "Medium", "Large", "Family"], Flavor ["Original", "Vanilla", "Chocolate", "Berry"], Pack ["Single", "6-Pack", "12-Pack"]
            Office Supplies: Size ["Letter", "Legal", "A4"], Color ["White", "Blue", "Black", "Assorted"], Count ["25", "50", "100", "500"]

            For skuVariants, generate individual SKUs for meaningful option combinations (limit to 8-12 variants per product):
            - sku (baseSku + variant codes like "-BLK-L" for Black Large)
            - options (the specific option combination like {"color": "Black", "size": "Large"})
            - priceModifier (percentage adjustment: -15% to +30% from base price, with premium options costing more)
            - inStock (90% should be true, 10% false for realism)

            Return as JSON array with proper structure for Liferay Commerce API.`;

      const response = await (
        await this.getOpenAIClient(requestConfig)
      ).chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert e-commerce product data generator. Create realistic, detailed product information that would be suitable for a professional online store. Ensure all data is accurate and follows e-commerce best practices.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.products || [result];
    } catch (error) {
      logger.error('AI product generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generateAccountData(count = 1, requestConfig, model = 'gpt-4o') {
    try {
      const prompt = `Generate ${count} realistic business account${
        count > 1 ? 's' : ''
      } with the following properties:
            - name: Company name (string, required)
            - description: Business description (string, optional)
            - type: Account type, always "business" (string, required)
            - domains: Array of domain names (array of strings, optional)
            - emailAddress: Company email (string, optional)
            - taxId: Realistic tax ID format (string, optional)
            - externalReferenceCode: Unique identifier (string, required)
            - addresses: Billing and shipping addresses with realistic data (array of objects, optional)
            - organizations: Department/subsidiary info (array of objects, optional)
            - users: 2-3 business users with roles like Admin, Buyer, etc. (array of objects, optional)
            
            IMPORTANT: Do NOT include an 'active' property as it's not supported by the API schema.

            Return as JSON array with proper structure for Liferay Commerce API.`;

      const response = await (
        await this.getOpenAIClient(requestConfig)
      ).chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert B2B data generator. Create realistic business account information including company details, addresses, and user roles that would be typical for commercial customers.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.accounts || [result];
    } catch (error) {
      logger.error('AI account generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generateOrderData(
    products,
    accounts,
    count = 1,
    requestConfig,
    model = 'gpt-4o'
  ) {
    try {
      const productList = products.map((p) => ({
        name: p.name?.en_US || p.name,
        sku: p.sku,
        id: p.id,
      }));
      const accountList = accounts.map((a) => ({ name: a.name, id: a.id }));

      const prompt = `Generate realistic order data for ${count} orders using the provided products and accounts.

            Available Products: ${JSON.stringify(productList.slice(0, 10))}
            Available Accounts: ${JSON.stringify(accountList.slice(0, 10))}

            Each order should have:
            - accountId (from available accounts)
            - orderItems (2-5 items from available products with realistic quantities)
            - orderStatus (pending, processing, or completed)
            - paymentStatus (pending, authorized, or paid)
            - billingAddress (realistic address)
            - shippingAddress (realistic address, can be same as billing)
            - externalReferenceCode (unique order identifier)

            Ensure realistic purchasing patterns (related products, reasonable quantities).
            Return as JSON array with proper structure for Liferay Commerce API.`;

      const response = await (
        await this.getOpenAIClient(requestConfig)
      ).chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert e-commerce order generator. Create realistic order data that reflects typical B2B purchasing patterns with appropriate product combinations and quantities.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.orders || [result];
    } catch (error) {
      logger.error('AI order generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }

  async generatePricingData(
    products,
    pricingType = 'standard',
    model = 'gpt-4o'
  ) {
    try {
      const productList = products.map((p) => ({
        name: p.name?.en_US || p.name,
        sku: p.sku,
        id: p.id,
      }));

      const prompt = `Generate ${pricingType} pricing data for the provided products.

            Products: ${JSON.stringify(productList)}

            For ${pricingType} pricing, generate:
            - basePrice (realistic market price)
            - currency (USD)
            - priceListName (descriptive name)
            - ${
              pricingType === 'bulk'
                ? 'bulkTiers (quantity-based discounts)'
                : ''
            }
            - ${
              pricingType === 'tier'
                ? 'tierPricing (customer-level pricing)'
                : ''
            }
            - ${
              pricingType === 'promotional'
                ? 'promotionalDiscount (percentage or fixed amount)'
                : ''
            }

            Return as JSON with realistic e-commerce pricing strategies.`;

      const response = await (
        await this.getOpenAIClient(requestConfig)
      ).chat.completions.create({
        model: model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert e-commerce pricing strategist. Generate realistic pricing that reflects market conditions and typical B2B pricing structures.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2000,
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      logger.error('AI pricing generation failed:', error);
      throw new Error(`AI service error: ${error.message}`);
    }
  }
}

module.exports = new AIService();
