/**
 * Reads and sets a commerce channel's site type through the
 * `commerce-site-type` OSGi module.
 *
 * The site type is stored as a group-scoped OSGi configuration on the channel's
 * own Group and no Headless API exposes it - see #622, the DXP feature request.
 * Until one exists, this shared module reports it. The path lives here rather
 * than in the SDK so that knowledge of which modules AICA deploys stays in
 * AICA.
 *
 * Every failure is reported rather than thrown. The module is an optional
 * deployment: an instance without it, or without the OAuth scope granted, must
 * still be able to generate. Callers decide what an unreadable site type means,
 * and in practice it means a warning.
 */
const APPLICATION_BASE = '/o/commerce-site-type';

/**
 * The codes the module's `PUT` accepts, by the name AICA reports them under.
 *
 * `utils/channelSiteType.cjs` deliberately encodes no numeric mapping, because
 * reading never needs one: the module supplies `allowedAccountTypes` and a
 * label. Writing cannot avoid one - the wire format is
 * `{"siteType": 0|1|2}` - so it lives here, with the rest of what AICA knows
 * about the modules it deploys, and nowhere else. Anything outside this set is
 * refused before the call rather than forwarded for the module to reject.
 */
const SITE_TYPES = Object.freeze({ B2C: 0, B2B: 1, B2X: 2 });

const ACCEPTED_SITE_TYPES = Object.freeze(Object.values(SITE_TYPES));

// The scope the module reports when the value was found explicitly set on the
// channel's own Group. Anything else means the write did not land where it was
// aimed, so the channel is answering with somebody else's setting.
const GROUP_SCOPE = 'GROUP';

const CONFIGURED = 'CONFIGURED';

/**
 * The requested type as the module's wire format, or `null` for anything that
 * is not one of the three it accepts.
 *
 * A numeric string is accepted because a value that has been through a form or
 * a JSON round trip is still the code the caller chose. What is not accepted is
 * anything `Number` would helpfully turn into one: `true` becomes 1 and both
 * `[]` and the empty string become 0, and 0, 1 and 2 are all valid site types,
 * so a caller who sent nothing would otherwise have set the channel to B2C.
 */
function toSiteTypeCode(siteType) {
  const stated =
    typeof siteType === 'number'
      ? siteType
      : typeof siteType === 'string'
        ? siteType.trim()
        : null;

  if (stated === null || stated === '') {
    return null;
  }

  const code = Number(stated);

  return ACCEPTED_SITE_TYPES.includes(code) ? code : null;
}

const describeAcceptedSiteTypes = () =>
  Object.entries(SITE_TYPES)
    .map(([label, code]) => `${code} (${label})`)
    .join(', ');

// Channels beyond this are returned unannotated. The module answers per
// channel, so a long list would otherwise mean a long list of requests to
// populate a dropdown. Instances have a handful of channels in practice.
const MAX_ANNOTATED_CHANNELS = 25;

// A single attempt. Every outcome that is not a 200 degrades to a warning, so
// retrying a missing module only delays the generation it cannot affect.
const REQUEST_OPTIONS = { maxRetries: 1 };

class CommerceSiteTypeService {
  constructor({ liferayService, logger }) {
    this.liferayService = liferayService;
    this.logger = logger;
  }

  /**
   * Returns the module's report for a channel, or `null` when it could not be
   * read for any reason.
   */
  async getChannelSiteType(config, channelId) {
    const id = Number(channelId);

    if (!Number.isFinite(id) || id <= 0) {
      return null;
    }

    const rest = this.liferayService?.rest || this.liferayService;

    if (typeof rest?._get !== 'function') {
      return null;
    }

    try {
      const data = await rest._get(
        config,
        `${APPLICATION_BASE}/channels/${id}/site-type`,
        'get-channel-site-type',
        'Failed to read commerce channel site type',
        REQUEST_OPTIONS
      );

      // A 200 carrying no status is as unusable as no response at all, and
      // treating it as one keeps the caller's checks to a single null test.
      return data?.siteTypeStatus ? data : null;
    } catch (err) {
      const status = err?.response?.status;

      this.logger?.debug?.('Commerce channel site type unavailable', {
        channelId: id,
        status,
        error: err?.message,
      });

      return null;
    }
  }

