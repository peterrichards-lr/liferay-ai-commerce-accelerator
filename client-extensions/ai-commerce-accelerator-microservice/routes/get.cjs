const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { connectionSchema } = require('../utils/schemas.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

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
  if (err.reference && typeof err.reference === 'string') {
    return err.reference;
  }
  return null;
}

function handleError(res, logger, req, operation, error, opts = {}) {
  const baseMessage =
    (error && error.message) ||
    (typeof error === 'string' ? error : null) ||
    'Request failed. Please try again.';

  const isClientFault =
    baseMessage.includes('required') ||
    baseMessage.includes('Missing') ||
    baseMessage.includes('Not enough') ||
    baseMessage.includes('No ') ||
    baseMessage.includes('invalid');

  const statusCode = isClientFault ? 400 : 500;

  const errorReference =
    resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

  logger.error('Operation failed', {
    correlationId: req.correlationId,
    operation,
    errorReference,
    message: baseMessage,
    name: error?.name,
    stack: error?.stack,
    requestDetails: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    ...opts,
  });

  return res.status(statusCode).json({
    success: false,
    error: baseMessage,
    errorReference,
    timestamp: new Date().toISOString(),
  });
}

module.exports = (app, { liferayService, logger }) => {
  app.post(
    '/api/get-catalogs',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const catalogs = await liferayService.getCatalogs({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
        });

        res.json({
          success: true,
          catalogs,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-catalogs', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    '/api/get-channels',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const channels = await liferayService.getChannels({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
        });

        res.json({
          success: true,
          channels,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-channels', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    '/api/get-currencies',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const {
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
          languageId,
        } = req.body;

        const currencies = await liferayService.getCurrencies({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
          languageId,
        });

        res.json({
          success: true,
          currencies,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-currencies', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    '/api/get-languages',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { siteGroupId, ...config } = req.body;

        if (!siteGroupId) {
          throw new Error('siteGroupId is required');
        }

        const languages = await liferayService.getSiteLanguages(
          config,
          siteGroupId
        );

        res.json({
          success: true,
          languages,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-languages', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );
};