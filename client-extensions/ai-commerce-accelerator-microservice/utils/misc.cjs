const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');
const { ERC_PREFIX } = require('./constants.cjs');

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function now() {
  return new Date();
}
function isoNow() {
  return now().toISOString();
}

function isoToday() {
  return isoNow().split('T')[0];
}

function randomDateBetween(start, end) {
  const s = start instanceof Date ? start.getTime() : new Date(start).getTime();
  const e = end instanceof Date ? end.getTime() : new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) {
    throw new TypeError('randomDateBetween: invalid start/end date');
  }

  const min = Math.min(s, e);
  const max = Math.max(s, e);
  const range = max - min;

  if (range <= 0) return new Date(min);

  const t = min + getRandomInt(range);
  return new Date(t);
}

function randomPastDate(daysBack = 30, refNow = now()) {
  const clamp = Math.max(0, Number(daysBack) || 0);
  const start = new Date(refNow.getTime() - clamp * 24 * 60 * 60 * 1000);
  return randomDateBetween(start, refNow);
}

function randomFutureDate(daysForward = 30, refNow = now()) {
  const clamp = Math.max(0, Number(daysForward) || 0);
  const end = new Date(refNow.getTime() + clamp * 24 * 60 * 60 * 1000);
  return randomDateBetween(refNow, end);
}

function elapsedMs(startTime) {
  return Math.max(1, now() - (startTime || now()));
}

function randomString(len = 5, uppercase = false) {
  const chars = uppercase
    ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    : 'abcdefghijklmnopqrstuvwxyz';
  const out = new Array(len);
  for (let i = 0; i < len; i++)
    out[i] = chars.charAt(getRandomInt(chars.length));
  return out.join('');
}

function toERCPart(str, max = 12) {
  if (!str) return 'NA';
  const cleaned = String(str)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
  return cleaned ? cleaned.slice(0, max) : 'NA';
}

function buildCategoryERC(category, index, { prefixLen = 3, pad = 3 } = {}) {
  if (!category) throw new Error('buildCategoryCode: category is required');
  if (index == null || isNaN(index))
    throw new Error('buildCategoryCode: index must be a number');

  const prefix = toERCPart(category, prefixLen);
  const num = String(Number(index) + 1).padStart(pad, '0');
  return `${prefix}-${num}`;
}

function buildSpecCatERC(category, baseTitle, opts = {}) {
  const {
    prefix = ERC_PREFIX.SPECIFICATION_CATEGORY,
    includeDate = true,
    randomSuffix = true,
    randLen = 4,
    maxPartLen = 12,
  } = opts;

  const cat = toERCPart(category, maxPartLen);
  const base = toERCPart(baseTitle, maxPartLen);

  const parts = [toERCPart(prefix, maxPartLen), cat, base];

  if (includeDate) {
    parts.push(isoToday().replace(/[^0-9]/g, ''));
  }

  if (randomSuffix) {
    parts.push(randomString(randLen, true));
  }

  return parts.filter(Boolean).join('-');
}

const delay = (ms = 1000) => new Promise((r) => setTimeout(r, ms));

const delayCall = (fn, ms = 1000, thisArg = null, ...args) => {
  if (typeof fn !== 'function') return null;
  return setTimeout(() => fn.apply(thisArg, args), ms);
};

const debounce = (fn, ms = 300) => {
  if (typeof fn !== 'function') return null;
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

function createERC(prefix) {
  return `${prefix}-${Date.now()}-${uuidv4().slice(0, 8)}`;
}

function buildProductSkuRoot(category, productBaseName, opts = {}) {
  const { codeLen = 3, nameLen = 6, randLen = 3 } = opts;
  const catCode = toERCPart(category, codeLen);
  const nameCode = toERCPart(productBaseName, nameLen);
  const rand = randomString(randLen, true);
  return `${ERC_PREFIX.PRODUCT}-${catCode}-${nameCode}-${rand}`;
}

function ratioTrigger(ratio) {
  const n = Number(ratio);
  return n > 0 && Math.random() * 100 < n;
}

function parseDataUrl(
  input,
  { defaultType = 'application/octet-stream', acceptPlainBase64 = true } = {}
) {
  if (typeof input !== 'string') {
    throw new Error('parseDataUrl: input must be a string');
  }
  const data = input.trim();
  if (!data) {
    throw new Error('parseDataUrl: input is empty');
  }
  const hasBase64Param = (meta) =>
    meta.split(';').some((p) => p.toLowerCase() === 'base64');
  const looksLikeBase64 = (s) =>
    /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, '').length >= 8;
  const normalizeBase64 = (s) => {
    const stripped = s.replace(/\s+/g, '');
    const pad = stripped.length % 4;
    return pad === 0 ? stripped : stripped + '==='.slice(pad);
  };
  if (data.startsWith('data:')) {
    const commaIndex = data.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('parseDataUrl: malformed data URL (missing comma)');
    }
    const meta = data.slice(5, commaIndex);
    const payload = data.slice(commaIndex + 1).trim();
    if (!payload) {
      throw new Error('parseDataUrl: missing payload after comma');
    }
    const [maybeType] = meta.split(';');
    const contentType = maybeType || defaultType;
    if (hasBase64Param(meta)) {
      return { contentType, base64: normalizeBase64(payload) };
    }
    if (acceptPlainBase64 && looksLikeBase64(payload)) {
      return { contentType, base64: normalizeBase64(payload) };
    }
    throw new Error(
      `parseDataUrl: data URL is not base64 encoded (meta="${meta}")`
    );
  }
  if (acceptPlainBase64 && looksLikeBase64(data)) {
    return { contentType: defaultType, base64: normalizeBase64(data) };
  }
  throw new Error(
    'parseDataUrl: input is not a valid base64 string or data URL'
  );
}

