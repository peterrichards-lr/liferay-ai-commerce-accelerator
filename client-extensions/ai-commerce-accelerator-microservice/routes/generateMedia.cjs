const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const multer = require('multer');
const {
  buildConfigAndOptions,
  sanitizedObject,
} = require('../utils/normalize.cjs');
const { handleError } = require('../utils/handleErrorHelper.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { resolveErrorReference, createERC } = require('../utils/misc.cjs');
const { buildMediaSubflow } = require('../utils/mediaSubflow.cjs');
const {
  MEDIA_SCOPES,
  selectProductsForMedia,
} = require('../utils/mediaScope.cjs');

const upload = multer({ storage: multer.memoryStorage() });

const toBoolean = (value) => value === true || value === 'true';

function parseExternalReferenceCodes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return String(raw)
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
  }
}

/**
 * Attaches images and PDFs to products that already exist in the target,
 * matched by external reference code, without recreating any commerce data.
 *
 * One flow, two ways in: a dataset imported from another instance, which never
 * carries its media, and a run whose media failed or was skipped - the outcome
 * #673 made survivable. Both leave the same gap and take the same remedy.
 */
module.exports = (
  app,
  { logger, progressService, persistenceService, batchCallbackService }
) => {
  app.post(
    INTERNAL_API_PATHS.GENERATE_MEDIA,
    upload.fields([{ name: 'customImageFile' }, { name: 'customPDFFile' }]),
    async (req, res) => {
      const { config, options } = buildConfigAndOptions(req);
      config.demoMode = options.demoMode;

      try {
        // Media is the expensive part of a run, so it never starts as a side
        // effect of something else - not even when the caller is our own UI.
        if (!toBoolean(req.body?.confirmMediaGeneration)) {
          return res.status(400).json({
            success: false,
            error:
              'Media generation must be confirmed explicitly. Send confirmMediaGeneration=true.',
          });
        }

        const sourceSessionId = req.body?.sourceSessionId;
        if (!sourceSessionId) {
          return res.status(400).json({
            success: false,
            error: 'sourceSessionId is required to identify the products.',
          });
        }

        const sourceSession =
          await persistenceService.getSession(sourceSessionId);
        if (!sourceSession) {
          return res.status(404).json({
            success: false,
            error: `Session not found: ${sourceSessionId}`,
          });
        }

        if (options.imageMode === 'none' && options.pdfMode === 'none') {
          return res.status(400).json({
            success: false,
            error:
              'Nothing to generate: both imageMode and pdfMode are set to none.',
          });
        }

        const scope =
          req.body?.mediaScope === MEDIA_SCOPES.ALL
            ? MEDIA_SCOPES.ALL
            : MEDIA_SCOPES.MISSING;

        const { imageProducts, pdfProducts } = selectProductsForMedia(
          sourceSession.context,
          {
            scope,
            externalReferenceCodes: parseExternalReferenceCodes(
              req.body?.productExternalReferenceCodes
            ),
          }
        );

        const scopedImageProducts =
          options.imageMode === 'none' ? [] : imageProducts;
        const scopedPdfProducts = options.pdfMode === 'none' ? [] : pdfProducts;

        if (
          scopedImageProducts.length === 0 &&
          scopedPdfProducts.length === 0
        ) {
          return res.json({
            success: false,
            error:
              scope === MEDIA_SCOPES.MISSING
                ? 'Every product in this dataset already has the media requested.'
                : 'This session has no products to attach media to.',
          });
        }

        // Both steps run over the whole selection: the ratios exist to vary a
        // generated catalogue, and a run asked for specific products has
        // already made that choice.
        const mediaOptions = {
          ...options,
          imageRatio: options.imageRatio || 100,
          pdfRatio: options.pdfRatio || 100,
          productCount: Math.max(
            scopedImageProducts.length,
            scopedPdfProducts.length
          ),
          sourceSessionId,
          mediaScope: scope,
        };

        const steps = [buildMediaSubflow({ includeSyncDelay: true })];
        const sessionId = createERC(ERC_PREFIX.BATCH_SESSION);

        await persistenceService.createSession({
          sessionId,
          flowType: 'media',
          status: 'STARTED',
          currentSteps: [],
          correlationId: config.correlationId,
          sessionName:
            options.sessionName ||
            `Media for ${sourceSession.session_name || sourceSessionId}`,
          context: {
            config,
            options: mediaOptions,
            steps,
            generator: 'unified',
            productDataList: sourceSession.context.productDataList || [],
            imageProductDataList: scopedImageProducts,
            pdfProductDataList: scopedPdfProducts,
          },
        });

        progressService.sessionStarted({
          sessionId,
          flowType: 'media',
          correlationId: config.correlationId,
        });

        batchCallbackService._checkSessionCompletion(
          sessionId,
          config.correlationId
        );

        logger.info('Media generation workflow started', {
          correlationId: config.correlationId,
          sessionId,
          sourceSessionId,
          scope,
          imageCount: scopedImageProducts.length,
          pdfCount: scopedPdfProducts.length,
        });

        return res.json({
          success: true,
          sessionId,
          imageCount: scopedImageProducts.length,
          pdfCount: scopedPdfProducts.length,
          message: 'Media generation workflow started successfully.',
          correlationId: config.correlationId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        const errorReference =
          resolveErrorReference(error) || createERC(ERC_PREFIX.ERROR);

        progressService?.emitError?.({
          message: error.message || 'Media generation failed to start',
          operation: 'generate-media',
          entityType: 'workflow',
          correlationId: config.correlationId,
          errorReference,
        });

        return handleError(
          res,
          logger,
          req,
          config,
          'generate-media',
          Object.assign(error, { errorReference }),
          {
            entityType: 'workflow',
            sanitizeConfig: sanitizedObject(config),
            sanitizeOptions: sanitizedObject(options),
          }
        );
      }
    }
  );
};
