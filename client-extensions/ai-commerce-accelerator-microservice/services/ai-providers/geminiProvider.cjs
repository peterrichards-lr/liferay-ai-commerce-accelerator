const { GoogleGenerativeAI } = require('@google/generative-ai');
const crypto = require('crypto');
const BaseAIProvider = require('./baseProvider.cjs');
const { tryParseJSON } = require('../../utils/misc.cjs');

class GeminiProvider extends BaseAIProvider {
  constructor(ctx) {
    super(ctx);
    this.clients = new Map();
  }

  async _getClient(credentials) {
    const apiKey = credentials?.apiKey;
    if (!apiKey) throw new Error('Gemini API key missing');

    if (apiKey === 'mock-sandbox') {
      return null;
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    if (!this.clients.has(keyHash)) {
      this.clients.set(keyHash, new GoogleGenerativeAI(apiKey));
    }
    return this.clients.get(keyHash);
  }

  async generateJSON(task, prompt, options, schema) {
    const apiKey = options.credentials?.apiKey;
    if (apiKey === 'mock-sandbox') {
      return this._generateMockJSON(task, prompt, schema);
    }

    const genAI = await this._getClient(options.credentials);
    const model = genAI.getGenerativeModel({
      model: options.model || 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    const systemInstruction = `You are an expert AI generator for ${task} data. Return only valid JSON.${
      schema
        ? `\n\nThe JSON output must conform to the following schema:\n\n${JSON.stringify(schema)}`
        : ''
    }`;

    const result = await model.generateContent(
      `${systemInstruction}\n\n${prompt}`
    );
    const response = await result.response;
    const content = response.text();

    return tryParseJSON(content);
  }

  async generateImage(_product, _options) {
    if (_options.credentials?.apiKey === 'mock-sandbox') {
      return { url: 'http://localhost:3001/public/mock-image.png' };
    }
    throw new Error('Image generation not supported yet for Gemini provider');
  }

  async validateCredentials(credentials) {
    if (credentials?.apiKey === 'mock-sandbox') {
      return true;
    }

    try {
      const genAI = await this._getClient(credentials);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      await model.generateContent('ping');
      return true;
    } catch {
      return false;
    }
  }

  _generateMockJSON(task, prompt, schema) {
    if (this.ctx.logger && typeof this.ctx.logger.info === 'function') {
      this.ctx.logger.info(
        `Zero-Cost AI Sandbox: Pre-rendering realistic schema mock for task "${task}"...`
      );
    }

    const props = schema?.properties || {};

    // 1. Products Schema
    if (props.products) {
      return {
        products: [
          {
            name: { en_US: 'Premium Smart Watch' },
            description: { en_US: 'High-fidelity smart wearable watch.' },
            externalReferenceCode: 'PROD-SMARTWATCH-001',
            sku: 'SKU-SMARTWATCH-001',
            price: 299.99,
            productType: 'simple',
            categories: ['Electronics', 'Wearables'],
            priceEntries: [
              {
                price: 299.99,
                skuExternalReferenceCode: 'SKU-SMARTWATCH-001',
                priceListExternalReferenceCode: 'AICA-PL-GENERAL',
                externalReferenceCode: 'PE-SKU-SMARTWATCH-001-AICA-PL-GENERAL',
                discountDiscovery: false,
                bulkPricing: false,
                sku: {
                  basePrice: 299.99,
                  basePromoPrice: 249.99,
                },
                tierPrices: [
                  {
                    minimumQuantity: 5,
                    price: 279.99,
                    externalReferenceCode: 'TP-5-SKU-SMARTWATCH-001',
                  },
                  {
                    minimumQuantity: 10,
                    price: 259.99,
                    externalReferenceCode: 'TP-10-SKU-SMARTWATCH-001',
                  },
                ],
              },
            ],
          },
          {
            name: { en_US: 'Wireless Earbuds' },
            description: { en_US: 'True wireless noise cancelling earbuds.' },
            externalReferenceCode: 'PROD-EARBUDS-001',
            sku: 'SKU-EARBUDS-001',
            price: 149.99,
            productType: 'simple',
            categories: ['Electronics', 'Audio'],
            priceEntries: [
              {
                price: 149.99,
                skuExternalReferenceCode: 'SKU-EARBUDS-001',
                priceListExternalReferenceCode: 'AICA-PL-GENERAL',
                externalReferenceCode: 'PE-SKU-EARBUDS-001-AICA-PL-GENERAL',
                discountDiscovery: false,
                bulkPricing: false,
                sku: {
                  basePrice: 149.99,
                  basePromoPrice: null,
                },
              },
            ],
          },
        ],
      };
    }

    // 2. Accounts Schema
    if (props.accounts) {
      return {
        accounts: [
          {
            name: 'Acme Electronics Corp',
            externalReferenceCode: 'ACC-ACME-001',
            type: 'business',
            addresses: [
              {
                name: 'Acme HQ',
                street: '100 Innovation Way',
                city: 'San Jose',
                zip: '95112',
                country: 'United States',
                region: 'California',
              },
            ],
          },
          {
            name: 'Apex Global Retail',
            externalReferenceCode: 'ACC-APEX-002',
            type: 'business',
            addresses: [
              {
                name: 'Apex Warehouse',
                street: '450 Logistics Blvd',
                city: 'Dallas',
                zip: '75201',
                country: 'United States',
                region: 'Texas',
              },
            ],
          },
        ],
      };
    }

    // 3. Orders Schema
    if (props.orders) {
      return {
        orders: [
          {
            externalReferenceCode: 'ORD-MOCK-001',
            accountExternalReferenceCode: 'ACC-ACME-001',
            items: [
              {
                skuExternalReferenceCode: 'SKU-SMARTWATCH-001',
                quantity: 5,
                unitPrice: 299.99,
              },
            ],
          },
          {
            externalReferenceCode: 'ORD-MOCK-002',
            accountExternalReferenceCode: 'ACC-APEX-002',
            items: [
              {
                skuExternalReferenceCode: 'SKU-EARBUDS-001',
                quantity: 10,
                unitPrice: 149.99,
              },
            ],
          },
        ],
      };
    }

    // 4. Warehouses Schema
    if (props.warehouses) {
      return {
        warehouses: [
          {
            name: 'Main Distribution Center',
            externalReferenceCode: 'WH-MOCK-MAIN',
            description: 'Primary fulfillment warehouse.',
          },
        ],
      };
    }

    // 5. PDF blocks Schema
    if (props.blocks) {
      return {
        title: 'Product Technical Manual',
        blocks: [
          {
            type: 'heading',
            text: 'Product Specification Sheet',
          },
          {
            type: 'paragraph',
            text: 'This document contains detailed compliance and technical parameters for the smart wearable hardware modules.',
          },
        ],
      };
    }

    // Generic Schema Fallback: dynamic key extraction
    const fallback = {};
    for (const key of Object.keys(props)) {
      if (props[key].type === 'array') {
        fallback[key] = [];
      } else if (props[key].type === 'object') {
        fallback[key] = {};
      } else if (
        props[key].type === 'number' ||
        props[key].type === 'integer'
      ) {
        fallback[key] = 0;
      } else {
        fallback[key] = 'mock_value';
      }
    }
    return fallback;
  }
}

module.exports = GeminiProvider;