function buildDataUrl({ contentType, base64 }) {
  if (!contentType || !base64) {
    throw new Error('Both contentType and base64 are required');
  }
  return `data:${contentType};base64,${base64}`;
}

function safeJSON(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return '{}';
  }
}

function inferEntityTypeFromClassName(className = '') {
  const s = String(className).toLowerCase();
  if (s.includes('.order')) return 'orders';
  if (s.includes('.account')) return 'accounts';
  if (s.includes('.product')) return 'products';
  return 'unknown';
}

function resolvePhaseAndMode({
  useBatch = false,
  useConcurrent = false,
  phase = 'generate',
} = {}) {
  const allowedPhases = ['init', 'generate', 'postprocess', 'complete'];
  const normalizedPhase = allowedPhases.includes(phase) ? phase : 'generate';
  const mode = useConcurrent ? 'concurrent' : useBatch ? 'batch' : 'individual';
  return { mode, phase: normalizedPhase };
}

function resolveOperation(entity, phase, subAction) {
  const parts = [];
  if (entity) parts.push(String(entity).trim());
  if (phase) parts.push(String(phase).trim());
  const base = parts.join('/');
  return subAction ? `${base}:${String(subAction).trim()}` : base || 'generate';
}

async function handleDemoProductGeneration(
  config,
  options,
  productGenerator,
  res
) {
  try {
    logger.trace(
      `Demo mode: Generating ${options.productCount} mock products using service`
    );
    const result = await productGenerator.generateProducts(config, options);
    const expectedPDFs =
      options.pdfMode !== 'none' && options.pdfRatio > 0
        ? Math.ceil((options.productCount * options.pdfRatio) / 100)
        : 0;
    const expectedImages =
      options.imageMode !== 'none' && options.imageRatio > 0
        ? Math.ceil((options.productCount * options.imageRatio) / 100)
        : 0;
    const firstBatchWithId = Array.isArray(result.products)
      ? result.products.find((p) => p && p.batchId)
      : null;
    res.json({
      success: true,
      batchId: firstBatchWithId ? firstBatchWithId.batchId : undefined,
      count: result.created || 0,
      pdfCount: expectedPDFs,
      imageCount: expectedImages,
      errors: result.errors || [],
      status: firstBatchWithId ? firstBatchWithId.status : 'completed',
      demo: true,
      batch: Boolean(firstBatchWithId),
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: config.correlationId,
      operation: 'demo-generate-products',
    });
    res.status(500).json({
      success: false,
      error: 'Demo product generation failed',
      demo: true,
    });
  }
}

async function handleDemoOrderGeneration(config, options, orderGenerator, res) {
  try {
    logger.trace(
      `Demo mode: Generating ${options.orderCount} mock orders via OrderGenerator`
    );
    const result = await orderGenerator.generateOrders(config, options);
    res.json({
      success: true,
      count: result.created,
      errors: result.errors || [],
      data: result.orders || [],
      demo: true,
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: config.correlationId,
      operation: 'demo-generate-orders',
    });
    const errorMessage = error.message || 'Demo order generation failed';
    let statusCode = 500;
    if (
      errorMessage.includes('No products available') ||
      errorMessage.includes('No accounts available')
    ) {
      statusCode = 400;
    }
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      demo: true,
    });
  }
}

async function handleDemoAccountGeneration(
  config,
  options,
  accountGenerator,
  res
) {
  try {
    logger.info('Demo account generation started', {
      correlationId: config.correlationId,
      operation: 'demo-generate-accounts',
      accountCount: options.accountCount,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
    });
    const result = await accountGenerator.generateAccounts(config, options);
    const batchIds =
      Array.isArray(result.accounts) && result.accounts.length > 0
        ? result.accounts.map((b) => b.batchId).filter(Boolean)
        : [];
    res.json({
      success: true,
      count: result.created || 0,
      errors: result.errors || [],
      data: result.accounts || [],
      demo: true,
      batch: batchIds.length > 0,
      batchIds: batchIds.length > 0 ? batchIds : undefined,
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: config.correlationId,
      operation: 'demo-generate-accounts',
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Demo account generation failed',
      demo: true,
    });
  }
}

function normalizeNumber(value, { min, max, defaultValue = 0 } = {}) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = Number(defaultValue);

  if (Number.isFinite(min) && n < min) n = min;
  if (Number.isFinite(max) && n > max) n = max;
  return n;
}

function isJSON(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();

  const looksLikeObjectOrArray =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));

  if (!looksLikeObjectOrArray) return false;

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function tryParseJSON(value) {
  if (!isJSON(value)) {
    return value;
  }

  try {
    return JSON.parse(value.trim());
  } catch {
    return value;
  }
}

module.exports = {
  buildCategoryERC,
  buildDataUrl,
  buildProductSkuRoot,
  buildSpecCatERC,
  createERC,
  debounce,
  delay,
  delayCall,
  elapsedMs,
  getRandomInt,
  handleDemoAccountGeneration,
  handleDemoOrderGeneration,
  handleDemoProductGeneration,
  inferEntityTypeFromClassName,
  isJSON,
  isoNow,
  isoToday,
  normalizeNumber,
  now,
  parseDataUrl,
  randomDateBetween,
  randomFutureDate,
  randomPastDate,
  randomString,
  ratioTrigger,
  resolveOperation,
  resolvePhaseAndMode,
  safeJSON,
  toERCPart,
  tryParseJSON,
};
