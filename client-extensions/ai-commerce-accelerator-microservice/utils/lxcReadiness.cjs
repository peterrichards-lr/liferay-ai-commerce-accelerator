const fs = require('fs');
const path = require('path');
const { clearCache } = require('@rotty3000/config-node');
const { ENV } = require('./constants.cjs');

// The keys `tryBuildColocatedLiferayUrl` builds the Liferay URL from.
const DXP_MAIN_DOMAIN_KEY = 'com.liferay.lxc.dxp.main.domain';
const DXP_SERVER_PROTOCOL_KEY = 'com.liferay.lxc.dxp.server.protocol';

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
 * What the Liferay URL is built from, as one comparable string, or `null`
 * while the domain is absent or mid-write. An unreadable protocol is part of
 * the value rather than a reason to report nothing: it is still a change
 * worth reacting to when it appears.
 */
function readDxpAddress(dir) {
  const read = (key) => {
    try {
      // The mounted tree and one of two fixed key names; never request input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return fs.readFileSync(path.join(dir, key), 'utf8').trim();
    } catch {
      return '';
    }
  };

  const domain = read(DXP_MAIN_DOMAIN_KEY);
  if (!domain) return null;

  return `${read(DXP_SERVER_PROTOCOL_KEY)}://${domain}`;
}

/**
 * Watches for the tree, clears the config cache when it arrives, and again
 * every time the address in it changes.
 *
 * Liferay does not write the tree once. Its first write records the address
 * of whichever request reached it first - on a proxied project that is the
 * container port, `aica-e2e.demo:8080` - and it rewrites the tree once
 * requests arrive through the proxy. Clearing the cache only on arrival kept
 * the first value for the life of the process: every Liferay call went to
 * `https://aica-e2e.demo:8080`, which the node does not publish, the health
 * check failed, and Traefik dropped the extension's router. See #1373.
 *
 * Deliberately does not block or fail startup. The tree cannot exist when this
 * process starts - it is written in response to a request Liferay has not yet
 * received - so refusing to boot would be refusing a condition that is not yet
 * satisfiable, and risks deadlocking a stack whose own bring-up is what
 * eventually satisfies it.
 *
 * @returns {{stop: Function, settled: Promise<{ready: boolean, elapsedMs: number}>}|null}
 *   `null` when nothing is mounted, which is how a local run presents.
 *   `settled` resolves once, on arrival or timeout; following rewrites goes on
 *   after it until `stop`.
 */
function startDxpConfigTreeWatcher({
  logger,
  dir = ENV.LIFERAY_ROUTES_DXP,
  timeoutMs = ENV.LXC_CONFIG_WAIT_MS,
  intervalMs = ENV.LXC_CONFIG_POLL_MS,
  onReady,
  onChange,
} = {}) {
  warnIfPathIsAGuess(logger);

  if (!fs.existsSync(dir)) {
    logger?.debug?.(
      `No LXC config tree mounted at ${dir}; not a colocated deployment.`,
      { operation: 'lxc-config-tree-watch' }
    );
    return null;
  }

  const startedAt = Date.now();
  let timer = null;
  let address = null;
  let settle;
  const settled = new Promise((resolve) => {
    settle = resolve;
  });

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  // Never hold the process open for this.
  const every = (tick) => {
    stop();
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
  };

  const follow = () => {
    const current = readDxpAddress(dir);

    // Mid-write, or removed and not yet rewritten: keep what is cached rather
    // than clear it towards nothing.
    if (current === null || current === address) return;

    const previous = address;
    address = current;
    clearCache();
    logger?.info?.(
      `LXC config tree rewritten: ${previous} -> ${current}; configuration cache cleared.`,
      { dir, previous, current, operation: 'lxc-config-tree-watch' }
    );
    onChange?.({ previous, current });
  };

  const finish = (ready) => {
    const elapsedMs = Date.now() - startedAt;

    if (ready) {
      address = readDxpAddress(dir);
      // The hammer, used at defined moments rather than per lookup: every
      // provider cache is dropped so the next read sees the tree.
      clearCache();
      logger?.info?.(
        `LXC config tree became readable after ${elapsedMs}ms; configuration cache cleared.`,
        { dir, elapsedMs, address, operation: 'lxc-config-tree-watch' }
      );
      onReady?.({ elapsedMs });
      every(follow);
    } else {
      stop();
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
  } else {
    every(() => {
      if (isDxpConfigTreeReady(dir)) finish(true);
      else if (Date.now() - startedAt >= timeoutMs) finish(false);
    });
  }

  return { stop, settled };
}

/**
 * Makes the SDK's OAuth service resolve Liferay's address again.
 *
 * Clearing config-node is not enough on its own. `OAuthService.liferayUrl`
 * keeps its first successful resolution, and `tokenEndpoint` is derived from
 * it, so after a rewrite every token and config request still went to the
 * first address: 3,268 calls to `https://aica-e2e.demo:8080` after the watcher
 * had logged the rewrite and cleared the cache. Both accessors re-resolve when
 * set back to `undefined`. See #1373.
 */
function forgetResolvedLiferayUrl(oauthService) {
  if (!oauthService) return;
  oauthService.liferayUrl = undefined;
  oauthService.tokenEndpoint = undefined;
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
/**
 * Whether the DXP tree path came from the environment or from our guess.
 *
 * `LIFERAY_ROUTES_DXP` is set by the `liferay/node-runner` base image, and LDM
 * is moving where it points: the mount is being raised to `routes` and the
 * variable lowered to `routes/default/dxp`, so the extension resolves the leaf
 * on each read instead of the mount pinning it at container-create time.
 *
 * That makes our default dangerous rather than merely unused. If the variable
 * were ever missing or misspelled we would silently fall back to the old
 * convention, find nothing there, and it would look exactly like the upstream
 * change not working - a wrong answer wearing the clothes of a right one.
 *
 * So the fallback stays, because a local run legitimately has no such
 * variable, but it says so once. See #1137, liferay-docker-manager#1944.
 */
let announcedGuess = false;

function warnIfPathIsAGuess(logger) {
  if (announcedGuess) return;
  if (process.env.LIFERAY_ROUTES_DXP) return;

  announcedGuess = true;

  logger?.warn?.(
    `LIFERAY_ROUTES_DXP is not set; assuming ${ENV.LIFERAY_ROUTES_DXP} by the ` +
      'LXC convention. Expected on a local run. In a container it means the ' +
      'path is a guess, and a tree that never appears there is this, not a ' +
      'missing tree.',
    { operation: 'lxc-config-tree-watch' }
  );
}

function isColocatedDeployment(dir = ENV.LIFERAY_ROUTES_DXP) {
  try {
    return fs.existsSync(dir);
  } catch {
    return false;
  }
}

module.exports = {
  DXP_MAIN_DOMAIN_KEY,
  DXP_SERVER_PROTOCOL_KEY,
  forgetResolvedLiferayUrl,
  warnIfPathIsAGuess,
  isColocatedDeployment,
  isDxpConfigTreeReady,
  readDxpAddress,
  startDxpConfigTreeWatcher,
};
