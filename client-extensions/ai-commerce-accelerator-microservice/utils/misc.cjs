const { logger } = require('../utils/logger.cjs');
const { v4: uuidv4 } = require('uuid');

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function isoNow() {
  return new Date().toISOString();
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

function createErrorReference(prefix = 'LIFR') {
  return `${prefix}-${Date.now()}-${uuidv4().slice(0, 8)}`;
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
    throw new Error(`parseDataUrl: data URL is not base64 encoded (meta="${meta}")`);
  }
  if (acceptPlainBase64 && looksLikeBase64(data)) {
    return { contentType: defaultType, base64: normalizeBase64(data) };
  }
  throw new Error('parseDataUrl: input is not a valid base64 string or data URL');
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

async function handleDemoProductGeneration(config, options, productGenerator, res) {
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

async function handleDemoAccountGeneration(config, options, accountGenerator, res) {
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

module.exports = {
  buildDataUrl,
  createErrorReference,
  debounce,
  delay,
  delayCall,
  getRandomInt,
  handleDemoAccountGeneration,
  handleDemoOrderGeneration,
  handleDemoProductGeneration,
  inferEntityTypeFromClassName,
  isoNow,
  parseDataUrl,
  ratioTrigger,
  resolveOperation,
  resolvePhaseAndMode,
  safeJSON,
};