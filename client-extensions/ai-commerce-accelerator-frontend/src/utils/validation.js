export function getConnectionErrorsMap(cfg, targetType) {
  const errors = {};
  if (
    !cfg.microserviceUrl ||
    !/^https?:\/\/.+/.test(String(cfg.microserviceUrl))
  ) {
    (errors.microserviceUrl ??= []).push(
      'Enter a valid Microservice URL (e.g., http://localhost:3001).'
    );
  }

  // Strictly enforce required fields specifically and only when Target DXP is set to Custom Override ("remote")
  if (targetType === 'remote') {
    if (!cfg.liferayUrl || !/^https?:\/\/.+/.test(String(cfg.liferayUrl))) {
      (errors.liferayUrl ??= []).push(
        'Enter a valid Liferay URL (e.g., http://localhost:8080).'
      );
    }
    if (!cfg.clientId || String(cfg.clientId).trim().length === 0) {
      (errors.clientId ??= []).push('Client ID is required.');
    }
    if (!cfg.clientSecret || String(cfg.clientSecret).trim().length === 0) {
      (errors.clientSecret ??= []).push('Client Secret is required.');
    }
  } else {
    // Standard validation: Only check Liferay URL format if it was explicitly filled out
    if (cfg.liferayUrl && !/^https?:\/\/.+/.test(String(cfg.liferayUrl))) {
      (errors.liferayUrl ??= []).push(
        'Enter a valid Liferay URL (e.g., http://localhost:8080).'
      );
    }
  }

  if (cfg.pollingDelay < 5000)
    (errors.pollingDelay ??= []).push('Min is 5000.');
  if (cfg.pollingDelay > 600000)
    (errors.pollingDelay ??= []).push('Max is 600000.');

  if (!cfg.localeCode || String(cfg.localeCode).trim().length === 0) {
    (errors.localeCode ??= []).push('Locale code is required.');
  }

  if (!cfg.liferayHosted && targetType !== 'remote') {
    if (!cfg.clientId || String(cfg.clientId).trim().length === 0) {
      (errors.clientId ??= []).push('Client ID is required.');
    }
    if (!cfg.clientSecret || String(cfg.clientSecret).trim().length === 0) {
      (errors.clientSecret ??= []).push('Client Secret is required.');
    }
  }

  return errors;
}

/**
 * The configuration source, once the operator has said it differs.
 *
 * All three fields are required together, because an incomplete second
 * connection is the failure #824 exists to remove: a URL with no credentials
 * would either be refused by the server or, worse, reach it carrying the
 * target's credentials, which are not valid on another instance.
 */
export function getConfigurationSourceErrorsMap(cfg) {
  const errors = {};

  if (!cfg.configSourceEnabled) return errors;

  if (
    !cfg.configSourceUrl ||
    !/^https?:\/\/.+/.test(String(cfg.configSourceUrl))
  ) {
    (errors.configSourceUrl ??= []).push(
      'Enter a valid Liferay URL (e.g., http://localhost:8080).'
    );
  }

  if (
    !cfg.configSourceClientId ||
    String(cfg.configSourceClientId).trim().length === 0
  ) {
    (errors.configSourceClientId ??= []).push('Client ID is required.');
  }

  if (
    !cfg.configSourceClientSecret ||
    String(cfg.configSourceClientSecret).trim().length === 0
  ) {
    (errors.configSourceClientSecret ??= []).push('Client Secret is required.');
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

export function getGenerationErrorsMap(gc, liferayConnected = true, limits) {
  const errors = {};

  if (gc.seedPack) {
    return errors;
  }

  const maxProducts = limits?.maxProducts || 100;
  const maxAccounts = limits?.maxAccounts || 50;
  const maxOrders = limits?.maxOrders || 200;

  if (gc.productCount < 0)
    (errors.productCount ??= []).push('Cannot be negative.');
  if (gc.productCount > maxProducts)
    (errors.productCount ??= []).push(`Max is ${maxProducts}.`);

  if (gc.accountCount < 0)
    (errors.accountCount ??= []).push('Cannot be negative.');
  if (gc.accountCount > maxAccounts)
    (errors.accountCount ??= []).push(`Max is ${maxAccounts}.`);

  if (gc.orderCount < 0) (errors.orderCount ??= []).push('Cannot be negative.');
  if (gc.orderCount > maxOrders)
    (errors.orderCount ??= []).push(`Max is ${maxOrders}.`);

  // The media fields belong to the Products section, which the form does not
  // render when no products are asked for (#677). An error raised on a field
  // that is not on screen cannot be corrected, and it would leave the submit
  // button disabled with nothing to show for it - so a run that generates no
  // products is not judged on how it would have made product media.
  if (gc.productCount > 0) {
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
  }

  // Matches `sectionVisibility().categories`: the selector is on screen for
  // either count, because the names are thematic context for both.
  if (
    liferayConnected &&
    (gc.productCount > 0 || gc.accountCount > 0) &&
    (!Array.isArray(gc.categories) || gc.categories.length === 0)
  ) {
    (errors.categories ??= []).push('Pick at least one category.');
  }

  return errors;
}

export function flattenErrorsMap(map) {
  return Object.values(map).flat();
}

export const hasAnyErrors = (map) => Object.keys(map || {}).length > 0;
