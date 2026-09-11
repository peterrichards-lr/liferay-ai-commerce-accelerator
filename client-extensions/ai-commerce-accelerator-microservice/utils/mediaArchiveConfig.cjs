const { ENV } = require('./constants.cjs');

/**
 * How long a run stays packageable, resolved from configuration.
 *
 * The archive stopped being a recovery aid and became an input: both
 * producers stage through it and `GET /export-commerce-bundle` builds a
 * package by reading it back (#896, #898). So the retention window decides
 * whether a run can still be promoted, and that is an operational question
 * rather than a deployment one - which is why it is answerable from the
 * configuration panel and not only from an environment variable (#917).
 *
 * Resolution is config -> env -> default. A deployment that sets the variable
 * still wins where nothing is configured, and an absent entry resolves to the
 * shipped defaults rather than to zero, which would prune everything.
 */

const DEFAULTS = Object.freeze({
  maxSessions: 10,
  retain: true,
  retentionHours: 72,
});

/**
 * The entry is JSON an operator edits by hand in the configuration UI, which
 * is how a quoted boolean gets in. Same tolerance as catalogExpiry, and the
 * same reason.
 */
function readBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();

    if (text === 'true') return true;
    if (text === 'false') return false;
  }

  return fallback;
}

/**
 * A positive whole number, or the fallback.
 *
 * Zero and negatives are rejected rather than clamped: `retentionHours: 0`
 * reads as "keep nothing", and a typo that silently became "delete every
 * package source on the next run" is the kind of bound this codebase has been
 * bitten by. An operator who means it can set 1.
 */
function readCount(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
}

function normalizeMediaArchiveConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    maxSessions: readCount(
      source.maxSessions,
      ENV.MEDIA_ARCHIVE_MAX_SESSIONS ?? DEFAULTS.maxSessions
    ),
    retain: readBoolean(
      source.retain,
      ENV.MEDIA_ARCHIVE_RETAIN ?? DEFAULTS.retain
    ),
    retentionHours: readCount(
      source.retentionHours,
      ENV.MEDIA_ARCHIVE_RETENTION_HOURS ?? DEFAULTS.retentionHours
    ),
  };
}

module.exports = {
  MEDIA_ARCHIVE_DEFAULTS: DEFAULTS,
  normalizeMediaArchiveConfig,
};
