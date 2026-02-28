import { DEFAULTS } from './defaults.js';

const bool = (v, fb = false) =>
  (typeof v === 'boolean' ? v : String(v ?? '').toLowerCase() === 'true') ?? fb;
const num = (v, fb = null) =>
  v === null || v === undefined
    ? fb
    : Number.isFinite(Number(v))
      ? Number(v)
      : fb;
const str = (v, fb = '') => (typeof v === 'string' ? v.trim() : fb);
const arr = (v, fb = []) =>
  Array.isArray(v)
    ? v
    : typeof v === 'string' && v.trim()
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : fb;

export function normalizeConfig(incoming = {}) {
  const cfg = { ...DEFAULTS, ...(incoming || {}) };

  const normLanguageId = str(cfg.languageId || DEFAULTS.languageId);
  const normLocale = str(cfg.localeCode || DEFAULTS.localeCode).replace(
    '_',
    '-'
  );
  return {
    liferayHosted: bool(cfg.liferayHosted, DEFAULTS.liferayHosted),
    microserviceUrl: str(cfg.microserviceUrl, DEFAULTS.microserviceUrl),

    title: str(cfg.title, DEFAULTS.title),
    subtitle: str(cfg.subtitle, DEFAULTS.subtitle),

    localeCode: normLocale,
    languageId: normLanguageId,
    currencyCode: str(cfg.currencyCode, DEFAULTS.currencyCode),
    catalogId: num(cfg.catalogId, DEFAULTS.catalogId),
    channelId: num(cfg.channelId, DEFAULTS.channelId),
    siteGroupId: num(cfg.siteGroupId, DEFAULTS.siteGroupId),
    selectedLanguages: arr(cfg.selectedLanguages, DEFAULTS.selectedLanguages),

    aiModel: str(cfg.aiModel, DEFAULTS.aiModel),
    batchSize: num(cfg.batchSize, DEFAULTS.batchSize),
    pollingDelay: num(cfg.pollingDelay, DEFAULTS.pollingDelay),
    pollingRetries: num(cfg.pollingRetries, DEFAULTS.pollingRetries),

    demoMode: bool(cfg.demoMode, DEFAULTS.demoMode),
    wsLoggingLevel: str(cfg.wsLoggingLevel, DEFAULTS.wsLoggingLevel),

    liferayUrl: str(cfg.liferayUrl, DEFAULTS.liferayUrl),
    clientId: str(cfg.clientId, DEFAULTS.clientId),
    clientSecret: str(cfg.clientSecret, DEFAULTS.clientSecret),
  };
}

function safeJson(v, fb) {
  if (typeof v === 'object' && v !== null) return v;
  try {
    return JSON.parse(v);
  } catch {
    return fb;
  }
}
