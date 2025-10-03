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

  // Common
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

  // Determine microservice URL - use environment variable or construct from request
  let constrictedMicroserviceUrl = microserviceUrl;
  if (
    !constrictedMicroserviceUrl ||
    constrictedMicroserviceUrl === 'null' ||
    constrictedMicroserviceUrl === 'undefined'
  ) {
    // Try to construct from environment or request headers
    const protocol =
      req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    const host =
      req.headers['x-forwarded-host'] ||
      req.headers.host ||
      `localhost:${PORT}`;
    constrictedMicroserviceUrl = `${protocol}://${host}`;
    console.log(`Constructed microservice URL: ${constrictedMicroserviceUrl}`);
  }

  // Validate the constructed URL
  try {
    new URL(constrictedMicroserviceUrl);
  } catch (urlError) {
    console.warn(
      `Invalid microservice URL constructed: ${constrictedMicroserviceUrl}, falling back to null`
    );
    constrictedMicroserviceUrl = null;
  }

  config.microserviceUrl = constrictedMicroserviceUrl;

  const options = Object.assign({}, { demoMode: !!demoMode });

  // Operation specific
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
  toBoolean,
  toNumber,
  parseMaybeJSON,
  bufferToDataUrl,
  buildConfigAndOptions,
  sanitizedObject,
  parseBatchStatuses,
};
