/**
 * Deciding which catalog and channel a run is actually going to write into.
 *
 * The routes used to guard these ids only against ids that were *absent*
 * (`!config.catalogId || isNaN(config.catalogId)`). A stale id - one exported
 * from another instance, or left behind by a database reset - is neither
 * missing nor `NaN`, so it passed the guard untouched, and when the guard did
 * fire it picked `catalogs[0]` without a word. A real run's products were
 * created against whichever catalog happened to sort first, with nothing in the
 * logs saying the requested one no longer existed. See #680, and #656 for the
 * same failure on the configuration import side.
 *
 * One branch was answering two different questions:
 *
 * - *Nothing was chosen.* A convenience default is fine, provided the run says
 *   which one it filled in.
 * - *What was chosen is gone.* The caller's view of the instance is out of
 *   date. Substituting here puts an entire generated dataset somewhere nobody
 *   asked for, which is expensive to find and expensive to undo, so the run is
 *   refused instead.
 *
 * Two rules follow, and everything below is an expression of them:
 *
 * 1. A substitution happens only when nothing was chosen, and is always
 *    reported.
 * 2. A refusal happens on positive evidence that the chosen entity is absent,
 *    and on a write also when no evidence could be gathered at all. STALE is
 *    "I looked and it is not there"; UNCHECKED is "I could not look", and only
 *    the first is proof. Reading the second as permission to proceed is how a
 *    run that had already reported it could not read the channel list created
 *    five warehouses on production and then failed for the reason it had
 *    named, having never resolved the siteGroupId that only the channel record
 *    carries (#889). A read is free to continue on an unverified id; a write
 *    that cannot confirm where it is writing must not write.
 */

const {
  describeRequestFailure,
  summariseRequestFailure,
} = require('./requestFailure.cjs');

const VERIFIED = 'verified';
const DEFAULTED = 'defaulted';
const STALE = 'stale';
const UNAVAILABLE = 'unavailable';
const UNCHECKED = 'unchecked';

const CATALOG_LABEL = 'Catalog';
const CHANNEL_LABEL = 'Channel';

function isUsableId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0;
}

/**
 * Catalog names arrive as a localised map from the by-id endpoint and as a
 * plain string from the list endpoint, which flattens them. Either is worth
 * showing, and neither is worth failing over.
 */
function readName(item) {
  const name = item?.name;

  if (typeof name === 'string') return name;

  if (name && typeof name === 'object') {
    return name.en_US || Object.values(name).find(Boolean) || null;
  }

  return null;
}

function describeItem(item) {
  const name = readName(item);
  return name ? `'${name}' (id ${item.id})` : `id ${item?.id}`;
}

/**
 * Matches a requested id against a loaded list.
 *
 * `items` is `null` when the list could not be read, which is deliberately not
 * the same as an empty list: an empty list is evidence, an unreadable one is
 * not.
 */
function classifyCommerceSelection({ requestedId, items }) {
  const requested = isUsableId(requestedId);
  const id = requested ? Number(requestedId) : null;

  if (!Array.isArray(items)) {
    return { id, item: null, outcome: UNCHECKED };
  }

  if (requested) {
    const match = items.find((candidate) => Number(candidate?.id) === id);

    return match
      ? { id: Number(match.id), item: match, outcome: VERIFIED }
      : { id, item: null, outcome: STALE };
  }

  if (items.length === 0) {
    return { id: null, item: null, outcome: UNAVAILABLE };
  }

  return { id: Number(items[0].id), item: items[0], outcome: DEFAULTED };
}

/**
 * What the run should say about a resolution, and how loudly.
 *
 * Every outcome produces a line, including the ordinary one: the point of the
 * exercise is that the run's output names the catalog and channel it used, so
 * a misdirected run is visible without a database query.
 */
