const { logger } = require('./logger.cjs');
const { toPercentage } = require('./shareSelection.cjs');
const crypto = require('crypto');
const { resolveEffectiveLiferayConnection } = require('./liferayEnv.cjs');

const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|auth|token|id[_-]?token|secret|access[_-]?token)/i;
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
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Accepts the shapes a multipart or JSON caller can express a list of ids in:
 * a real array, a JSON array, a comma-separated string or a lone id. Returns
 * undefined when nothing usable was supplied, so a request that never mentions
 * the field leaves the config exactly as it was.
 */
function toNumberList(v) {
  if (v === undefined || v === null || v === '') return undefined;

  const parsed = typeof v === 'string' ? parseMaybeJSON(v) : v;
  const candidates = Array.isArray(parsed) ? parsed : String(parsed).split(',');
  const numbers = candidates
    .map(toNumber)
    .filter((n) => n !== undefined && Number.isInteger(n));

  return numbers.length > 0 ? [...new Set(numbers)] : undefined;
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

function getCustomFile(file, defaultMimeType, defaultFilename) {
  if (file?.buffer?.length) {
    return {
      buffer: file.buffer,
      mime: file.mimetype || defaultMimeType,
      filename: file.originalname || defaultFilename,
    };
  }
}

function buildConfigAndOptions(req) {
  const {
    accountCount,
    accountType,
    orderAccountType,
    aiModel,
    authMethod,
    batchSize,
    brandName,
    catalogId,
    categories,
    channelId,
    channelIds,
    clientId,
    clientSecret,
    createWarehouses,
    reuseExistingWarehouses,
    currencyCode,
    demoMode,
    businessAccountRatio,
    generateBulkPricing,
    generatePriceLists,
    generatePromotions,
    generateSkuVariants,
    generateSpecifications,
    generateTierPricing,
    geographicContext,
    imageHeight,
    imageMode,
    imageQuality,
    imageRatio,
    imageStyle,
    imageWidth,
    inventoryAssignmentRatio,
    inventoryMax,
    inventoryMin,
    languageId,
    liferayUrl,
    localeCode,
    microserviceUrl,
    orderCount,
    orderDateRangeDays,
    orderDistribution,
    pdfContentType,
    pdfMode,
    pdfRatio,
    pollingDelay,
    pollingRetries,
    productCount,
    seedPack,
    selectedLanguages,
    sessionName,
    siteGroupId,
    warehouseCount,
  } = req.body || {};

  logger.info('req.body in buildConfigAndOptions:', req.body);

  const correlationId =
    req.correlationId || req.headers['x-correlation-id'] || crypto.randomUUID();

  let constructedMicroserviceUrl = microserviceUrl;
  if (
    !constructedMicroserviceUrl ||
    constructedMicroserviceUrl === 'null' ||
    constructedMicroserviceUrl === 'undefined'
  ) {
    const protocol =
      req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    constructedMicroserviceUrl = host ? `${protocol}://${host}` : null;
    if (constructedMicroserviceUrl) {
      logger.trace(
        `Constructed microservice URL: ${constructedMicroserviceUrl}`
      );
    }
  }

  try {
    if (constructedMicroserviceUrl) {
      new URL(constructedMicroserviceUrl);
    }
  } catch {
    logger.warn(
      `Invalid microservice URL constructed: ${constructedMicroserviceUrl}, falling back to null`
    );
    constructedMicroserviceUrl = null;
  }

  const rawConfig = {
    authMethod,
    batchSize: toNumber(batchSize),
    catalogId: toNumber(catalogId),
    channelId: toNumber(channelId),
    // Every channel this run should make its products and warehouses
    // available in. channelId remains the run's primary channel - the one
    // orders, pricing and inventory are written against. See #664.
    channelIds: toNumberList(channelIds),
    clientId: clientId === null ? null : clientId,
    clientSecret: clientSecret === null ? null : clientSecret,
    currencyCode:
      currencyCode === null || currencyCode === undefined
        ? 'USD'
        : currencyCode,
    languageId:
      languageId === null || languageId === undefined ? 'en_US' : languageId,
    liferayUrl: liferayUrl === null ? null : liferayUrl,
    localeCode:
      localeCode === null || localeCode === undefined ? 'en-US' : localeCode,
    pollingDelay: toNumber(pollingDelay),
    pollingRetries: toNumber(pollingRetries),
    selectedLanguages:
      selectedLanguages === null || selectedLanguages === undefined
        ? ['en-US']
        : selectedLanguages,
    siteGroupId: toNumber(siteGroupId),
    microserviceUrl: constructedMicroserviceUrl || undefined,
    correlationId,
  };

  const {
    liferayUrl: effectiveUrl,
    clientId: effectiveClientId,
    clientSecret: effectiveClientSecret,
    isColocated,
  } = resolveEffectiveLiferayConnection(
    rawConfig,
    req.app?.locals?.oauthService
  );

  const config = {
    ...rawConfig,
    aiModel,
    liferayUrl: effectiveUrl,
    clientId: effectiveClientId,
    clientSecret: effectiveClientSecret,
    isColocated,
  };

  const options = {
    demoMode: toBoolean(demoMode),
  };

  logger.info('options before switch in buildConfigAndOptions:', options);

  options.productCount = toNumber(productCount);
  options.sessionName = sessionName;
  options.brandName = brandName;
  options.geographicContext = parseMaybeJSON(geographicContext);
  options.categories = categories;
  options.generateBulkPricing = toBoolean(generateBulkPricing);
  options.generatePriceLists = toBoolean(generatePriceLists);
  options.generatePromotions = toBoolean(generatePromotions);
  options.generateSkuVariants = toBoolean(generateSkuVariants);
  options.generateSpecifications = toBoolean(generateSpecifications);
  options.generateTierPricing = toBoolean(generateTierPricing);
  options.imageHeight = toNumber(imageHeight) || 512;
  options.imageMode = imageMode || 'none';
  options.imageQuality = imageQuality || 'standard';
  options.imageRatio =
    toPercentage(imageRatio, { field: 'imageRatio', logger }) || 0;
  options.imageStyle = imageStyle || 'photographic';
  options.imageWidth = toNumber(imageWidth) || 512;
  options.pdfMode = pdfMode || 'none';
  options.pdfContentType = pdfContentType;
  options.pdfRatio = toPercentage(pdfRatio, { field: 'pdfRatio', logger }) || 0;
  options.seedPack = seedPack || undefined;
  options.createWarehouses = toBoolean(createWarehouses);
  // Restored in #730. Removed as redundant in #692 on the grounds that
  // unchecking createWarehouses *is* "reuse existing", which is true for two
  // of the three states an operator needs and silently loses the third:
  // create only the shortfall. Its original default was true - the CLI read
  // `opts.reuseExistingWarehouses !== false` - and true is the
  // non-duplicating choice, so absent keeps meaning true.
  options.reuseExistingWarehouses =
    reuseExistingWarehouses !== false &&
    String(reuseExistingWarehouses) !== 'false';
  options.warehouseCount = toNumber(warehouseCount);
  options.customImageFile = getCustomImage(req, options.imageMode);
  options.customPdfFile = getCustomPdf(req, options.pdfMode);
  options.orderCount = toNumber(orderCount);
  options.orderDateRangeDays = toNumber(orderDateRangeDays);
  // Sent as a JSON string on the multipart path, since toFormData stringifies
  // any object it is given; parseMaybeJSON accepts both that and a real object.
  options.orderDistribution = parseMaybeJSON(orderDistribution);
  options.accountCount = toNumber(accountCount);

  // accountType was validated by the request schema but never carried into
  // options, so aiService always fell back to 'business' and the Account Type
  // control had no effect. See #587.
  options.accountType = accountType || 'business';

  // Which existing accounts standalone order runs may draw from. Deliberately
  // separate from accountType, which defaults to 'business' for account
  // generation - reusing it would silently stop order runs from using existing
  // individual accounts. Left undefined when absent so any customer account
  // qualifies, as it did before. See #611.
  options.orderAccountType = orderAccountType || undefined;

  // Only meaningful for the mixed type. Left undefined when absent so the
  // prompt's own mixed branch keeps deciding the split, as it did before.
  // Was stored 0-1 while every other ratio was 0-100, which is the condition
  // that produced #711. It is a percentage now, and `legacyFraction` takes a
  // saved 0.7 as 70% rather than reading it as 0.7% - for this field alone a
  // stored 1 means "all", because that was the old maximum (#729).
  options.businessAccountRatio = toPercentage(businessAccountRatio, {
    field: 'businessAccountRatio',
    legacyFraction: true,
    logger,
  });
  options.inventoryMin = toNumber(inventoryMin);
  options.inventoryMax = toNumber(inventoryMax);
  options.inventoryAssignmentRatio = toPercentage(inventoryAssignmentRatio, {
    field: 'inventoryAssignmentRatio',
    logger,
  });

  logger.info('options after switch in buildConfigAndOptions:', options);

  return { config, options };
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
    /[A-Za-z0-9_-]+=*/.test(str.split('.')[0]) &&
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

function redactStringGeneric(str, _) {
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
  if ('value' in entry) {
    safe.value = sanitizeValue(entry.value, pathRoot.concat('value'));
  }
  return safe;
}

function sanitizedObject(obj) {
  const sanitizedObj = { ...obj };
  if (sanitizedObj.clientSecret) sanitizedObj.clientSecret = '[REDACTED]'; // pragma: allowlist secret
  if (sanitizedObj.Authorization) sanitizedObj.Authorization = '[REDACTED]';
  if (sanitizedObj.openaiApiKey) sanitizedObj.openaiApiKey = '[REDACTED]'; // pragma: allowlist secret

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
  return Object.entries(obj).map(([batchId, status]) => ({
    batchId,
    status,
  }));
}

const sanitizedERC = (str) =>
  str
    .replace(/&/g, 'AND')
    .replace(/[^A-Za-z0-9-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

module.exports = {
  bufferToDataUrl,
  buildConfigAndOptions,
  maskMiddle,
  parseBatchStatuses,
  parseMaybeJSON,
  redactUrl,
  sanitizeCacheDump,
  sanitizeCacheEntry,
  sanitizeValue,
  sanitizedERC,
  sanitizedObject,
  toBoolean,
  toNumber,
};
