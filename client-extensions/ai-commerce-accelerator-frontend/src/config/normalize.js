import { DEFAULTS } from './defaults.js';

const bool  = (v, fb=false) => (typeof v === 'boolean' ? v : String(v ?? '').toLowerCase() === 'true') ?? fb;
const num   = (v, fb=null) => (Number.isFinite(Number(v)) ? Number(v) : fb);
const str   = (v, fb='')   => (typeof v === 'string' ? v.trim() : fb);
const arr   = (v, fb=[])   => (Array.isArray(v) ? v : (typeof v === 'string' && v.trim()) ? v.split(',').map(s=>s.trim()).filter(Boolean) : fb);

export function normalizeConfig(incoming = {}) {
  const cfg = { ...DEFAULTS, ...(incoming || {}) };

  // Locale can arrive as en_US; normalize to en-US
  const normLanguageId = str(cfg.languageId || DEFAULTS.languageId);
  const normLocale = str(cfg.localeCode || DEFAULTS.localeCode).replace('_','-');

  return {
    // Hosting
    liferayHosted: bool(cfg.liferayHosted, DEFAULTS.liferayHosted),
    liferayUrl: str(cfg.liferayUrl, DEFAULTS.liferayUrl),
    microserviceUrl: str(cfg.microserviceUrl, DEFAULTS.microserviceUrl),

    // Display
    title: str(cfg.title, DEFAULTS.title),
    subtitle: str(cfg.subtitle, DEFAULTS.subtitle),

    // Context
    localeCode: normLocale,
    languageId: normLanguageId,
    currencyCode: str(cfg.currencyCode, DEFAULTS.currencyCode),
    catalogId: num(cfg.catalogId, DEFAULTS.catalogId),
    channelId: num(cfg.channelId, DEFAULTS.channelId),
    selectedLanguages: arr(cfg.selectedLanguages, DEFAULTS.selectedLanguages),

    // AI / runtime
    aiModel: str(cfg.aiModel, DEFAULTS.aiModel),
    batchSize: num(cfg.batchSize, DEFAULTS.batchSize),
    pollingDelay: num(cfg.pollingDelay, DEFAULTS.pollingDelay),

    // UI
    showProgress: bool(cfg.showProgress, DEFAULTS.showProgress),
    demoMode: bool(cfg.demoMode, DEFAULTS.demoMode),
    wsLoggingLevel: str(cfg.wsLoggingLevel, DEFAULTS.wsLoggingLevel),

    // Flags
    featureFlags: safeJson(cfg.featureFlags, DEFAULTS.featureFlags),

    // Auth (only used outside Liferay)
    clientId: str(cfg.clientId, DEFAULTS.clientId),
    clientSecret: str(cfg.clientSecret, DEFAULTS.clientSecret),
  };
}

function safeJson(v, fb) {
  if (typeof v === 'object' && v !== null) return v;
  try { return JSON.parse(v); } catch { return fb; }
}
