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

/**
 * What an unset site type actually means.
 *
 * `CommerceSiteTypeResource` separates two things: `siteType` is read through
 * `FallbackKeysSettingsUtil` and defaults to "0", so it is the **effective**
 * value Liferay will use; `configured` records only whether anyone set it
 * explicitly. A brand-new channel is therefore NOT_CONFIGURED with an
 * effective site type of 0 - and 0 is B2C, which is what the UI shows and how
 * Liferay behaves.
 *
 * So "unset" is not "unknown". Warning and proceeding let business accounts be
 * generated into a channel that behaves as B2C, producing exactly the unusable
 * data this check exists to prevent (#640).
 *
 * Only the default is encoded here. The module supplies `allowedAccountTypes`
 * for a CONFIGURED type, so no numeric mapping for the other values belongs in
 * this repo - and an unset type can only ever be the default one.
 */
const DEFAULT_SITE_TYPE = '0';
const DEFAULT_SITE_TYPE_LABEL = 'B2C';
const DEFAULT_SITE_TYPE_ALLOWS = ['person'];

function isDefaultedToB2C(info) {
  if (String(info?.siteTypeStatus || '').toUpperCase() !== 'NOT_CONFIGURED') {
    return false;
  }

  // Absent reads as the default, since that is what the fallback produces. A
  // NOT_CONFIGURED status reporting some *other* value contradicts the
  // fallback, and a contradiction is not something to act on.
  const effective =
    info?.siteType === undefined || info?.siteType === null
      ? DEFAULT_SITE_TYPE
      : String(info.siteType);

  return effective === DEFAULT_SITE_TYPE;
}

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
    if (isDefaultedToB2C(info)) {
      const missingByDefault = REQUIRED_BY_ACCOUNT_TYPE.get(selection).filter(
        (required) => !DEFAULT_SITE_TYPE_ALLOWS.includes(required)
      );

      if (missingByDefault.length === 0) {
        return { outcome: 'ok', message: null };
      }

      // Worded as a default rather than a choice: an operator told the channel
      // "is B2C" goes looking for the setting someone picked and finds
      // nothing. What they need to know is that nobody picked one.
      return {
        outcome: 'block',
        message:
          `This channel has no commerce site type set, so Liferay defaults it ` +
          `to ${DEFAULT_SITE_TYPE_LABEL}, which does not accept ` +
          `${missingByDefault.join(' or ')} accounts - and the run is set to ` +
          `generate ${ACCOUNT_TYPE_LABELS.get(selection)} accounts. Set the ` +
          'site type in Commerce → Channels, or choose a different account ' +
          'type.',
      };
    }

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
