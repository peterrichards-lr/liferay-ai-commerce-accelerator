const connectionSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: false, minLength: 1 },
  clientSecret: { type: 'string', required: false, minLength: 1 },
};

const channelConnectionSchema = {
  ...connectionSchema,
  channelId: { type: 'number', required: true, integer: true },
};

// The values the UI offers are none/placeholder/ai (VisualAssetControls.jsx).
// mediaGenerator additionally handles picsum, default and custom, and
// useGeneration.js treats 'generate' as a legacy alias of 'ai'. The previous
// enum listed none/generate/custom/default, which would have rejected 'ai' -
// the primary case - had it ever been applied.
const MEDIA_MODES = [
  'none',
  'placeholder',
  'ai',
  'picsum',
  'default',
  'custom',
  'generate',
];

const modeSchema = {
  imageMode: {
    type: 'string',
    enum: MEDIA_MODES,
    required: true,
  },
  pdfMode: {
    type: 'string',
    enum: MEDIA_MODES,
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

/**
 * Ceilings are runtime configuration (`generation-limits` in AICAConfiguration),
 * not schema constants. The hardcoded values these replaced were 100/50/100
 * against configured limits of 10000/5000/50000, so enforcing them would have
 * rejected runs the product explicitly permits.
 */
const countRule = (max) => ({
  type: 'number',
  min: 0,
  max,
  integer: true,
  required: false,
});

const generateDataSchema = (
  aiModelOptions = [],
  batchSizes = [],
  limits = {}
) => ({
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
  productCount: countRule(limits.maxProducts),
  accountCount: countRule(limits.maxAccounts),
  accountType: {
    type: 'string',
    enum: ['business', 'person', 'mixed'],
    required: false,
  },
  businessAccountRatio: {
    type: 'number',
    min: 0,
    max: 1,
    required: false,
  },
  orderCount: countRule(limits.maxOrders),
  orderDateRangeDays: { type: 'number', min: 0, max: 1095, required: false },
});

const generateOrdersSchema = (
  aiModelOptions = [],
  batchSizes = [],
  limits = {}
) => ({
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
  orderCount: countRule(limits.maxOrders),
  orderDateRangeDays: { type: 'number', min: 0, max: 1095, required: false },
  // Which existing accounts may receive orders. 'any' means either kind of
  // customer; guest and supplier accounts are never eligible. See #611.
  orderAccountType: {
    type: 'string',
    enum: ['any', 'business', 'person'],
    required: false,
  },
});

const generateAccountsSchema = (
  aiModelOptions = [],
  batchSizes = [],
  limits = {}
) => ({
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
  accountCount: countRule(limits.maxAccounts),
  accountType: {
    type: 'string',
    enum: ['business', 'person', 'mixed'],
    required: false,
  },
  businessAccountRatio: {
    type: 'number',
    min: 0,
    max: 1,
    required: false,
  },
});

module.exports = {
  MEDIA_MODES,
  connectionSchema,
  channelConnectionSchema,
  modeSchema,
  commerceSchema,
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
};
