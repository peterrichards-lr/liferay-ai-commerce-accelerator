const DEFAULT_EXPIRY_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Liferay's two write paths disagree about what an omitted `neverExpire` means.
 * `ProductResourceImpl` reads it as `GetterUtil.getBoolean(..., true)`, so a
 * product that says nothing never expires. `SkuUtil` reads it as
 * `GetterUtil.get(..., false)` and, with no `expirationDate` alongside it,
 * `DateConfig.toExpirationDateConfig` hands the SKU one a month out - after
 * which Liferay's scheduled sweeper flips it to EXPIRED and it stops being
 * purchasable, under a product that still looks complete.
 *
 * So absence must resolve to "never expires" at every layer here: a missing
 * configuration entry, an unreadable one, and a configuration service that was
 * never wired up all mean the same thing. Reading absence as `false` is the
 * defect itself. See #681.
 */
function readBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  // The entry is JSON text an operator edits by hand in the configuration UI,
  // which is how a quoted boolean gets in.
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();

    if (text === 'true') {
      return true;
    }

    if (text === 'false') {
      return false;
    }
  }

  return fallback;
}

function readExpiryDays(value) {
  const days = Number(value);

  return Number.isFinite(days) && days >= 1
    ? Math.floor(days)
    : DEFAULT_EXPIRY_DAYS;
}

function normalizeCatalogExpiryConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    neverExpire: readBoolean(source.neverExpire, true),
    expiryDays: readExpiryDays(source.expiryDays),
  };
}

/**
 * Liferay writes these back as `yyyy-MM-dd'T'HH:mm:ss'Z'`, so the milliseconds
 * a JavaScript ISO string carries are noise the platform never round-trips.
 */
function toLiferayDateTime(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The `neverExpire` / `expirationDate` pair to put on a Product or Sku payload.
 * An explicit `expirationDate` is sent rather than left to Liferay because the
 * platform's own default is a fixed one month, which is not configurable.
 */
function catalogExpiryFields(raw, now = new Date()) {
  const { neverExpire, expiryDays } = normalizeCatalogExpiryConfig(raw);

  if (neverExpire) {
    return { neverExpire: true };
  }

  return {
    neverExpire: false,
    expirationDate: toLiferayDateTime(
      new Date(now.getTime() + expiryDays * MS_PER_DAY)
    ),
  };
}

async function readCatalogExpiryFields(configService, requestConfig) {
  return catalogExpiryFields(
    await configService?.getCatalogExpiryConfig?.(requestConfig)
  );
}

module.exports = {
  DEFAULT_EXPIRY_DAYS,
  catalogExpiryFields,
  normalizeCatalogExpiryConfig,
  readCatalogExpiryFields,
};
