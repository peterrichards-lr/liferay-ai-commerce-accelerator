const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const { createERC } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const {
  KIND,
  PACKAGE_EXTENSION,
  buildMediaBundle,
} = require('../utils/mediaBundle.cjs');
const { readMediaArchive } = require('../utils/mediaArchive.cjs');
const { extractDatasetMedia } = require('../utils/mediaExtractor.cjs');
const { buildInstanceDataset } = require('../utils/instanceExtractor.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');
const {
  logCommerceSelection,
  resolveRunCommerceSelection,
} = require('../utils/commerceSelection.cjs');
const {
  ownershipScopeFromRequestBody,
} = require('../utils/ownershipScope.cjs');

/** Where a bundle's dataset half came from. */
const DATASET_SOURCE = Object.freeze({
  /** The instance itself, read back through the commerce APIs (#849). */
  INSTANCE: 'instance',
  /** The run this service recorded, out of workflows.db. */
  SESSION: 'session',
});

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

/**
 * How many pictures and PDFs the run says it created, per product and kind.
 *
 * The dataset's `images` and `pdfs` are what the run recorded creating, and
 * the archive is what reached the disk. They can legitimately differ - the
 * archive can be switched on mid-run, it stands down after a write failure,
 * and it prunes by age and by session count - so the difference is a real
 * shortfall and has to be counted rather than assumed to be zero.
 */
function mediaExpectations(dataset) {
  const expected = new Map();

  const count = (records, kind) => {
    for (const record of records || []) {
      const key = `${kind}|${record.productERC}`;
      const seen = expected.get(key);

      if (seen) {
        seen.count += 1;
      } else {
        expected.set(key, { count: 1, kind, record });
      }
    }
  };

  count(dataset.images, KIND.IMAGE);
  count(dataset.pdfs, KIND.PDF);

  return expected;
}

/**
 * The media entries a package built from disk cannot carry, as bufferless
 * entries `buildMediaBundle` will record in `manifest.unresolved`.
 *
 * Reusing the unresolved mechanism rather than inventing a second one is the
 * point: whoever opens the package finds the shortfall in the same place
 * whichever producer built it, and the counts in the headers are arrived at
 * the same way.
 */
function archiveGaps({ dataset, entries, missing }) {
  const gaps = missing.map((entry) => ({
    contentType: entry.contentType,
    kind: entry.kind,
    priority: entry.priority,
    productERC: entry.productERC,
    reason: `the media archive no longer holds ${entry.file}`,
    title: entry.title,
  }));

  const recorded = new Map();

  for (const entry of [...entries, ...missing]) {
    const key = `${entry.kind}|${entry.productERC}`;
    recorded.set(key, (recorded.get(key) || 0) + 1);
  }

  for (const [key, { count, kind, record }] of mediaExpectations(dataset)) {
    const shortfall = count - (recorded.get(key) || 0);

    for (let i = 0; i < shortfall; i += 1) {
      gaps.push({
        contentType: record.contentType ?? null,
        kind,
        priority: record.priority ?? 1,
        productERC: record.productERC,
        reason: 'the run recorded this media but the archive never received it',
        title: record.title ?? null,
      });
    }
  }

  return gaps;
}

/**
 * Two honest numbers where there was one that conflated them (#886).
 *
 * `incomplete` counts products missing a field the generation schema requires
 * - a product that cannot be imported as it stands. `partial` counts products
 * whose only shortfall is optional, which on a healthy instance is most of
 * them: a blank `metaTitle` on the source is faithfully reproduced as a blank
 * `metaTitle`, and reporting that as a loss made the header read 22 of 22 on
 * a perfect extract. A signal that fires on every healthy run is one people
 * learn to ignore, and this one guards a promotion to production.
 */
function productCompleteness(dataset) {
  const report = dataset.metadata?.translationReport || [];

  let incomplete = 0;
  let partial = 0;

  for (const product of report) {
    if ((product.missing || []).some((field) => field.required)) {
      incomplete += 1;
    } else if ((product.missing || []).length > 0) {
      partial += 1;
    }
  }

  return { incomplete, partial };
}

