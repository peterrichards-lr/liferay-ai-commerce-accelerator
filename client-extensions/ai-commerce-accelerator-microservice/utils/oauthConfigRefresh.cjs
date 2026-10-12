const { ENV } = require('./constants.cjs');

/**
 * Keeps the OAuth client's settings following the OAuth Configuration panel.
 *
 * The panel writes `oauth-config` straight to Liferay's object API - see
 * `persistConfigKey` in the configuration extension - so no save ever reaches
 * this process. There is no event to hook; the only way a panel edit can take
 * effect without a restart is for this side to go and look.
 *
 * The period is `CONFIG_CACHE_TTL`, because `getOAuthConfig` is cached on
 * exactly that. Refreshing faster would re-read the same cached value and
 * reach Liferay no sooner; refreshing slower would leave a window where the
 * cache had expired and the settings still had not moved. So an edit lands
 * within one TTL - six minutes by default - and the cost is one request per
 * TTL, not one per refresh.
 *
 * `refreshConfigFromRemote` swallows its own failures by design, which is
 * what makes the first call safe: at boot Liferay is often not up, and a
 * later tick picks it up once it is.
 *
 * See #1243.
 */
function startOAuthConfigRefresh(ctx, { intervalMs } = {}) {
  const { oauth, config, logger } = ctx;

  // The late wiring, in the one place that can be tested.
  //
  // OAuthService resolves the config service through `this.ctx.config`, and
  // it is constructed before `ctx.config` exists - the order cannot be
  // swapped, because ConfigService takes `oauth` (#1175). Handing it over
  // here keeps bootstrap a wiring file and puts the fix somewhere a case can
  // reach without booting the whole application.
  if (oauth?.ctx && config) oauth.ctx.config = config;

  if (!oauth?.refreshConfigFromRemote) {
    // Not a failure worth refusing to boot over, but silence here would look
    // exactly like the defect this exists to fix.
    logger?.warn?.(
      'OAuth settings will not follow the configuration panel: the service ' +
        'has no refreshConfigFromRemote',
      { operation: 'oauth-config-refresh' }
    );
    return { stop() {} };
  }

  const period = intervalMs ?? ENV.CONFIG_CACHE_TTL;

  const refresh = () =>
    Promise.resolve()
      .then(() => oauth.refreshConfigFromRemote())
      .catch((error) => {
        logger?.warn?.('OAuth configuration refresh failed', {
          operation: 'oauth-config-refresh',
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

module.exports = { startOAuthConfigRefresh };
