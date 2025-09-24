const { generateAccounts } = require('../services/accountGenerator.cjs');

const connectionSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: true, minLength: 1 },
  clientSecret: { type: 'string', required: true, minLength: 1 },
};

const aiModelSchema = {
  aiModel: {
    type: 'string',
    enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    required: true,
  },
};

const modeSchema = {
  imageMode: {
    type: 'string',
    enum: ['none', 'generate', 'custom', 'default'],
    required: true,
  },
  pdfMode: {
    type: 'string',
    enum: ['none', 'generate', 'custom', 'default'],
    required: true,
  },
};

const commerceSchema = {
  catalogId: { type: 'number', required: true, integer: true },
  channelId: { type: 'number', required: false, integer: true },
  currencyCode: { type: 'string', required: false },
  localeCode: { type: 'string', required: false },
  selectedLanguages: { type: 'array', required: false },
  batchSize: { type: 'number', min: 1, max: 20, integer: true },
  demoMode: { type: 'boolean', required: false },
};

const generateDataSchema = {
  ...connectionSchema,
  ...aiModelSchema,
  ...modeSchema,
  ...commerceSchema,

  categories: { type: 'array', required: false },
  productCount: { type: 'number', min: 1, max: 100, integer: true },
  accountCount: { type: 'number', min: 1, max: 50, integer: true },
  orderCount: { type: 'number', min: 1, max: 100, integer: true },
};

const generateOrdersSchema = {
  ...connectionSchema,
  ...aiModelSchema,
  ...commerceSchema,

  channelId: { type: 'number', required: true, integer: true }, // override required=true
  currencyCode: { type: 'string', required: true }, // override required=true
  orderCount: { type: 'number', min: 1, max: 100, integer: true },
};

const generateAccountsSchema = {
  ...connectionSchema,
  ...aiModelSchema,
  ...commerceSchema,

  accountCount: { type: 'number', min: 1, max: 100, integer: true },
};

module.exports = {
  connectionSchema,
  aiModelSchema,
  modeSchema,
  commerceSchema,
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
};
