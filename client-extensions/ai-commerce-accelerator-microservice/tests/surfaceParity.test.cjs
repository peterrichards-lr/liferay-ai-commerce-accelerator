const fs = require('fs');
const path = require('path');
const { INTERNAL_API_PATHS } = require('../utils/internalApiPaths.cjs');

/**
 * Every endpoint is reachable from somewhere, or it is exempt in writing.
 *
 * There are three ways to drive this service - the Dashboard, the
 * configuration panels and the CLI - and nothing kept them in step. A
 * capability landed on the API and whether either surface ever got it was left
 * to whoever remembered. The migration made that concrete: extract and the
 * media package could only be driven by hand-written `curl`, and the Dashboard
 * had an import button wired to nothing at all (#875, #881).
 *
 * This is the same shape as `serviceParity` and `generatorParity`: two things
 * that must agree will otherwise drift, so the build is where they are made to
 * agree. Full parity is not the claim - some endpoints belong to a container,
 * a callback or a support session rather than to an operator. The claim is
 * that a deliberate omission is a line of prose somebody had to write, and a
 * forgotten one is a failing test.
 *
 * API version prefix. The three surfaces each spell their own; this is the
 * one the router mounts under.
 */
const API_PREFIX = '/api/v1';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Endpoints no surface drives, each with the reason it does not.
 *
 * A reason that says "operational" is a decision; a reason that says "gap" is
 * an admission with an issue behind it. Both are better than silence, and the
 * test requires one or the other rather than letting an entry be added bare.
 */
const NOT_ON_ANY_SURFACE = {
  BATCH_CALLBACK:
    'Inbound. Liferay calls this when a batch completes; no operator surface should.',
  BATCH_STATUS:
    'Diagnostic. The service polls batch state itself, and a support session reads this directly.',
  CACHE_CLEANUP: 'Operational housekeeping, driven by the service and by curl.',
  CACHE_ENTRIES: 'Diagnostic. Dumps what the cache holds, for support.',
  CACHE_STATS:
    'Diagnostic. Hit rates and entry counts for the in-memory cache, useful when a run behaves as though it is reading stale data.',
  CACHE_CLEAR:
    'GAP, not a decision. Clearing the cache is the documented fix after an OAuth scope changes - scopes are fixed when a token is issued and the SDK caches for about an hour - so an operator who adds a scope must currently curl this or restart the service. Worth a surface; see #880.',
  CONFIG_CACHE:
    'The panels write these settings to Liferay object storage directly (useObjectStorage), so this microservice endpoint is a second path to the same values that no surface uses. See #824 on naming the configuration source separately.',
  CONFIG_EXCLUDE_LISTS: 'As CONFIG_CACHE: the panel writes object storage.',
  CONFIG_OAUTH: 'As CONFIG_CACHE: the panel writes object storage.',
  CONFIG_OBJECT_STORAGE: 'As CONFIG_CACHE: the panel writes object storage.',
  CONFIG_QUEUES: 'As CONFIG_CACHE: the panel writes object storage.',
  CONFIG_WS: 'As CONFIG_CACHE: the panel writes object storage.',
  HEALTH_LIVE: 'Container liveness probe. Not an operator action.',
  HEALTH_READY: 'Container readiness probe. Not an operator action.',
  HEALTH_SHUTDOWN:
    'Deliberately not a button. Stopping the service belongs to whatever supervises it.',
  JOBS: 'Internal job status, read by the queue and by support.',
  QUEUE_STATS:
    'Diagnostic. Queue depth and worker state, read when a run appears to have stalled rather than failed.',
  STATUS_OPENAI:
    'Provider probe, superseded by the health endpoints the Dashboard already shows.',
  WORKFLOW_CLEANUP:
    'Admin housekeeping with a cutoff. The surfaces offer clear-all, which is the destructive one worth a confirmation dialog.',
  WORKFLOW_SESSION_CONTEXT:
    'Diagnostic. Returns the whole run context, which is large and mostly of interest when something has gone wrong.',
  WORKFLOW_SUMMARY:
    'Diagnostic. A per-step roll-up of one run; the Dashboard already shows the same state live, and the admin screen shows it per session.',
};

/**
 * The paths a surface can actually reach.
 *
 * Resolved rather than grepped, because each surface composes its paths from
 * prefix constants: `${BASE_PATH}/config/categories` contains neither
 * `/config/categories` nor anything a substring match would find. A grep here
 * would report gaps that do not exist, and the exemption list would fill up
 * with entries excusing the test's own blindness.
 */
