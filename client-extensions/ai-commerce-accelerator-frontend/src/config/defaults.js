// The name Auto-Create Channel applies when the operator has named nothing.
// It is AICA's choice rather than theirs, so every use of it is reported at
// the moment it is applied - the create route will not supply it (#745), and
// asking for a name belongs to the create dialog in #746.
export const DEFAULT_CHANNEL_NAME = 'AI Commerce Storefront';

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
