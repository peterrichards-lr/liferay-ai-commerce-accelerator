const { ENV } = require('./constants.cjs');

/**
 * Keeps a service's settings following its Configuration panel.
 *
 * Every panel writes its object entry straight to Liferay's object API - see
 * `persistConfigKey` in the configuration extension - so no save ever reaches
 * this process. There is no event to hook; the only way a panel edit can take
 * effect without a restart is for this side to go and look.
 *
 * The period is `CONFIG_CACHE_TTL`, because the `getXConfig` reads are cached
 * on exactly that. Refreshing faster would re-read the same cached value and
 * reach Liferay no sooner; refreshing slower would leave a window where the
 * cache had expired and the settings still had not moved. So an edit lands
 * within one TTL - six minutes by default - and the cost is one request per
 * TTL, not one per refresh.
 *
 * `refreshConfigFromRemote` swallows its own failures by design, which is
 * what makes the first call safe: at boot Liferay is often not up, and a
 * later tick picks it up once it is.
 *
 * Written for OAuth in #1243 and generalised in #1270, when the cache and
 * queue panels turned out to be disconnected too and a second and third copy
 * would have been the alternative.
 *
 * @param {object} ctx the application context, after `ctx.config` exists
 * @param {object} options.service the service whose settings should follow
 * @param {string} options.subject what goes stale if this does not run, named
 *   for the warning a reader will see when it cannot
 * @param {string} options.operation the log `operation` for this service
 */
function startConfigRefresh(
  ctx,
  { service, subject, operation, intervalMs } = {}
) {
  const { config, logger } = ctx;

  // The late wiring, in the one place that can be tested.
  //
  // A service that resolves the config service through `this.ctx.config` may
  // have been constructed before `ctx.config` existed, and the order cannot
  // always be swapped - ConfigService takes `oauth` (#1175) and `cache`, so
  // each needs the other. Handing it over here keeps bootstrap a wiring file
  // and puts the fix somewhere a case can reach without booting the whole
  // application.
  if (service?.ctx && config) service.ctx.config = config;

  if (!service?.refreshConfigFromRemote) {
    // Not a failure worth refusing to boot over, but silence here would look
    // exactly like the defect this exists to fix.
    logger?.warn?.(
      `${subject} will not follow the configuration panel: the service has ` +
        'no refreshConfigFromRemote',
      { operation }
    );
    return { stop() {} };
  }

  const period = intervalMs ?? ENV.CONFIG_CACHE_TTL;

  const refresh = () =>
    Promise.resolve()
      .then(() => service.refreshConfigFromRemote())
      .catch((error) => {
        logger?.warn?.(`${subject}: configuration refresh failed`, {
          operation,
          error: String(error?.message || error),
        });
      });

  // Not awaited. Bootstrap must not block on Liferay being reachable - that
  // is the whole lesson of #1103 - and a failure here is recoverable by the
  // next tick.
  refresh();

  const timer = setInterval(refresh, period);
  // Or the process cannot exit, and every test that boots the app hangs.
  timer.unref?.();

  return {
    intervalMs: period,
    refreshNow: refresh,
    stop() {
      clearInterval(timer);
    },
  };
}

module.exports = { startConfigRefresh };