  /**
   * Sets a channel's commerce site type, and reports what the instance holds
   * afterwards rather than what was asked for.
   *
   * The read-back is the point. A channel that has never had a site type set
   * *displays* B2C while storing nothing, and Liferay's own UI is known to need
   * a change-save-change-back-save cycle before the value sticks - so a 200
   * from the write says the request was accepted, not that anything was
   * stored. `configuredScope` is what separates the two: the module reports
   * `GROUP` only when the value was found explicitly set on this channel's own
   * Group.
   *
   * Returns `{ success, requested, ...what the channel now reports }`, with
   * `error` naming the discrepancy whenever the two disagree.
   */
  async setChannelSiteType(config, channelId, siteType) {
    const id = Number(channelId);

    if (!Number.isFinite(id) || id <= 0) {
      return {
        success: false,
        error: `'${channelId}' is not a commerce channel id.`,
      };
    }

    const requested = toSiteTypeCode(siteType);

    if (requested === null) {
      return {
        success: false,
        error:
          `Commerce site type '${siteType}' is not one of ` +
          `${describeAcceptedSiteTypes()}.`,
      };
    }

    const rest = this.liferayService?.rest || this.liferayService;

    if (typeof rest?._put !== 'function') {
      return {
        requested,
        success: false,
        error: 'No Liferay client is available to set the site type with.',
      };
    }

    try {
      await rest._put(
        config,
        `${APPLICATION_BASE}/channels/${id}/site-type`,
        { siteType: requested },
        'set-channel-site-type',
        'Failed to set commerce channel site type'
      );
    } catch (err) {
      this.logger?.warn?.('Commerce channel site type could not be set', {
        channelId: id,
        requested,
        status: err?.response?.status,
        error: err?.message,
      });

      return {
        requested,
        success: false,
        error: `Failed to set commerce site type: ${err?.message}`,
      };
    }

    const stored = await this.getChannelSiteType(config, id);

    if (!stored) {
      this.logger?.warn?.('Commerce channel site type could not be read back', {
        channelId: id,
        requested,
      });

      return {
        requested,
        success: false,
        error:
          'The write was accepted but the site type could not be read back, ' +
          'so nothing confirms it was stored.',
      };
    }

    const observed = {
      allowedAccountTypes: stored.allowedAccountTypes,
      configuredScope: stored.configuredScope,
      siteType: stored.siteType,
      siteTypeLabel: stored.siteTypeLabel,
      siteTypeStatus: stored.siteTypeStatus,
    };

    // Absent reads as "could not be told" rather than as a failure: the scope
    // arrives from the same payload the write is reported in, so a module
    // build that does not report it has not thereby stored the value wrongly.
    const wrongScope =
      observed.configuredScope !== undefined &&
      observed.configuredScope !== null &&
      String(observed.configuredScope).toUpperCase() !== GROUP_SCOPE;

    const persisted =
      Number(observed.siteType) === requested &&
      String(observed.siteTypeStatus).toUpperCase() === CONFIGURED &&
      !wrongScope;

    if (!persisted) {
      this.logger?.warn?.('Commerce channel site type did not persist', {
        channelId: id,
        requested,
        ...observed,
      });

      return {
        ...observed,
        requested,
        success: false,
        // Everything the channel answered with, because which part disagrees
        // is what tells an operator whether the write was refused, landed at
        // the wrong scope, or was accepted and stored nothing at all.
        error:
          `Asked for commerce site type ${requested}, but the channel ` +
          `reports ${observed.siteType} (${observed.siteTypeStatus}) at ` +
          `${observed.configuredScope} scope.`,
      };
    }

    return { ...observed, requested, success: true };
  }

  /**
   * Copies each channel with its site type attached, so the configuration UI
   * can say what a channel accepts before a run is started rather than after
   * one is refused.
   *
   * A channel whose site type could not be read comes back unchanged, which is
   * what the UI treats as "nothing to show".
   */
  async annotateChannels(config, channels) {
    if (!Array.isArray(channels) || channels.length === 0) {
      return channels;
    }

    const annotated = await Promise.all(
      channels.slice(0, MAX_ANNOTATED_CHANNELS).map(async (channel) => {
        const info = await this.getChannelSiteType(config, channel?.id);

        return info
          ? {
              ...channel,
              allowedAccountTypes: info.allowedAccountTypes,
              siteType: info.siteType,
              siteTypeLabel: info.siteTypeLabel,
              siteTypeStatus: info.siteTypeStatus,
            }
          : channel;
      })
    );

    return [...annotated, ...channels.slice(MAX_ANNOTATED_CHANNELS)];
  }
}

module.exports = {
  ACCEPTED_SITE_TYPES,
  APPLICATION_BASE,
  CommerceSiteTypeService,
  MAX_ANNOTATED_CHANNELS,
  SITE_TYPES,
};
