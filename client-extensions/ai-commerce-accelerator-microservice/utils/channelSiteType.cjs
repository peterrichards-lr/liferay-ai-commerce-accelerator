/**
 * Whether the account types a run will generate suit the commerce channel it
 * will generate them into.
 *
 * Liferay decides which account types a channel accepts from its commerce site
 * type: B2C takes person accounts, B2B takes business (and supplier), B2X takes
 * both. Nothing in Headless exposes that value - see #622 - so it is read from
 * the commerce-site-type OSGi module, which reports it along with whether it was
 * configured at all.
 *
 * The rule that matters is one-sided. A mismatch is only ever reported when the
 * module says the site type is CONFIGURED, because that is the only case where
 * `allowedAccountTypes` is populated and can be trusted. Everything else -
 * unset, unrecognised, module absent, call refused - warns and proceeds. An
 * unconfigured channel is the normal state for one created through the API, so
 * blocking on it would stop the ordinary demo path rather than an unusual one.
 */

/**
 * The account types AICA must be able to create for a given selection.
 * 'mixed' needs both, so a channel accepting only one of them cannot serve it.
 */
const REQUIRED_ACCOUNT_TYPES = {
  business: ['business'],
  mixed: ['business', 'person'],
  person: ['person'],
};

// Looked up through Maps rather than by key, so that a caller-supplied account
// type can never reach a plain object's prototype.
const REQUIRED_BY_ACCOUNT_TYPE = new Map(
  Object.entries(REQUIRED_ACCOUNT_TYPES)
);

const ACCOUNT_TYPE_LABELS = new Map([
  ['business', 'business'],
  ['mixed', 'mixed business and individual'],
  ['person', 'individual'],
]);

function normalizeAccountType(accountType) {
  const value = String(accountType || '')
    .trim()
    .toLowerCase();
  return REQUIRED_BY_ACCOUNT_TYPE.has(value) ? value : null;
}

/**
 * Explains an unusable site type in terms of what the operator should do about
 * it, which differs by cause: an unset site type is theirs to fix, an
 * unrecognised one is not.
 */
function unavailableReason(info) {
  const status = String(info?.siteTypeStatus || '').toUpperCase();

  if (status === 'NOT_CONFIGURED') {
    return (
      'This channel has no commerce site type set, so it cannot be checked ' +
      'against the account types being generated. Set it in Commerce → ' +
      'Channels if the run depends on B2B or B2C behaviour.'
    );
  }

  if (status === 'UNRECOGNISED') {
    return (
      `This channel reports commerce site type ${info?.siteType}, which this ` +
      'version does not recognise, so it cannot be checked against the ' +
      'account types being generated.'
    );
  }

  return (
    'The commerce site type for this channel could not be read, so it cannot ' +
    'be checked against the account types being generated. The ' +
    'commerce-site-type module may not be deployed.'
  );
}

/**
 * Judges a pairing.
 *
 * Returns `{ outcome, message }` where outcome is:
 *   'ok'    - the channel accepts everything this run will create
 *   'block' - the site type is known and cannot accept it
 *   'warn'  - nothing could be confirmed either way
 */
function evaluateChannelSiteType(accountType, info) {
  const selection = normalizeAccountType(accountType);

  if (!selection) {
    // No account generation, or a value the caller never set: nothing to judge.
    return { outcome: 'ok', message: null };
  }

  const allowed = Array.isArray(info?.allowedAccountTypes)
    ? info.allowedAccountTypes.map((t) => String(t).toLowerCase())
    : [];

  // Populated only for CONFIGURED, by the module's own contract. Treating an
  // empty list as "nothing is allowed" would block every unconfigured channel.
  if (allowed.length === 0) {
    return { outcome: 'warn', message: unavailableReason(info) };
  }

  const missing = REQUIRED_BY_ACCOUNT_TYPE.get(selection).filter(
    (required) => !allowed.includes(required)
  );

  if (missing.length === 0) {
    return { outcome: 'ok', message: null };
  }

  const label = info?.siteTypeLabel || `site type ${info?.siteType}`;

  return {
    outcome: 'block',
    message:
      `This channel is ${label}, which does not accept ` +
      `${missing.join(' or ')} accounts, but the run is set to generate ` +
      `${ACCOUNT_TYPE_LABELS.get(selection)} accounts. Choose a different ` +
      'account ' +
      'type, or a channel whose site type accepts it.',
  };
}

/**
 * Judges a whole generation run against the channel it targets.
 *
 * Two settings put account types into a channel and both are checked. Newly
 * generated accounts come from `accountType`; standalone order runs draw on
 * existing accounts narrowed by `orderAccountType`, which is left undefined
 * when any customer will do - see #611 - and is then nothing to judge.
 *
 * The strongest outcome wins: one confirmed mismatch blocks the run even if the
 * other setting is fine, because it is the one that would fail.
 */
function evaluateGenerationRun(options, info) {
  const results = [options?.accountType, options?.orderAccountType]
    .map((accountType) => evaluateChannelSiteType(accountType, info))
    .filter((result) => result.outcome !== 'ok');

  return (
    results.find((result) => result.outcome === 'block') ||
    results[0] || { outcome: 'ok', message: null }
  );
}

module.exports = {
  ACCOUNT_TYPE_LABELS,
  REQUIRED_ACCOUNT_TYPES,
  evaluateChannelSiteType,
  evaluateGenerationRun,
};
