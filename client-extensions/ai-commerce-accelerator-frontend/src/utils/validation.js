export function getConnectionErrorsMap(cfg) {
  const errors = {};
  if (
    !cfg.microserviceUrl ||
    !/^https?:\/\/.+/.test(String(cfg.microserviceUrl))
  ) {
    (errors.microserviceUrl ??= []).push(
      'Enter a valid Microservice URL (e.g., http://localhost:3001).'
    );
  }

  if (!cfg.liferayUrl || !/^https?:\/\/.+/.test(String(cfg.liferayUrl))) {
    (errors.liferayUrl ??= []).push(
      'Enter a valid Liferay URL (e.g., http://localhost:8080).'
    );
  }

  if (cfg.pollingDelay < 5000)
    (errors.pollingDelay ??= []).push('Min is 5000.');
  if (cfg.pollingDelay > 600000)
    (errors.pollingDelay ??= []).push('Max is 600000.');

  if (!cfg.localeCode || String(cfg.localeCode).trim().length === 0) {
    (errors.localeCode ??= []).push('Locale code is required.');
  }

  if (!cfg.clientId || String(cfg.clientId).trim().length === 0) {
    (errors.clientId ??= []).push('Client ID is required.');
  }
  if (!cfg.clientSecret || String(cfg.clientSecret).trim().length === 0) {
    (errors.clientSecret ??= []).push('Client Secret is required.');
  }

  return errors;
}

export function getCommerceErrorsMap(cfg) {
  const errors = {};
  if (!cfg.catalogId) (errors.catalogId ??= []).push('Catalog is required.');
  if (!cfg.channelId) (errors.channelId ??= []).push('Channel is required.');
  if (!cfg.currencyCode)
    (errors.currencyCode ??= []).push('Currency is required.');
  if (
    !Array.isArray(cfg.selectedLanguages) ||
    cfg.selectedLanguages.length === 0
  ) {
    (errors.selectedLanguages ??= []).push('Select at least one language.');
  }
  return errors;
}

export function getGenerationErrorsMap(gc) {
  const errors = {};

  if (gc.productCount < 0)
    (errors.productCount ??= []).push('Cannot be negative.');
  if (gc.productCount > 100) (errors.productCount ??= []).push('Max is 100.');

  if (gc.accountCount < 0)
    (errors.accountCount ??= []).push('Cannot be negative.');
  if (gc.accountCount > 50) (errors.accountCount ??= []).push('Max is 50.');

  if (gc.orderCount < 0) (errors.orderCount ??= []).push('Cannot be negative.');
  if (gc.orderCount > 200) (errors.orderCount ??= []).push('Max is 200.');

  if (gc.imageMode !== 'none' && (gc.imageRatio < 0 || gc.imageRatio > 100)) {
    (errors.imageRatio ??= []).push('Must be between 0 and 100.');
  }
  if (gc.pdfMode !== 'none' && (gc.pdfRatio < 0 || gc.pdfRatio > 100)) {
    (errors.pdfRatio ??= []).push('Must be between 0 and 100.');
  }

  if (gc.imageMode === 'custom' && !gc.customImageFile) {
    (errors.customImageFile ??= []).push('Upload a custom image.');
  }
  if (gc.pdfMode === 'custom' && !gc.customPDFFile) {
    (errors.customPDFFile ??= []).push('Upload a custom PDF.');
  }

  if (
    gc.productCount > 0 &&
    (!Array.isArray(gc.categories) || gc.categories.length === 0)
  ) {
    (errors.categories ??= []).push('Pick at least one category for products.');
  }

  return errors;
}

export function flattenErrorsMap(map) {
  return Object.values(map).flat();
}

export const hasAnyErrors = (map) => Object.keys(map || {}).length > 0;
