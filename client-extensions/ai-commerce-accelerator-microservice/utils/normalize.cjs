const { logger } = require('./logger.cjs');

const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|auth|token|id[_-]?token|access[_-]?token)/i;
const SENSITIVE_QS = new Set([
  'token',
  'access_token',
  'id_token',
  'api_key',
  'key',
  'auth',
  'authorization',
]);

function toBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(s);
}
function toNumber(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function parseMaybeJSON(v) {
  if (v == null) return undefined;
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
function bufferToDataUrl(buffer, mime, fallback = 'application/octet-stream') {
  const m = mime || fallback;
  const b64 = buffer.toString('base64');
  return `data:${m};base64,${b64}`;
}

function buildConfigAndOptions(req) {
  const {
    route: { path },
  } = req;

  const {
    accountCount,
    aiModel,
    batchSize,
    catalogId,
    channelId,
    clientId,
    clientSecret,
    currencyCode,
    demoMode,
    generateBulkPricing,
    generatePriceLists,
    generateSkuVariants,
    generateSpecifications,
    generateTierPricing,
    imageHeight,
    imageMode,
    imageQuality,
    imageRatio,
    imageStyle,
    imageWidth,
    languageId,
    liferayUrl,
    localeCode,
    microserviceUrl,
    orderCount,
    pdfMode,
    pdfRatio,
    pollingDelay,
    pollingRetries,
    productCategories,
    productCount,
    requiredCount,
    selectedLanguages,
    siteGroupId,
  } = req.body || {};

  const config = Object.assign(
    {},
    { batchSize },
    { catalogId },
    { channelId },
    clientId === null ? null : { clientId },
    clientSecret === null ? null : { clientSecret },
    currencyCode === null ? 'USD' : { currencyCode },
    languageId === null ? 'en_US' : { languageId },
    liferayUrl === null ? null : { liferayUrl },
    localeCode === null ? 'en-US' : { localeCode },
    { pollingDelay },
    { pollingRetries },
    selectedLanguages === null ? ['en-US'] : { selectedLanguages },
    { siteGroupId }
  );

  config.correlationId = req.correlationId;

  let constrictedMicroserviceUrl = microserviceUrl;
  if (
    !constrictedMicroserviceUrl ||
    constrictedMicroserviceUrl === 'null' ||
    constrictedMicroserviceUrl === 'undefined'
  ) {
    const protocol =
      req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host =
      req.headers['x-forwarded-host'] ||
      req.headers.host ||
      `localhost:${PORT}`;
    constrictedMicroserviceUrl = `${protocol}://${host}`;
    logger.trace(`Constructed microservice URL: ${constrictedMicroserviceUrl}`);
  }

  try {
    new URL(constrictedMicroserviceUrl);
  } catch (urlError) {
    logger.warn(
      `Invalid microservice URL constructed: ${constrictedMicroserviceUrl}, falling back to null`
    );
    constrictedMicroserviceUrl = null;
  }

  config.microserviceUrl = constrictedMicroserviceUrl;

  const options = Object.assign({}, { demoMode: !!demoMode });

  switch (path) {
    case '/api/generate/products':
      config.aiModel = aiModel;

      options.productCount = productCount;
      options.productCategories = productCategories;
      options.generateBulkPricing = !!generateBulkPricing;
      options.generatePriceLists = !!generatePriceLists;
      options.generateSkuVariants = !!generateSkuVariants;
      options.generateSpecifications = !!generateSpecifications;
      options.generateTierPricing = !!generateTierPricing;
      options.imageHeight = imageHeight || 512;
      options.imageMode = imageMode || 'none';
      options.imageQuality = imageQuality || 'standard';
      options.imageRatio = imageRatio || 0;
      options.imageStyle = imageStyle || 'photographic';
      options.imageWidth = imageWidth || 512;
      options.pdfMode = pdfMode || 'none';
      options.pdfRatio = pdfRatio || 0;
      options.customImageFile = getCustomImage(req, imageMode);
      options.customPdfFile = getCustomPdf(req, pdfMode);
      break;
    case '/api/generate/orders':
      options.orderCount = orderCount;
      break;
    case '/api/generate/accounts':
      config.aiModel = aiModel;

      options.accountCount = accountCount;
      break;
    case '/api/validate/products':
    case '/api/validate/accounts':
      options.requiredCount = requiredCount;
      break;
  }
  return { config, options };
}

function getCustomImage(req, imageMode) {
  if (imageMode === 'custom') {
    const file = (req.files?.customImageFile || [])[0];
    return getCustomFile(file, 'image/jpeg', 'product.jpg');
  }
}

function getCustomPdf(req, pdfMode) {
  if (pdfMode === 'custom') {
    const file = (req.files?.customPDFFile || [])[0];
    return getCustomFile(file, 'application/pdf', 'product.pdf');
  }
}

function getCustomFile(file, defaultMimeType, defaultFliename) {
  if (file?.buffer?.length) {
    return {
      buffer: file.buffer,
      mime: file.mimetype || defaultMimeType,
      filename: file.originalname || defaultFliename,
    };
  }
}

function maskMiddle(str, keepStart = 6, keepEnd = 6, label = 'REDACTED') {
  if (typeof str !== 'string') return str;
  if (str.length <= keepStart + keepEnd + 3) return str;
  return `${str.slice(0, keepStart)}…[${label}]…${str.slice(-keepEnd)}`;
}

function isLikelyJWT(str) {
  return (
    typeof str === 'string' &&
    str.split('.').length === 3 &&
    /[A-Za-z0-9_\-]+=*/.test(str.split('.')[0]) &&
    str.length > 60
  );
}

function isDataUrlBase64(str) {
  return typeof str === 'string' && /^data:[^;]+;base64,/.test(str);
}

function isLikelyBase64Blob(str) {
  return (
    typeof str === 'string' &&
    str.length > 80 &&
    /^[A-Za-z0-9+/_\-=.]+$/.test(str) &&
    (/[=]{0,2}$/.test(str) || /[+/]/.test(str))
  );
}

function redactUrl(str) {
  if (typeof str !== 'string') return str;
  if (!/^https?:\/\//i.test(str)) return str;
  try {
    const u = new URL(str);
    for (const k of Array.from(u.searchParams.keys())) {
      if (SENSITIVE_QS.has(k.toLowerCase())) {
        const v = u.searchParams.get(k) || '';
        const masked =
          v.length > 0 ? maskMiddle(v, 3, 3, 'REDACTED') : 'REDACTED';
        u.searchParams.set(k, masked);
      }
    }
    return u.toString();
  } catch {
    return str;
  }
}

function keyPathHasSensitive(keys) {
  return keys.some((k) => SENSITIVE_KEY_RE.test(String(k)));
}

function redactByKey(keyPath, value) {
  const lastKey = keyPath[keyPath.length - 1] || '';

  if (keyPathHasSensitive(keyPath)) {
    if (typeof value === 'string') {
      if (/^Bearer\s+/i.test(value)) return 'Bearer [REDACTED]';
      if (isLikelyJWT(value)) return maskMiddle(value, 6, 6, 'JWT');
      return maskMiddle(value, 3, 3, 'REDACTED');
    }
    return '[REDACTED]';
  }

  if (keyPath.some((k) => String(k).toUpperCase() === 'OPENAI_API_KEY')) {
    return '[REDACTED_OPENAI_API_KEY]';
  }

  if (String(lastKey).toLowerCase() === 'token') {
    if (typeof value === 'string') {
      if (isLikelyJWT(value)) return maskMiddle(value, 6, 6, 'JWT');
      return maskMiddle(value, 3, 3, 'REDACTED');
    }
    return '[REDACTED]';
  }

  return null; 
}

function redactStringGeneric(str, keyPath) {
  if (/^Bearer\s+[\w\-_.]+/i.test(str)) return 'Bearer [REDACTED]';

  if (/^https?:\/\//i.test(str)) return redactUrl(str);

  if (isDataUrlBase64(str)) {
    const mime = str.slice(5, str.indexOf(';'));
    return `data:${mime};base64,[REDACTED len=${str.length}]`;
  }

  if (isLikelyJWT(str)) return maskMiddle(str, 6, 6, 'JWT');

  if (isLikelyBase64Blob(str)) return maskMiddle(str, 8, 8, 'BASE64');

  if (
    /(^|[?&#])(token|access_token|id_token|api_key|key)=([^&#]+)/i.test(str)
  ) {
    return str.replace(
      /([?&#])(token|access_token|id_token|api_key|key)=([^&#]+)/gi,
      (_, sep, name, val) =>
        `${sep}${name}=${maskMiddle(val, 3, 3, 'REDACTED')}`
    );
  }

  return str;
}

function sanitizeValue(val, keyPath = []) {
  const keyed = redactByKey(keyPath, val);
  if (keyed !== null) return keyed;

  if (val == null) return val;

  if (typeof val === 'string') {
    return redactStringGeneric(val, keyPath);
  }

  if (Array.isArray(val)) {
    return val.map((v, i) => sanitizeValue(v, keyPath.concat(String(i))));
  }

  if (typeof val === 'object') {
    const out = Array.isArray(val) ? [] : {};
    for (const [k, v] of Object.entries(val)) {
      out[k] = sanitizeValue(v, keyPath.concat(k));
    }
    return out;
  }
  return val;
}

function sanitizeCacheDump(dump) {
  return sanitizeValue(dump, []);
}

function sanitizeCacheEntry(entry) {
  const safe = { ...entry };
  safe.key = String(entry.key || '');
  const pathRoot = [safe.key];
  if (entry.hasOwnProperty('value')) {
    safe.value = sanitizeValue(entry.value, pathRoot.concat('value'));
  }
  return safe;
}

function sanitizedObject(obj) {
  const sanitizedObj = { ...obj };
  if (sanitizedObj.clientSecret) sanitizedObj.clientSecret = '[REDACTED]';
  if (sanitizedObj.Authorization) sanitizedObj.Authorization = '[REDACTED]';
  if (sanitizedObj.openaiApiKey) sanitizedObj.openaiApiKey = '[REDACTED]';

  if (sanitizedObj.customImageFile)
    sanitizedObj.customImageFile = {
      ...sanitizedObj.customImageFile,
      buffer: '[REDACTED]',
    };

  if (sanitizedObj.customPdfFile)
    sanitizedObj.customPdfFile = {
      ...sanitizedObj.customPdfFile,
      buffer: '[REDACTED]',
    };

  return sanitizedObj;
}

function parseBatchStatuses(obj) {
  return Object.entries(obj).map(([batchId, status, correlationId]) => ({
    batchId,
    status,
    correlationId,
  }));
}

module.exports = {
  bufferToDataUrl,
  buildConfigAndOptions,
  maskMiddle,
  parseBatchStatuses,
  parseMaybeJSON,
  redactUrl,
  sanitizeCacheDump,
  sanitizeCacheEntry,
  sanitizedObject,
  toBoolean,
  toNumber,
};
