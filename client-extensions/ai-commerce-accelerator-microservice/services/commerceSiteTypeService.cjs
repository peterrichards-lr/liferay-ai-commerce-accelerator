/**
 * Reads a commerce channel's site type from the `commerce-site-type` OSGi
 * module.
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
  APPLICATION_BASE,
  CommerceSiteTypeService,
  MAX_ANNOTATED_CHANNELS,
};
