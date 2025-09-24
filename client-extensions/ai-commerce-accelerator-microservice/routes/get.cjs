module.exports = function (app, liferayService, logger) {
  app.post('/api/get-languages', async (req, res) => {
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
      res.json({ success: true, languages }); // top-level
    } catch (error) {
      logger.errorWithStack(error, {
        correlationId: req.correlationId,
        operation: 'get-languages',
      });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/get-currencies', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, localeCode, languageId } =
      req.body;

    // Fallback: if service is down, you return a fallback list in your existing code
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
    // keep your fallback block here if you have one
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/get-channels', async (req, res) => {
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
});

app.post('/api/get-catalogs', async (req, res) => {
  try {
    const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

    if (!liferayUrl || !clientId || !clientSecret || !localeCode) {
      return res.status(400).json({
        success: false,
        error: 'Missing required connection parameters',
      });
    }

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
});
};