function describeCommerceSelection({
  candidateCount = 0,
  failure = null,
  id,
  item,
  label,
  outcome,
  writes = false,
}) {
  const subject = label.toLowerCase();

  switch (outcome) {
    case DEFAULTED:
      return {
        level: 'info',
        message: `No ${subject} was requested. Defaulting to ${describeItem(
          item
        )}${candidateCount > 1 ? `, the first of ${candidateCount}` : ''}.`,
      };

    case STALE:
      return {
        level: 'error',
        message: `${label} id ${id} does not exist on this instance. Refusing the run rather than generating into a different ${subject} - choose one that exists and try again.`,
      };

    case UNAVAILABLE:
      return {
        level: 'warn',
        message: `No ${subject} was requested and this instance has no ${subject} to fall back to.`,
      };

    case UNCHECKED: {
      // The reason is part of the message rather than only the log, because
      // the operator who has to act on it is reading the refusal, not the log
      // (#890). "HTTP 403" names a scope; "could not be read" names nothing.
      const because = failure
        ? `the ${subject} list could not be read (${failure})`
        : `the ${subject} list could not be read`;

      if (!writes) {
        return {
          level: 'warn',
          message: id
            ? `${label} id ${id} could not be checked because ${because}. It will be used as supplied.`
            : `No ${subject} was requested and ${because}, so none could be resolved.`,
        };
      }

      return {
        level: 'error',
        message: id
          ? `${label} id ${id} could not be checked because ${because}. Refusing the run rather than writing to a ${subject} this run cannot confirm - restore access and try again.`
          : `No ${subject} was requested and ${because}, so none could be resolved. Refusing the run rather than writing to an unknown ${subject}.`,
      };
    }

    default:
      return {
        level: 'info',
        message: `${label} ${describeItem(item)} confirmed.`,
      };
  }
}

/**
 * The list, or the reason there is no list.
 *
 * The failure is returned as well as logged because the run has to say why it
 * is refusing, and `err.message` on a Liferay request failure is the
 * operation's display name - "Get Channels Bulk" - which carries no status, no
 * path and no response body (#890).
 */
async function loadListOrFailure({ label, load, logger, logContext }) {
  try {
    const items = await load();
    return { failure: null, items: Array.isArray(items) ? items : null };
  } catch (err) {
    logger?.error?.(
      `Failed to read the ${label.toLowerCase()} list from Liferay`,
      { ...logContext, ...describeRequestFailure(err), error: err.message }
    );

    return { failure: summariseRequestFailure(err), items: null };
  }
}

/**
 * A second opinion before refusing.
 *
 * The list endpoints return a single page, so absence from the list is strong
 * evidence but not proof. A by-id read settles it, and only a positive answer
 * counts - an error here is not evidence of presence.
 *
 * It is asked for an unreadable list too. A list read can fail for reasons a
 * single record read does not share - paging, a filter, a timeout on a large
 * collection - so the cheap direct question is worth putting before a refusal
 * rather than after it (#889).
 */
async function confirmById({ id, load }) {
  if (typeof load !== 'function' || !isUsableId(id)) return null;

  try {
    const item = await load(id);
    return item && isUsableId(item.id) ? item : null;
  } catch (_err) {
    return null;
  }
}

async function resolveSelection({
  label,
  loadById,
  loadList,
  logContext,
  logger,
  requestedId,
  writes = false,
}) {
  const { failure, items } = await loadListOrFailure({
    label,
    load: loadList,
    logger,
    logContext,
  });
  let result = classifyCommerceSelection({ items, requestedId });

  if (result.outcome === STALE || result.outcome === UNCHECKED) {
    const confirmed = await confirmById({ id: result.id, load: loadById });

    if (confirmed) {
      result = {
        id: Number(confirmed.id),
        item: confirmed,
        outcome: VERIFIED,
      };
    }
  }

  const { level, message } = describeCommerceSelection({
    ...result,
    candidateCount: items?.length ?? 0,
    failure,
    label,
    writes,
  });

  return {
    ...result,
    failure,
    label,
    level,
    message,
    name: readName(result.item),
  };
}

/**
 * Writes the resolved ids back onto the config.
 *
 * `siteGroupId` is taken from the channel record rather than trusted from the
 * request. A supplied `siteGroupId` that disagrees with the channel's own is
 * the same class of staleness as the ids themselves - #656 found an import
 * carrying the *previous* channel's `siteGroupId` - and unlike a catalog
 * fallback this is not a guess: the channel says which site it belongs to. It
 * is corrected, and the correction is reported.
 */
