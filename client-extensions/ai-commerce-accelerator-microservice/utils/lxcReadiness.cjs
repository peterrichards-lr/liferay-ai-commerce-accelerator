const fs = require('fs');
const path = require('path');
const { clearCache } = require('@rotty3000/config-node');
const { ENV } = require('./constants.cjs');

// The key `tryBuildColocatedLiferayUrl` builds the Liferay URL from.
const DXP_MAIN_DOMAIN_KEY = 'com.liferay.lxc.dxp.main.domain';

/**
 * Liferay writes the DXP config tree when it learns its own address, which
 * happens the first time its main servlet is hit - after this process has
 * started. `@rotty3000/config-node` caches a *miss* deliberately, so the first
 * lookup against the not-yet-written tree resolves `undefined` for the life of
 * the process and every later request reports `Liferay URL is not configured`
 * even though the file is by then on disk. Measured: 794 such failures over 33
 * minutes, one continuous process, with the tree populated throughout. See
 * #1103.
 *
 * Size is checked, not just existence: a file that exists but is empty is the
 * tree mid-write, and treating it as ready would cache a second miss that no
 * later poll would clear.
 */
function isDxpConfigTreeReady(dir = ENV.LIFERAY_ROUTES_DXP) {
  try {
    const stats = fs.statSync(path.join(dir, DXP_MAIN_DOMAIN_KEY));
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

/**
 * Watches for the tree and clears the config cache once, when it arrives.
 *
 * Deliberately does not block or fail startup. The tree cannot exist when this
 * process starts - it is written in response to a request Liferay has not yet
 * received - so refusing to boot would be refusing a condition that is not yet
 * satisfiable, and risks deadlocking a stack whose own bring-up is what
 * eventually satisfies it.
 *
 * @returns {{stop: Function, settled: Promise<{ready: boolean, elapsedMs: number}>}|null}
 *   `null` when nothing is mounted, which is how a local run presents.
 */
function startDxpConfigTreeWatcher({
  logger,
  dir = ENV.LIFERAY_ROUTES_DXP,
  timeoutMs = ENV.LXC_CONFIG_WAIT_MS,
  intervalMs = ENV.LXC_CONFIG_POLL_MS,
  onReady,
} = {}) {
  if (!fs.existsSync(dir)) {
    logger?.debug?.(
      `No LXC config tree mounted at ${dir}; not a colocated deployment.`,
      { operation: 'lxc-config-tree-watch' }
    );
    return null;
  }

  const startedAt = Date.now();
  let timer = null;
  let settle;
  const settled = new Promise((resolve) => {
    settle = resolve;
  });

  const finish = (ready) => {
    if (timer) clearInterval(timer);
    timer = null;
    const elapsedMs = Date.now() - startedAt;

    if (ready) {
      // The hammer, used once at a defined moment rather than per lookup:
      // every provider cache is dropped so the next read sees the tree.
      clearCache();
      logger?.info?.(
        `LXC config tree became readable after ${elapsedMs}ms; configuration cache cleared.`,
        { dir, elapsedMs, operation: 'lxc-config-tree-watch' }
      );
      onReady?.({ elapsedMs });
    } else {
      logger?.warn?.(
        `LXC config tree at ${dir} was still not readable after ${elapsedMs}ms. ` +
          'Liferay writes it when its main servlet is first hit, so this means ' +
          'no request has reached Liferay yet, or it failed to publish. ' +
          'Continuing without a derived Liferay URL.',
        { dir, elapsedMs, operation: 'lxc-config-tree-watch' }
      );
    }

    settle({ ready, elapsedMs });
  };

  if (isDxpConfigTreeReady(dir)) {
    finish(true);
    return { stop: () => finish(false), settled };
  }

  timer = setInterval(() => {
    if (isDxpConfigTreeReady(dir)) finish(true);
    else if (Date.now() - startedAt >= timeoutMs) finish(false);
  }, intervalMs);

  // Never hold the process open for this.
  timer.unref?.();

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    settled,
  };
}

/**
 * Whether Liferay is a separate container that mounts config trees into this
 * one, as opposed to a local run where the microservice is a host process.
 *
 * The distinction matters because a loopback Liferay URL is correct in the
 * second case and impossible in the first: `localhost` inside this container
 * is this container. Same test #1132 uses to decide whether to watch at all,
 * named once rather than spelled out twice. See #1137.
 */
function isColocatedDeployment(dir = ENV.LIFERAY_ROUTES_DXP) {
  try {
    return fs.existsSync(dir);
  } catch {
    return false;
  }
}

module.exports = {
  DXP_MAIN_DOMAIN_KEY,
  isColocatedDeployment,
  isDxpConfigTreeReady,
  startDxpConfigTreeWatcher,
};
