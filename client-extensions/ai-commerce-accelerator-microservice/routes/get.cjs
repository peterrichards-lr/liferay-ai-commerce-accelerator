const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');
const {
  inputValidationMiddleware,
} = require('../middleware/securityMiddleware.cjs');
const { connectionSchema } = require('../utils/schemas.cjs');
const { sanitizedObject } = require('../utils/normalize.cjs');
const { createERC, resolveErrorReference } = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');

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

/**
 * Sets a channel's commerce site type and then proves it took.
 *
 * A brand-new channel *displays* B2C while storing nothing - `siteType` comes
 * through Liferay's `FallbackKeysSettingsUtil` and falls back to "0" whether or
 * not anyone set it. So a `PUT` that answers 200 is not evidence the value
 * persisted, and reporting the request back to the operator would tell them
 * their channel is B2B when the instance holds nothing at all. Only the
 * read-back is evidence, and it is taken here rather than trusted from the
 * setter's own return, because the question this asks is what the instance
 * holds, not what the write believed.
 *
 * `applied` is therefore true for exactly one outcome: the module reports the
 * type CONFIGURED and agreeing with what was asked for. Everything else is
 * reported as what it is and leaves the channel standing - the channel is the
 * expensive half and the type is settable afterwards in Commerce → Channels.
 *
 * The setter itself belongs to #1045. Until it lands, an absent method is the
 * `unsupported` outcome rather than a crash, for the same reason every other
 * call on this module degrades: the commerce-site-type module is an optional
 * deployment.
 */
async function applySiteType(
  commerceSiteTypeService,
  config,
  channelId,
  siteType
) {
  const requested = String(siteType ?? '').trim();

  if (!requested) {
    return null;
  }

  if (typeof commerceSiteTypeService?.setChannelSiteType !== 'function') {
    return {
      requested,
      applied: false,
      reason: 'unsupported',
      message:
        `The commerce site type ${requested} was not applied: this build ` +
        'cannot write one. Set it in Commerce → Channels.',
    };
  }

  try {
    await commerceSiteTypeService.setChannelSiteType(
      config,
      channelId,
      requested
    );
  } catch (error) {
    return {
      requested,
      applied: false,
      reason: 'refused',
      message:
        `The commerce site type ${requested} was refused by the instance ` +
        `(${error?.message || 'no reason given'}). The channel was created. ` +
        'Set the type in Commerce → Channels.',
    };
  }

  const readBack = await commerceSiteTypeService.getChannelSiteType(
    config,
    channelId
  );

  const matches = [readBack?.siteType, readBack?.siteTypeLabel].some(
    (value) =>
      value != null &&
      String(value).trim().toLowerCase() === requested.toLowerCase()
  );

  if (readBack?.siteTypeStatus === 'CONFIGURED' && matches) {
    return {
      requested,
      applied: true,
      reason: 'confirmed',
      siteType: readBack.siteType,
      siteTypeLabel: readBack.siteTypeLabel,
      message: null,
    };
  }

  return {
    requested,
    applied: false,
    reason: 'unconfirmed',
    siteType: readBack?.siteType ?? null,
    siteTypeLabel: readBack?.siteTypeLabel ?? null,
    message:
      `The commerce site type ${requested} was accepted but reads back as ` +
      `${readBack?.siteTypeLabel || readBack?.siteType || 'unset'}, so it did ` +
      'not persist. The channel was created. Set the type in Commerce → ' +
      'Channels.',
  };
}

