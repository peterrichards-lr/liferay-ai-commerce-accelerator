const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');

const { connectionSchema } = require('../utils/schemas.cjs');

module.exports = function (app, liferayService, logger) {
  app.post(
    '/api/get-catalogs',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      const correlationId = req.correlationId;
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const catalogs = await liferayService.getCatalogs({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
        });

        res.json({ success: true, catalogs });
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: req.correlationId,
          operation: 'get-catalogs',
        });
        res.status(400).json({
          success: false,
          error: error.message || 'Failed to fetch catalogs',
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
        res.json({ success: true, channels }); // <-- top-level channels
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: req.correlationId,
          operation: 'get-channels',
        });
        res.status(400).json({
          success: false,
          error: error.message || 'Failed to fetch channels',
        });
      }
    }
  );

  app.post(
    '/api/get-currencies',
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode, languageId } =
          req.body;

        const currencies = await liferayService.getCurrencies({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
          languageId,
        });

        res.json({ success: true, currencies });
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: req.correlationId,
          operation: 'get-currencies',
        });
        res.status(500).json({ success: false, error: error.message });
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
          return res
            .status(400)
            .json({ success: false, error: 'siteGroupId is required' });
        }
        const languages = await liferayService.getSiteLanguages(
          config,
          siteGroupId
        );
        res.json({ success: true, languages });
      } catch (error) {
        logger.errorWithStack(error, {
          correlationId: req.correlationId,
          operation: 'get-languages',
        });
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );
};
