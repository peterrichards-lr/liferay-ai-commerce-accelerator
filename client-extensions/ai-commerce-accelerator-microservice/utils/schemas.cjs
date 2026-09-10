const connectionSchema = {
  liferayUrl: { type: 'string', required: true, pattern: /^https?:\/\/.+/ },
  clientId: { type: 'string', required: false, minLength: 1 },
  clientSecret: { type: 'string', required: false, minLength: 1 },
};

const channelConnectionSchema = {
  ...connectionSchema,
  channelId: { type: 'number', required: true, integer: true },
};

/**
 * The one thing a request that writes must state: which Liferay it is for.
 *
 * Only the URL, deliberately - reusing connectionSchema here would newly reject
 * the blank clientId and clientSecret the colocated UI sends, and where the
 * credentials come from is a different question from where the write lands.
 * The credential chain in resolveEffectiveLiferayConnection is still what makes
 * a colocated deployment and the MCP tools work; what it must not do is invent
 * a *target* for a write. See #815.
 */
const writeTargetSchema = {
  liferayUrl: connectionSchema.liferayUrl,
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

// The four the PDF prompt knows how to label (aiService.generatePDFContent).
// Anything else silently became 'product_info', so the selector could appear to
// work while producing the default document.
const PDF_CONTENT_TYPES = [
  'product_info',
  'user_guide',
  'compliance',
  'technical_specs',
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
  pdfContentType: {
    type: 'string',
    enum: PDF_CONTENT_TYPES,
    required: false,
  },
};

/**
 * How the run's orders are spread across order statuses, as percentages keyed
 * by status name. Declared so the input is validated rather than merely
 * tolerated; orderGenerator ignores keys it does not recognise, so the shape
 * check is the only thing standing between a typo and a run of orders that all
 * take the default status.
 */
const orderDistributionRule = {
  type: 'object',
  required: false,
};

/**
 * Names one of the JSON files in resources/seed-packs. Constrained to a bare
 * name because the route interpolates it into a path; routes/generate.cjs takes
 * the basename as well, so neither check alone is load-bearing.
 */
const seedPackRule = {
  type: 'string',
  required: false,
  pattern: /^[A-Za-z0-9_-]+$/,
};

const commerceSchema = {
  catalogId: { type: 'number', required: true, integer: true },
  channelId: { type: 'number', required: false, integer: true },
  // Additional channels the run's products and warehouses should be available
  // in, alongside channelId. See #664.
  channelIds: { type: 'array', required: false },
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
    // A percentage like every other ratio since #729. Was 0-1, which is how
    // #711 happened.
    type: 'number',
    min: 0,
    max: 100,
    required: false,
  },
  orderCount: countRule(limits.maxOrders),
  orderDateRangeDays: { type: 'number', min: 0, max: 1095, required: false },
  orderDistribution: orderDistributionRule,
  seedPack: seedPackRule,
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
  orderDistribution: orderDistributionRule,
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
    // A percentage like every other ratio since #729. Was 0-1, which is how
    // #711 happened.
    type: 'number',
    min: 0,
    max: 100,
    required: false,
  },
});

module.exports = {
  MEDIA_MODES,
  PDF_CONTENT_TYPES,
  connectionSchema,
  channelConnectionSchema,
  writeTargetSchema,
  modeSchema,
  commerceSchema,
  generateDataSchema,
  generateOrdersSchema,
  generateAccountsSchema,
};