module.exports = (app, { commerceSiteTypeService, liferayService, logger }) => {
  app.post(
    INTERNAL_API_PATHS.GET_CATALOGS,
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
    INTERNAL_API_PATHS.GET_CHANNELS,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const channels = await liferayService.getChannels(req.body);

        // Annotated rather than filtered: a channel whose site type does not
        // suit the current account type is still selectable, because changing
        // the account type is as valid a response as changing the channel.
        // See #610.
        const annotated = commerceSiteTypeService
          ? await commerceSiteTypeService.annotateChannels(req.body, channels)
          : channels;

        res.json({
          success: true,
          channels: annotated,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-channels', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  /**
   * Creates a catalog, which is where a run's prices are actually denominated.
   *
   * Nothing in AICA could create one before, so a demo in any currency but USD
   * meant creating the catalog by hand: the stock `Master` catalog is USD, and
   * a catalog's currency is what its price lists are written in (#746).
   *
   * The refusals mirror `create-channel`'s, and for a stronger reason. A
   * substituted channel currency is corrected by choosing a different channel;
   * a substituted catalog currency is corrected by deleting the catalog and
   * everything generated into it.
   */
  app.post(
    INTERNAL_API_PATHS.CREATE_CATALOG,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const currencyCode = String(req.body.currencyCode ?? '').trim();
        const defaultLanguageId = String(
          req.body.defaultLanguageId ?? ''
        ).trim();
        const name = String(req.body.name ?? '').trim();

        if (!currencyCode) {
          throw new Error(
            'A currencyCode is required to create a catalog. Refusing to ' +
              'choose one, because a catalog denominates every price list ' +
              'written into it and its currency cannot be changed afterwards.'
          );
        }

        if (!name) {
          throw new Error(
            'A name is required to create a catalog. Refusing to choose one, ' +
              'because catalogs are told apart by name.'
          );
        }

        if (!defaultLanguageId) {
          throw new Error(
            'A defaultLanguageId is required to create a catalog. Refusing ' +
              'to choose one, because it decides which locale generated ' +
              'product names are written in.'
          );
        }

        const catalog =
          await liferayService.client.headlessCommerceAdminCatalog.v1_0.postCatalog(
            { liferayUrl, clientId, clientSecret, localeCode },
            { currencyCode, defaultLanguageId, name }
          );

        res.json({
          success: true,
          catalog,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'create-catalog', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    INTERNAL_API_PATHS.CREATE_CHANNEL,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        // A channel's currency does not stay the channel's: selecting the
        // channel adopts it as the run's currency, which is what price lists
        // are then denominated in. A name is how one channel is told from
        // another. Neither is the route's to invent - substituting one here
        // produced a USD channel for a run configured as EUR, and nothing said
        // so (#745). The caller states both or the request is refused.
        const currencyCode = String(req.body.currencyCode ?? '').trim();
        const name = String(req.body.name ?? '').trim();

        if (!currencyCode) {
          throw new Error(
            'A currencyCode is required to create a channel. Refusing to ' +
              'choose one, because the channel currency becomes the currency ' +
              'of every run that selects it.'
          );
        }

        if (!name) {
          throw new Error(
            'A name is required to create a channel. Refusing to choose one, ' +
              'because channels are told apart by name.'
          );
        }

        // The only type Liferay's own Add Channel dialog offers is Site, so
        // this is a constant rather than a default standing in for a choice.
        const channelPayload = { currencyCode, name, type: 'site' };

        // Languages come from the channel's *site*, so a channel created
        // without one offers none and cannot be generated into in any locale.
        // That is the other half of what the rescue button got wrong, and it
        // is why the dialog asks (#746). Absent stays absent rather than
        // resolving to whatever site happens to be first.
        const siteGroupId = Number(req.body.siteGroupId);

        if (Number.isFinite(siteGroupId) && siteGroupId > 0) {
          channelPayload.siteGroupId = siteGroupId;
        }

        const channel = await liferayService.createChannel(
          { liferayUrl, clientId, clientSecret, localeCode },
          channelPayload
        );

        const siteType = await applySiteType(
          commerceSiteTypeService,
          req.body,
          channel?.id,
          req.body.siteType
        );

        res.json({
          success: true,
          channel,
          siteType,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'create-channel', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    INTERNAL_API_PATHS.GET_CURRENCIES,
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
    INTERNAL_API_PATHS.GET_LANGUAGES,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { siteGroupId, ...config } = req.body;

        if (!siteGroupId) {
          throw new Error('siteGroupId is required');
        }

        const languages = await liferayService.getLanguages(
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

  /**
   * The sites a new channel can be attached to.
   *
   * Company-scoped, so this answers on an instance with no channel at all -
   * which is the instance the create dialog exists for. `getSites` is not on
   * the SDK's own surface, so the generated site client is asked directly
   * rather than a near-duplicate being added here.
   */
  app.post(
    INTERNAL_API_PATHS.GET_SITES,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const page =
          await liferayService.client.headlessAdminSite.v1_0.getSitesPage(
            { liferayUrl, clientId, clientSecret, localeCode },
            undefined,
            { params: { page: 1, pageSize: 100 } }
          );

        const sites = (Array.isArray(page?.items) ? page.items : []).map(
          (site) => ({
            id: site.id,
            name: site.name,
            friendlyUrlPath: site.friendlyUrlPath,
          })
        );

        res.json({
          success: true,
          sites,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-sites', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );

  app.post(
    INTERNAL_API_PATHS.GET_WAREHOUSES,
    inputValidationMiddleware(connectionSchema),
    async (req, res) => {
      try {
        const { liferayUrl, clientId, clientSecret, localeCode } = req.body;

        const warehouses = await liferayService.getWarehouses({
          liferayUrl,
          clientId,
          clientSecret,
          localeCode,
        });

        res.json({
          success: true,
          warehouses,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleError(res, logger, req, 'get-warehouses', error, {
          requestBody: sanitizedObject(req.body),
        });
      }
    }
  );
};
