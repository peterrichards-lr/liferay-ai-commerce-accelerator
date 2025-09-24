export const DEFAULTS = {
  // Hosting / endpoints
  liferayHosted: false,
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
  siteGroupId: null,
  selectedLanguages: [],

  // AI / runtime
  aiModel: 'gpt-4o-mini',
  batchSize: 10,
  pollingDelay: 10000,
  pollingRetries: 12,

  // Misc
  demoMode: false,
  wsLoggingLevel: 'off',

  // Only used when NOT hosted in Liferay
  clientId: '',
  clientSecret: '',
  liferayUrl: 'http://localhost:8080',
};
