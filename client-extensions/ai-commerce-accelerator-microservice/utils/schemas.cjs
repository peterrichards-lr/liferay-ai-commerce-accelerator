const connectionSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: false, minLength: 1 },
  clientSecret: { type: 'string', required: false, minLength: 1 },
};

const channelConnectionSchema = {
  ...connectionSchema,
  channelId: { type: 'number', required: true, integer: true },
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
  demoMode: { type: 'boolean', required: false },
};

const generateDataSchema = (aiModelOptions = [], batchSizes = []) => ({
  ...modeSchema,
  ...commerceSchema,
  batchSize: {
    type: 'number',
    enum: batchSizes,
    required: true,
  },
  aiModel: {
    type: 'string',
    enum: aiModelOptions.map((opt) => opt.value),
    required: true,
  },
  categories: { type: 'array', required: false },
  productCount: { type: 'number', min: 0, max: 100, integer: true },
  accountCount: { type: 'number', min: 0, max: 50, integer: true },
  accountType: {
    type: 'string',
    enum: ['business', 'person', 'mixed'],
    required: false,
  },
  orderCount: { type: 'number', min: 0, max: 100, integer: true },
  orderDateRangeDays: { type: 'number', min: 0, max: 1095, required: false },
});

const generateOrdersSchema = (aiModelOptions = [], batchSizes = []) => ({
  ...connectionSchema,
  ...commerceSchema,
  batchSize: {
    type: 'number',
    enum: batchSizes,
    required: true,
  },
  aiModel: {
    type: 'string',
    enum: aiModelOptions.map((opt) => opt.value),
    required: true,
  },
  channelId: { type: 'number', required: true, integer: true },
  currencyCode: { type: 'string', required: true },
  orderCount: { type: 'number', min: 0, max: 100, integer: true },
  orderDateRangeDays: { type: 'number', min: 0, max: 1095, required: false },
});

const generateAccountsSchema = (aiModelOptions = [], batchSizes = []) => ({
  ...connectionSchema,
  ...commerceSchema,
  batchSize: {
    type: 'number',
    enum: batchSizes,
    required: true,
  },
  aiModel: {
    type: 'string',
    enum: aiModelOptions.map((opt) => opt.value),
    required: true,
  },
  accountCount: { type: 'number', min: 0, max: 100, integer: true },
  accountType: {
    type: 'string',
    enum: ['business', 'person', 'mixed'],
    required: false,
  },
});

module.exports = {
  connectionSchema,
  channelConnectionSchema,
  modeSchema,
  commerceSchema,
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
};
