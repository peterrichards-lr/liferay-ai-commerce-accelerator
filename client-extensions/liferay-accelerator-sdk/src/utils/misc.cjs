const crypto = require('crypto');
const { ErrorHandler } = require('./errorHandler.cjs');
const { ERC_PREFIX, ENV } = require('./constants.cjs');

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

function sanitizeForERC(str, { max = 12, preserveUnderscore = false } = {}) {
  if (!str) return 'NA';
  const s = String(str).toUpperCase();
  const pattern = preserveUnderscore ? /[^A-Z0-9_]+/g : /[^A-Z0-9]+/g;
  const cleaned = s.replace(pattern, '');
  return cleaned ? cleaned.slice(0, max) : 'NA';
}

function buildKeyedERC({
  prefix,
  category,
  key,
  categoryLen = 3,
  keyLen = 6,
  randLen = 3,
  includeRandom = true,
  preserveUnderscore = false,
  prefixIsCompound = false,
} = {}) {
  const pfxParts = prefixIsCompound
    ? String(prefix || '')
        .split('-')
        .map((p) => toERCPart(p, 12))
        .filter(Boolean)
    : [toERCPart(prefix, 12)];
  const cat = toERCPart(category, categoryLen);
  let transformedKey = String(key || '');
  if (preserveUnderscore) transformedKey = transformedKey.replace(/-/g, '_');
  const k = sanitizeForERC(transformedKey, { max: keyLen, preserveUnderscore });
  const parts = [...pfxParts, cat, k];
  if (includeRandom) parts.push(randomString(randLen, true));
  return parts.join('-');
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

async function processWithRetry(
  ctx,
  item,
  processingFunction,
  maxRetries = ENV.LIFERAY_API_MAX_RETRIES || 3
) {
  const { logger } = ctx;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await processingFunction(item);
    } catch (error) {
      lastError = error;
      if (!ErrorHandler.isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }
      const retryDelay = 2000 * attempt;
      logger.warn(
        `Attempt ${attempt} failed, retrying in ${retryDelay}ms:`,
        error.message
      );
      await delay(retryDelay);
    }
  }
  throw lastError;
}

let ercCounter = 0;
let lastErcTimestamp = 0;

function createERC(prefix) {
  const now = Date.now();

  if (now === lastErcTimestamp) {
    ercCounter++;
  } else {
    lastErcTimestamp = now;
    ercCounter = 0;
  }

  const suffix = crypto.randomUUID().slice(0, 8);
  return `${prefix}-${now}-${ercCounter}-${suffix}`;
}

function resolveErrorReference(err) {
  if (!err || typeof err !== 'object') return null;
  if (err.errorReference && typeof err.errorReference === 'string') {
    return err.errorReference;
  }
  if (err.errorRef && typeof err.errorRef === 'string') {
    return err.errorRef;
  }
  if (err.erc && typeof err.erc === 'string') {
    return err.erc;
  }
  return null;
}

function buildProductSkuRoot(category, productBaseName, opts = {}) {
  const { codeLen = 3, nameLen = 6, randLen = 3 } = opts;
  const catCode = toERCPart(category, codeLen);
  const nameCode = toERCPart(productBaseName, nameLen);
  const rand = randomString(randLen, true);
  return `${ERC_PREFIX.PRODUCT}-${catCode}-${nameCode}-${rand}`;
}

function buildOptionCategoryERC(category, groupKey, opts = {}) {
  const { codeLen = 3, groupKeyCodeLen = 6, randLen = 3 } = opts;
  return buildKeyedERC({
    prefix: ERC_PREFIX.OPTION_CATEGORY,
    category,
    key: groupKey,
    categoryLen: codeLen,
    keyLen: groupKeyCodeLen,
    randLen,
    includeRandom: true,
    preserveUnderscore: false,
    prefixIsCompound: true,
  });
}

function buildSpecificationERC(category, specKey, opts = {}) {
  const {
    codeLen = 3,
    specKeyCodeLen = 12,
    includeRandom = false,
    randLen = 3,
  } = opts;
  return buildKeyedERC({
    prefix: ERC_PREFIX.SPECIFICATION,
    category,
    key: specKey,
    categoryLen: codeLen,
    keyLen: specKeyCodeLen,
    includeRandom,
    randLen,
    preserveUnderscore: true,
    prefixIsCompound: true,
  });
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

function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

const toI18n = (v, fallback) => {
  if (!v && !fallback) {
    throw new Error('Both arguments cannot be empty');
  }
  return typeof v === 'string' ? { en_US: v } : v || { en_US: fallback };
};

const fromI18n = (v, locale = 'en_US') => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v[locale] || Object.values(v)[0] || null;
};

function getByValue(collection, searchValue) {
  const iterable =
    collection instanceof Map ? collection : Object.entries(collection || {});
  for (const [key, value] of iterable) {
    if (value === searchValue) return key;
  }
}

function toTitleCase(str) {
  return str.replace(
    /\w\S*/g,
    (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  );
}

module.exports = {
  buildCategoryERC,
  buildDataUrl,
  buildProductSkuRoot,
  buildOptionCategoryERC,
  buildSpecificationERC,
  buildSpecCatERC,
  createERC,
  debounce,
  delay,
  delayCall,
  elapsedMs,
  getByValue,
  getRandomInt,
  inferEntityTypeFromClassName,
  isJSON,
  isoNow,
  isoToday,
  isValidUrl,
  normalizeNumber,
  now,
  parseDataUrl,
  randomDateBetween,
  processWithRetry,
  randomFutureDate,
  randomPastDate,
  randomString,
  ratioTrigger,
  buildKeyedERC,
  resolveErrorReference,
  resolveOperation,
  resolvePhaseAndMode,
  safeJSON,
  sanitizeForERC,
  toERCPart,
  toI18n,
  fromI18n,
  tryParseJSON,
  toTitleCase,
};