/** The counts a package reports about itself, said the same way by both routes. */
function setBundleHeaders(res, { dataset, manifest, sessionId, source }) {
  const { incomplete, partial } = productCompleteness(dataset);

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="commerce-dataset-${sessionId || source}.${PACKAGE_EXTENSION}"`
  );
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('X-AICA-Media-Images', String(manifest.counts.images));
  res.setHeader('X-AICA-Media-Pdfs', String(manifest.counts.pdfs));
  res.setHeader('X-AICA-Media-Unresolved', String(manifest.counts.unresolved));
  res.setHeader('X-AICA-Products-Incomplete', String(incomplete));
  res.setHeader('X-AICA-Products-Partial', String(partial));

  return { incomplete, partial };
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
   * A package built from what this service already holds: the session's
   * dataset, and the binaries the run wrote to disk as it generated them.
   *
   * The cheap half of the pair. Extract points at an instance, authenticates
   * against it and pulls every binary across the network; this one reads a
   * directory. For a run whose media is on disk, all of that cost buys
   * nothing - and when the source instance is gone, unreachable, or has
   * expired the media, this is the only route that still works, which is the
   * case #848 built the archive for.
   *
   * A GET, where extract is a POST, and the difference is not cosmetic: this
   * route calls no instance, so it needs no credentials, so there is nothing
   * here that must be kept out of an access log (#820).
   *
   * `sessionId` is required and has no fallback to the latest run. The JSON
   * export's tier fallback is exactly the shape that quietly returns a
   * materially thinner dataset while reporting success (#840), and a package
   * is the artefact a promotion to production is built from.
   */
  app.get(INTERNAL_API_PATHS.EXPORT_COMMERCE_BUNDLE, async (req, res) => {
    // No `buildConfigAndOptions` here, deliberately: it resolves - and
    // insists on - a Liferay connection, and this route talks to no instance.
    // Requiring credentials to read a local directory would make the cheap
    // operation fail in exactly the situations it exists for.
    const correlationId = req.correlationId;

    try {
      const { sessionId } = req.query;

      if (!sessionId) {
        return res.status(400).json({
          success: false,
          error:
            'sessionId is required. A package is built for one session, not for whatever ran last.',
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
      const archive = readMediaArchive({ sessionId });
      const expected = dataset.images.length + dataset.pdfs.length;

      // An empty archive and a run that generated no media are different
      // answers, and a package cannot be allowed to conflate them. The first
      // has to refuse and name the route that does work; the second is an
      // honest package with no media in it.
      if (expected > 0 && !archive?.entries.length) {
        return res.status(409).json({
          success: false,
          error: `The run recorded ${expected} media item(s) and the media archive holds none of them, so this package would carry a catalogue with no pictures. ${
            archive
              ? 'The archive directory exists but has no usable files - it may have been pruned.'
              : 'The media archive is switched off (MEDIA_ARCHIVE_ENABLED) or was never written for this session.'
          } Use POST ${INTERNAL_API_PATHS.EXTRACT_COMMERCE_BUNDLE} to pull the media from the instance that holds it.`,
          expected,
          mediaArchive: archive ? 'empty' : 'unavailable',
        });
      }

      const media = [
        ...(archive?.entries || []),
        ...archiveGaps({
          dataset,
          entries: archive?.entries || [],
          missing: archive?.missing || [],
        }),
      ];

      const { buffer, manifest } = await buildMediaBundle({ dataset, media });

      logger.info(
        `Exported package built from the media archive: ${manifest.counts.images} image(s), ${manifest.counts.pdfs} PDF(s), ${manifest.counts.unresolved} unresolved`,
        {
          correlationId,
          operation: 'export-commerce-bundle',
          sessionId,
          ...manifest.counts,
        }
      );

      if (manifest.counts.unresolved > 0) {
        logger.warn(
          `${manifest.counts.unresolved} media item(s) the run recorded are not in this package; see media/manifest.json for which and why`,
          { correlationId, operation: 'export-commerce-bundle', sessionId }
        );
      }

      setBundleHeaders(res, {
        dataset,
        manifest,
        sessionId,
        source: DATASET_SOURCE.SESSION,
      });
      // Which producer built the package. The two carry the same format and
      // the same counts, and they fail in entirely different ways, so a
      // caller holding one should not have to guess which it has.
      res.setHeader('X-AICA-Media-Source', 'archive');
      res.status(200).send(buffer);
    } catch (error) {
      const errorReference = createERC(ERC_PREFIX.ERROR);
      logger.error('Failed to export commerce bundle', {
        correlationId,
        operation: 'export-commerce-bundle',
        errorReference,
        message: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Failed to export commerce bundle',
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
   *
   * `source` chooses where the *dataset* half comes from, and it is a
   * parameter on this route rather than a route of its own on purpose. The
   * media half, the manifest, the counts, the headers and the error handling
   * are identical whichever way the dataset was read - a sibling route would
   * duplicate all of it and then have to be kept in step - and the operation
   * is the same operation: point at an instance, pull a package out of it.
   * Only the answer to "where did the product list come from" differs, and
   * `metadata.source` already carries that into the artefact.
   *
   * It is required rather than inferred from the absence of `sessionId`.
   * Inferring it would make a typo'd session id silently produce an
   * instance-read package - the same shape of failure as the export's tier
   * fallback, where a missing session quietly yields a materially thinner
   * dataset that still reports success (#840).
   */
  app.post(INTERNAL_API_PATHS.EXTRACT_COMMERCE_BUNDLE, async (req, res) => {
    const { config } = buildConfigAndOptions(req);
    const correlationId = config.correlationId;

    try {
      const { sessionId, source = DATASET_SOURCE.SESSION } = req.body || {};

      if (!Object.values(DATASET_SOURCE).includes(source)) {
        return res.status(400).json({
          success: false,
          error: `Unknown source '${source}'. Use '${DATASET_SOURCE.SESSION}' to read the run this service recorded, or '${DATASET_SOURCE.INSTANCE}' to read the instance itself.`,
        });
      }

      let dataset;

      if (source === DATASET_SOURCE.INSTANCE) {
        // An extract lands in whichever catalog and channel this instance
        // resolves to, by the same rules an import and a run use, so the three
        // cannot disagree about which catalogue a promotion is about (#680).
        const commerceSelection = await resolveRunCommerceSelection({
          config,
          correlationId,
          liferayService,
          logger,
          operation: 'extract-commerce-bundle',
        });

        logCommerceSelection({
          correlationId,
          logs: commerceSelection.logs,
          logger,
          operation: 'extract-commerce-bundle',
        });

        if (commerceSelection.rejection) {
          return res.status(400).json({
            success: false,
            error: commerceSelection.rejection,
            details: commerceSelection.rejections,
          });
        }

        dataset = await buildInstanceDataset({
          config,
          correlationId,
          liferayService,
          logger,
          // The only path from a request body to a scope, and it needs the
          // confirmation phrase typed out in full. Anything else leaves the
          // AICA-owned default in place (#850).
          ownershipScope: ownershipScopeFromRequestBody(req.body),
        });
      } else {
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

        dataset = datasetFromSession(session, 'session-db');
      }

      logger.info('Extracting media from the source instance', {
        correlationId,
        operation: 'extract-commerce-bundle',
        productCount: dataset.products.length,
        sessionId,
        source,
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

      // A shortfall in the *dataset* is worth as much noise as a shortfall in
      // the media, and until now only the media had a header saying so.
      const { incomplete, partial } = setBundleHeaders(res, {
        dataset,
        manifest,
        sessionId,
        source,
      });
      res.setHeader('X-AICA-Media-Source', 'instance');

      if (incomplete) {
        logger.warn(
          `${incomplete} of ${dataset.products.length} products are missing a field the schema requires; see metadata.translationReport in the package`,
          { correlationId, operation: 'extract-commerce-bundle' }
        );
      }

      if (partial) {
        logger.info(
          `${partial} of ${dataset.products.length} products are missing optional fields only - usually because they are blank on the source (#886)`,
          { correlationId, operation: 'extract-commerce-bundle' }
        );
      }

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