function resolveDeclaredPaths(source) {
  const constants = new Map();
  const declaration = /const\s+([A-Z_0-9]+)\s*=\s*(`[^`]*`|'[^']*')/g;
  let match;

  while ((match = declaration.exec(source)) !== null) {
    constants.set(match[1], match[2].slice(1, -1));
  }

  const expand = (value, depth = 0) =>
    depth > 10
      ? value
      : value.replace(/\$\{([A-Z_0-9]+)\}/g, (whole, name) =>
          constants.has(name) ? expand(constants.get(name), depth + 1) : whole
        );

  return new Set(
    [...constants.values()]
      .map((value) => expand(value))
      .filter((value) => value.startsWith(API_PREFIX))
  );
}

/** The CLI builds its URLs inline, so its paths are read as literals. */
function resolveCliPaths(source) {
  return new Set(
    [...source.matchAll(/\/api\/v1\/[a-z0-9/-]+/g)].map((found) => found[0])
  );
}

const read = (relative) =>
  fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const SURFACES = {
  cli: resolveCliPaths(read('scripts/aica-cli.cjs')),
  configuration: resolveDeclaredPaths(
    read(
      'client-extensions/ai-commerce-accelerator-configuration/src/utils/microservicePaths.js'
    )
  ),
  dashboard: resolveDeclaredPaths(
    read(
      'client-extensions/ai-commerce-accelerator-frontend/src/utils/microservicePaths.js'
    )
  ),
};

function surfacesFor(apiPath) {
  const full = `${API_PREFIX}${apiPath}`;

  return Object.entries(SURFACES)
    .filter(([name, paths]) =>
      name === 'cli'
        ? [...paths].some(
            (declared) => declared === full || full.startsWith(`${declared}/`)
          )
        : paths.has(full)
    )
    .map(([name]) => name);
}

describe('Surface parity', () => {
  it('reads paths off all three surfaces, so it cannot pass by finding nothing', () => {
    // Without this the resolvers could silently return empty sets and every
    // endpoint would look exempt-or-covered depending on which way the
    // assertion ran. The counts are floors, not targets.
    expect(SURFACES.dashboard.size).toBeGreaterThan(20);
    expect(SURFACES.configuration.size).toBeGreaterThan(15);
    expect(SURFACES.cli.size).toBeGreaterThan(5);
  });

  it.each(Object.entries(INTERNAL_API_PATHS))(
    '%s is reachable from a surface, or exempt with a reason',
    (key, apiPath) => {
      const surfaces = surfacesFor(apiPath);

      if (surfaces.length > 0) {
        expect(NOT_ON_ANY_SURFACE[key]).toBeUndefined();
        return;
      }

      const reason = NOT_ON_ANY_SURFACE[key];

      expect(
        reason,
        `${key} (${apiPath}) can be driven from no surface. Add it to the Dashboard, the configuration panels or the CLI - or add an entry to NOT_ON_ANY_SURFACE saying why an operator never needs it.`
      ).toBeTruthy();
      // A reason has to be a sentence. "n/a" is how an exemption list becomes
      // a list of things nobody looked at.
      expect(reason.length).toBeGreaterThan(30);
    }
  );

  it('has no exemption for an endpoint that is in fact reachable', () => {
    const stale = Object.keys(NOT_ON_ANY_SURFACE).filter(
      (key) =>
        INTERNAL_API_PATHS[key] && surfacesFor(INTERNAL_API_PATHS[key]).length
    );

    expect(stale).toEqual([]);
  });

  it('has no exemption for an endpoint that no longer exists', () => {
    const orphans = Object.keys(NOT_ON_ANY_SURFACE).filter(
      (key) => !INTERNAL_API_PATHS[key]
    );

    expect(orphans).toEqual([]);
  });

  it('keeps the three dataset operations on more than one surface', () => {
    // The specific failure that prompted this: a promotion between instances
    // that could only be driven by assembling multipart requests by hand.
    expect(surfacesFor(INTERNAL_API_PATHS.EXPORT_COMMERCE_BUNDLE)).toEqual(
      expect.arrayContaining(['cli', 'dashboard'])
    );
    expect(surfacesFor(INTERNAL_API_PATHS.EXTRACT_COMMERCE_BUNDLE)).toEqual(
      expect.arrayContaining(['cli', 'dashboard'])
    );
    expect(surfacesFor(INTERNAL_API_PATHS.IMPORT_COMMERCE_DATA)).toEqual(
      expect.arrayContaining(['cli', 'dashboard'])
    );
  });
});
