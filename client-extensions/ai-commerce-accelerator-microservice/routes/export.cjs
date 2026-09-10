const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { buildMediaBundle } = require('../utils/mediaBundle.cjs');
const { extractDatasetMedia } = require('../utils/mediaExtractor.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');

/**
 * Reads a session's context into the export shape.
 *
 * Shared by the JSON export and the bundle, so the two cannot drift into
 * disagreeing about what a dataset contains - which would be invisible until a
 * promotion arrived short.
 */
function datasetFromSession(session, source) {
  const ctx = session.context;

  return {
    metadata: {
      source,
      sessionId: session.session_id,
      sessionName: session.session_name,
      completedAt: session.updated_at,
    },
    products: ctx.productDataList || [],
    accounts: ctx.accountDataList || [],
    orders: ctx.orderDataList || [],
    addresses: ctx.addressesToCreate || [],
    warehouses: ctx.warehouseDataList || [],
    specificationDefinitions: ctx.specificationDefinitions || [],
    optionDefinitions: ctx.optionDefinitions || [],
    defaultSpecificationCategory: ctx.defaultSpecificationCategory || null,
    images: ctx.createdImages || [],
    pdfs: ctx.createdPdfs || [],
    groundingMetadata: ctx.groundingMetadata || null,
    exportedAt: new Date().toISOString(),
  };
}

module.exports = (
  app,
  { cacheService, liferayService, logger, persistenceService }
) => {
  app.get(INTERNAL_API_PATHS.EXPORT_COMMERCE_DATA, async (req, res) => {
    try {
      const { sessionId } = req.query;
      let exportData = null;

      if (sessionId) {
        const session = await persistenceService.getSession(sessionId);
        if (session && session.context) {
          exportData = datasetFromSession(session, 'session-db');
        }
      }

      // Fallback to cache if no sessionId or session not found
      if (!exportData) {
        const products = cacheService.get('generated-data:products');
        const accounts = cacheService.get('generated-data:accounts');
        const orders = cacheService.get('generated-data:orders');

        if (products || accounts || orders) {
          exportData = {
            metadata: { source: 'cache' },
            products: products || [],
            accounts: accounts || [],
            orders: orders || [],
            exportedAt: new Date().toISOString(),
          };
        }
      }

      // Final fallback to latest completed in DB
      if (!exportData) {
        const latestSession =
          await persistenceService.getLatestCompletedSession();
        if (latestSession && latestSession.context) {
          exportData = datasetFromSession(latestSession, 'session-db-latest');
        }
      }

      if (!exportData) {
        exportData = {
          metadata: { source: 'empty' },
          products: [],
          accounts: [],
          orders: [],
          exportedAt: new Date().toISOString(),
        };
      }

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="commerce-dataset.json"'
      );
      res.setHeader('Content-Type', 'application/json');
      res.status(200).json(exportData);
    } catch (error) {
      const errorReference = createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to export commerce data', {
        operation: 'export-commerce-data',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to export commerce data',
        errorReference,
      });
    }
  });

  /**
   * The dataset plus the binaries its media entries point at, pulled from a
   * live Liferay instance.
   *
   * This is extract rather than export, and the difference is cost. An export
   * packages what this service already holds - the session context and, once
   * #848 lands, the media on disk - and needs no access to anything. Extract
   * points at an instance, authenticates against it and pulls every binary
   * across the network. Same package, very different operation, so they are
   * named for what they do rather than for what they produce.
   *
   * A POST rather than a GET, and deliberately not a flag on the existing
   * export: this one calls Liferay, so it needs credentials, and credentials
   * in a query string end up in access logs. That is #820 in a different
   * costume, and every other Liferay-calling route in this service already
   * takes them in a body.
   *
   * The media is resolved from the source instance by product ERC, so a
   * dataset generated before anything recorded an attachment id can still be
   * promoted - which is the case in front of us, and the reason this route
   * resolves rather than reads what the run recorded (#814).
   */
  app.post(INTERNAL_API_PATHS.EXTRACT_COMMERCE_BUNDLE, async (req, res) => {
    const { config } = buildConfigAndOptions(req);
    const correlationId = config.correlationId;

    try {
      const { sessionId } = req.body || {};

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error:
            'sessionId is required. A bundle is built for one session, not for whatever ran last.',
        });
      }

      const session = await persistenceService.getSession(sessionId);

      if (!session || !session.context) {
        return res.status(404).json({
          success: false,
          error: `No session found for ${sessionId}`,
        });
      }

      const dataset = datasetFromSession(session, 'session-db');

      logger.info('Extracting media from the source instance', {
        correlationId,
        operation: 'extract-commerce-bundle',
        productCount: dataset.products.length,
        sessionId,
      });

      const media = await extractDatasetMedia({
        config,
        correlationId,
        liferayService,
        logger,
        products: dataset.products,
      });

      const { buffer, manifest } = await buildMediaBundle({ dataset, media });

      // Said plainly, because a bundle that carries fewer pictures than the
      // source still imports cleanly and still looks like success.
      logger.info(
        `Extracted bundle built: ${manifest.counts.images} image(s), ${manifest.counts.pdfs} PDF(s), ${manifest.counts.unresolved} unresolved`,
        {
          correlationId,
          operation: 'extract-commerce-bundle',
          sessionId,
          ...manifest.counts,
        }
      );

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="commerce-dataset-${sessionId}.zip"`
      );
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('X-AICA-Media-Images', String(manifest.counts.images));
      res.setHeader('X-AICA-Media-Pdfs', String(manifest.counts.pdfs));
      res.setHeader(
        'X-AICA-Media-Unresolved',
        String(manifest.counts.unresolved)
      );
      res.status(200).send(buffer);
    } catch (error) {
      const errorReference = createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to extract commerce bundle', {
        correlationId,
        operation: 'extract-commerce-bundle',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to extract commerce bundle',
        errorReference,
      });
    }
  });
};
