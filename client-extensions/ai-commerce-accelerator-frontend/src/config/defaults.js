export const DEFAULTS = {
  // Hosting / endpoints
  liferayHosted: false,
  liferayUrl: 'http://localhost:8080',
  microserviceUrl: 'http://localhost:3001',

  // Display
  title: 'Liferay AI Commerce Accelerator',
  subtitle:
    'Generate comprehensive Commerce data using AI and Liferay Headless APIs',

  // Locale & commerce context
  localeCode: 'en-US',
  languageId: 'en_US',
  currencyCode: 'USD',
  catalogId: null,
  channelId: null,
  selectedLanguages: [],

  // AI / runtime
  aiModel: 'gpt-4o-mini',
  batchSize: 10,
  pollingDelay: 10000,
  pollingRetries: 12,

  // UI
  showProgress: true,
  demoMode: false,
  wsLoggingLevel: 'off',

  // Feature flags
  featureFlags: { pdf: true, images: true },

  // Auth (only used when NOT hosted in Liferay)
  clientId: '',
  clientSecret: '',
};
