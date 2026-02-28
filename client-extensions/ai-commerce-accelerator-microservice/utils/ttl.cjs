const HOUR = (h) => h * 60 * 60 * 1000;
const MIN = (m) => m * 60 * 1000;
const SEC = (s) => s * 1000;

function clamp(ms, { min = MIN(5), max = MIN(120) } = {}) {
  return Math.max(min, Math.min(ms, max));
}

function getEffectivePolling(configService, runtime = {}) {
  const json = configService?.getBatchPollingConfigCached?.() || {};

  const jsonInterval = Number(json.pollInterval);
  const jsonAttempts = Number(json.maxPollAttempts);

  const rtInterval = Number(runtime.pollingDelay);
  const rtAttempts = Number(runtime.pollingRetries);

  const interval = Number.isFinite(jsonInterval)
    ? jsonInterval
    : Number.isFinite(rtInterval)
      ? rtInterval
      : 5000;

  const attempts = Number.isFinite(jsonAttempts)
    ? jsonAttempts
    : Number.isFinite(rtAttempts)
      ? rtAttempts
      : 120;

  const safeInterval = Math.max(1000, Math.min(interval, MIN(10)));
  const safeAttempts = Math.max(1, Math.min(attempts, 1000));

  return { interval: safeInterval, attempts: safeAttempts };
}

function getPollingWindowMs(configService, runtime = {}) {
  const { interval, attempts } = getEffectivePolling(configService, runtime);
  return interval * attempts;
}

function getCacheJson(configService) {
  return configService?.getCacheConfigCached?.() || {};
}

function getBatchCacheTTLms(configService, runtime = {}) {
  const base = getPollingWindowMs(configService, runtime);
  const cacheCfg = getCacheJson(configService);
  const override = Number(cacheCfg.defaultBatchTTL);
  const raw = Number.isFinite(override) ? override : base * 3;
  const finalTTL = Math.max(MIN(30), raw);
  const { logger } = require('./logger.cjs');
  logger.debug('Calculated Batch Cache TTL', {
    baseMs: base,
    overrideMs: override,
    rawMs: raw,
    finalTTLMs: finalTTL,
  });
  return finalTTL;
}

function getSessionTTLms(configService, runtime = {}) {
  const cacheCfg = getCacheJson(configService);
  const jsonMs = Number(cacheCfg.sessionTTL);
  if (Number.isFinite(jsonMs)) {
    return clamp(jsonMs, { min: MIN(10), max: MIN(240) });
  }
  const rtMin = Number(runtime.sessionTtlMinutes);
  const minutes = Number.isFinite(rtMin) ? rtMin : 30;
  return clamp(MIN(minutes), { min: MIN(10), max: MIN(240) });
}

function getEphemeralTTLms(configService, runtime = {}) {
  const cacheCfg = getCacheJson(configService);
  const jsonMs = Number(cacheCfg.ephemeralTTL);
  if (Number.isFinite(jsonMs)) {
    return clamp(jsonMs, { min: MIN(1), max: MIN(30) });
  }
  const rtMin = Number(runtime.ephemeralTtlMinutes);
  const minutes = Number.isFinite(rtMin) ? rtMin : 5;
  return clamp(MIN(minutes), { min: MIN(1), max: MIN(30) });
}

function getUploadTTLms(configService, runtime = {}) {
  const cacheCfg = getCacheJson(configService);
  const jsonMs = Number(cacheCfg.uploadTTL);
  if (Number.isFinite(jsonMs)) {
    return clamp(jsonMs, { min: MIN(5), max: MIN(60) });
  }
  const rtMin = Number(runtime.uploadTtlMinutes);
  const minutes = Number.isFinite(rtMin) ? rtMin : 15;
  return clamp(MIN(minutes), { min: MIN(5), max: MIN(60) });
}

function getLongLivedTTLms(configService, runtime = {}) {
  const cacheCfg = getCacheJson(configService);
  const jsonMs = Number(cacheCfg.ercConfigTTL);
  if (Number.isFinite(jsonMs)) {
    return clamp(jsonMs, { min: MIN(15), max: MIN(180) });
  }
  const rtMin = Number(runtime.ercConfigTtlMinutes);
  const minutes = Number.isFinite(rtMin) ? rtMin : 60;
  return clamp(MIN(minutes), { min: MIN(15), max: MIN(180) });
}

module.exports = {
  HOUR,
  MIN,
  SEC,
  getBatchCacheTTLms,
  getSessionTTLms,
  getEphemeralTTLms,
  getUploadTTLms,
  getLongLivedTTLms,
};