function applyCommerceSelection({ catalog, channel, config, logs }) {
  if (isUsableId(catalog?.id)) {
    config.catalogId = catalog.id;
  }

  if (isUsableId(channel?.id)) {
    config.channelId = channel.id;
  }

  const channelSiteGroupId = Number(channel?.item?.siteGroupId);

  if (!isUsableId(channelSiteGroupId)) return;

  if (!isUsableId(config.siteGroupId)) {
    config.siteGroupId = channelSiteGroupId;
    return;
  }

  if (Number(config.siteGroupId) !== channelSiteGroupId) {
    logs.push({
      level: 'warn',
      message: `Requested siteGroupId ${config.siteGroupId} is not the site of channel ${channel.id}. Using the channel's own siteGroupId ${channelSiteGroupId}.`,
    });
    config.siteGroupId = channelSiteGroupId;
  }
}

/**
 * Resolves the catalog and channel a run will use, and reports what it decided.
 *
 * Mutates `config` with the resolved ids. Returns the lines the caller should
 * log, a `rejection` message when the run must not start, and a `summary` the
 * caller can hand back to the user so the run's output names its own targets.
 */
async function resolveRunCommerceSelection({
  config,
  correlationId,
  liferayService,
  logger,
  operation,
  writes = false,
}) {
  const logContext = { correlationId, operation };

  const [channel, catalog] = await Promise.all([
    resolveSelection({
      label: CHANNEL_LABEL,
      loadById: (id) =>
        liferayService?.client?.headlessCommerceAdminChannel?.v1_0?.getChannel?.(
          config,
          id
        ),
      loadList: () => liferayService.getChannels(config),
      logContext,
      logger,
      requestedId: config?.channelId,
      writes,
    }),
    resolveSelection({
      label: CATALOG_LABEL,
      loadById: (id) => liferayService?.getCatalog?.(config, id),
      loadList: () => liferayService.getCatalogs(config),
      logContext,
      logger,
      requestedId: config?.catalogId,
      writes,
    }),
  ]);

  const logs = [channel, catalog].map(({ level, message }) => ({
    level,
    message,
  }));

  // A read may proceed on an id it could not verify - the worst it can do is
  // return nothing. A write may not: `applyCommerceSelection` takes
  // `siteGroupId` from the channel record, so an unverified channel is also a
  // missing site, and the run would discover that only after its first writes
  // had landed (#889).
  const blocking = writes ? [STALE, UNCHECKED] : [STALE];

  const rejections = [channel, catalog]
    .filter(({ outcome }) => blocking.includes(outcome))
    .map(({ message }) => message);

  if (rejections.length === 0) {
    applyCommerceSelection({ catalog, channel, config, logs });
  }

  return {
    catalog,
    channel,
    logs,
    rejection: rejections.length > 0 ? rejections.join(' ') : null,
    rejections,
    summary: {
      catalogId: config.catalogId ?? null,
      catalogName: catalog.name,
      channelId: config.channelId ?? null,
      channelName: channel.name,
      siteGroupId: config.siteGroupId ?? null,
    },
  };
}

/**
 * Emits the resolution to the log, so the decision is on the record whether or
 * not the caller reads the response.
 */
function logCommerceSelection({ correlationId, logs, logger, operation }) {
  logs.forEach(({ level, message }) => {
    const emit =
      (level === 'error' && logger?.error) ||
      (level === 'warn' && logger?.warn) ||
      logger?.info;

    emit?.call(logger, message, { correlationId, operation });
  });
}

module.exports = {
  CATALOG_LABEL,
  CHANNEL_LABEL,
  DEFAULTED,
  STALE,
  UNAVAILABLE,
  UNCHECKED,
  VERIFIED,
  applyCommerceSelection,
  classifyCommerceSelection,
  describeCommerceSelection,
  logCommerceSelection,
  resolveRunCommerceSelection,
};
