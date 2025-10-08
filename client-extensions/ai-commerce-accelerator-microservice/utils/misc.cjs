const { logger } = require('../utils/logger.cjs');

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

function ratioTrigger(radio) {
  return radio > 0 && Math.random() * 100 < radio;
}

async function handleDemoProductGeneration(
  config,
  options,
  productGenerator,
  res
) {
  try {
    logger.trace(
      `Demo mode: Generating ${options.productCount} mock products using batch endpoint`
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

    logger.trace(
      `Demo: Successfully initiated batch creation of ${
        result.created || 0
      } products`
    );

    res.json({
      success: true,
      batchId: result.products[0]?.batchId,
      count: result.created || 0,
      pdfCount: expectedPDFs,
      imageCount: expectedImages,
      errors: result.errors,
      status: result.products[0]?.status || 'submitted',
      demo: true,
      batch: true,
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
      `Demo mode: Generating ${options.orderCount} mock orders using consistent service approach`
    );

    // Validate catalogId is provided as integer
    if (
      !config.catalogId ||
      typeof config.catalogId !== 'number' ||
      config.catalogId <= 0
    ) {
      return res.status(400).json({
        success: false,
        error: 'catalogId is required and must be a positive integer',
        demo: true,
      });
    }

    // Use the same orderGenerator.generateOrders method as live mode
    const result = await orderGenerator.generateOrders(config, options);

    res.json({
      success: true,
      count: result.created,
      errors: result.errors,
      data: result.orders,
      demo: true,
    });
  } catch (error) {
    logger.errorWithStack(error, {
      correlationId: config.correlationId,
      operation: 'demo-generate-orders',
    });

    // Check for validation errors that should be warnings
    const errorMessage = error.message || 'Demo order generation failed';
    let statusCode = 500;

    if (
      errorMessage.includes('No products available') ||
      errorMessage.includes('No accounts available')
    ) {
      statusCode = 400; // Bad request for validation errors
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
      accountCount: config.accountCount,
      batchSize: config.batchSize,
      pollingDelay: config.pollingDelay,
    });

    logger.trace(
      `Demo mode: Generating ${config.accountCount} mock accounts using batch endpoint with batch size: ${config.batchSize}`
    );

    const shouldUseBatch = config.accountCount > 5;
    const actualBatchSize = shouldUseBatch ? Math.max(config.batchSize, 5) : 1;

    const result = await accountGenerator.generateAccounts(config, options);

    // Handle both batch and individual responses
    if (result.batchId) {
      // Batch response
      logger.info('Demo account batch generation completed successfully', {
        correlationId: config.correlationId,
        operation: 'demo-generate-accounts',
        batchId: result.batchId,
        accountCount: result.count,
        usedBatch: true,
      });

      res.json({
        success: true,
        batchId: result.batchId,
        count: result.count,
        status: result.status,
        message: result.message,
        demoMode: true,
        batch: true,
      });
    } else if (result.success) {
      // Individual response
      logger.info('Demo account generation completed successfully', {
        correlationId: config.correlationId,
        operation: 'demo-generate-accounts',
        accountCount: result.created,
        usedBatch: false,
      });

      res.json({
        success: true,
        count: result.created,
        errors: result.errors,
        message: `Successfully generated ${result.created} demo accounts using individual creation`,
        demoMode: true,
        batch: false,
      });
    } else {
      logger.error('Demo account generation failed', {
        correlationId: config.correlationId,
        operation: 'demo-generate-accounts',
        error: result.error || 'Unknown error',
      });

      res.status(500).json({
        success: false,
        error: result.error || 'Account generation failed',
        demoMode: true,
      });
    }
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

  // helpers
  const hasBase64Param = (meta) =>
    meta.split(';').some((p) => p.toLowerCase() === 'base64');

  const looksLikeBase64 = (s) =>
    /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s+/g, '').length >= 8;

  const normalizeBase64 = (s) => {
    const stripped = s.replace(/\s+/g, '');
    const pad = stripped.length % 4;
    return pad === 0 ? stripped : stripped + '==='.slice(pad);
  };

  // Case 1: data URL
  if (data.startsWith('data:')) {
    const commaIndex = data.indexOf(',');
    if (commaIndex === -1) {
      throw new Error('parseDataUrl: malformed data URL (missing comma)');
    }

    const meta = data.slice(5, commaIndex); // after "data:"
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

  // Case 2: plain base64
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

module.exports = {
  getRandomInt,
  handleDemoProductGeneration,
  handleDemoAccountGeneration,
  handleDemoOrderGeneration,
  buildDataUrl,
  parseDataUrl,
};
