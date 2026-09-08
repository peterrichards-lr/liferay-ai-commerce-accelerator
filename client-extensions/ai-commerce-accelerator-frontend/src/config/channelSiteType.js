/**
 * Whether a commerce channel accepts the account types a run will create.
 *
 * Mirrors `utils/channelSiteType.cjs` in the microservice, which enforces the
 * same rule at the point of generation. This copy exists so the configuration
 * UI can say what a channel accepts before a run is started rather than after
 * one is refused; the microservice remains the authority, because it is the
 * only side that reads the value from Liferay.
 *
 * Channels arrive already annotated by the `get-channels` route, which asks the
 * commerce-site-type module. A channel with no `siteTypeStatus` is one whose
 * site type could not be read, and nothing is claimed about it.
 */

const REQUIRED_ACCOUNT_TYPES = new Map([
  ['business', ['business']],
  ['mixed', ['business', 'person']],
  ['person', ['person']],
]);

/**
 * What an unset site type actually means. Mirrors `channelSiteType.cjs`.
 *
 * `siteType` comes through Liferay's `FallbackKeysSettingsUtil` and defaults
 * to "0", so it is the *effective* value; `configured` records only whether
 * anyone set it explicitly. A brand-new channel is NOT_CONFIGURED with an
 * effective type of 0 - B2C, which is what the UI shows and how Liferay
 * behaves. So "unset" is not "unknown" (#640).
 *
 * Only the default is encoded. The module supplies allowedAccountTypes for a
 * CONFIGURED type, so no numeric mapping for the other values belongs here.
 */
const DEFAULT_SITE_TYPE = '0';
const DEFAULT_SITE_TYPE_LABEL = 'B2C';
const DEFAULT_SITE_TYPE_ALLOWS = ['person'];

function isDefaultedToB2C(channel) {
  if (channel?.siteTypeStatus !== 'NOT_CONFIGURED') {
    return false;
  }

  // Absent reads as the default, since that is what the fallback produces. A
  // NOT_CONFIGURED status reporting another value contradicts the fallback,
  // and a contradiction is not something to act on.
  const effective =
    channel?.siteType === undefined || channel?.siteType === null
      ? DEFAULT_SITE_TYPE
      : String(channel.siteType);

  return effective === DEFAULT_SITE_TYPE;
}

/**
 * A short suffix for the channel dropdown: the site type when it is known,
 * a note when it is not, and nothing at all when the module did not answer.
 */
export function channelSiteTypeSuffix(channel) {
  const status = channel?.siteTypeStatus;

  if (status === 'CONFIGURED') {
    return channel.siteTypeLabel;
  }

  if (status === 'NOT_CONFIGURED') {
    return 'site type not set';
  }

  if (status === 'UNRECOGNISED') {
    return 'site type not recognised';
  }

  return null;
}

export function channelOptionLabel(channel) {
  const suffix = channelSiteTypeSuffix(channel);

  return suffix ? `${channel.name} — ${suffix}` : channel?.name;
}

/**
 * Judges an account type against the selected channel.
 *
 * Returns `{ outcome, message }` where outcome is 'ok', 'block' for a site type
 * that is known and cannot hold those accounts, or 'warn' when nothing could be
 * confirmed. Only a CONFIGURED site type populates `allowedAccountTypes`, so an
 * empty list means unreadable rather than "nothing is permitted" - a channel
 * created through the API has no site type set, and that is the ordinary case.
 */
export function evaluateAccountType(accountType, channel) {
  const selection = String(accountType || '')
    .trim()
    .toLowerCase();

  if (!REQUIRED_ACCOUNT_TYPES.has(selection) || !channel) {
    return { message: null, outcome: 'ok' };
  }

  const allowed = Array.isArray(channel.allowedAccountTypes)
    ? channel.allowedAccountTypes.map((type) => String(type).toLowerCase())
    : [];

  if (allowed.length === 0) {
    if (isDefaultedToB2C(channel)) {
      const missingByDefault = REQUIRED_ACCOUNT_TYPES.get(selection).filter(
        (required) => !DEFAULT_SITE_TYPE_ALLOWS.includes(required)
      );

      if (missingByDefault.length === 0) {
        return { message: null, outcome: 'ok' };
      }

      // Worded as a default rather than a choice: an operator told the channel
      // "is B2C" goes looking for the setting someone picked and finds none.
      return {
        message:
          `This channel has no commerce site type set, so Liferay defaults ` +
          `it to ${DEFAULT_SITE_TYPE_LABEL}, which does not accept ` +
          `${missingByDefault.join(' or ')} accounts. Set the site type in ` +
          'Commerce → Channels, or choose a different account type.',
        outcome: 'block',
      };
    }

    return { message: null, outcome: 'ok' };
  }

  const missing = REQUIRED_ACCOUNT_TYPES.get(selection).filter(
    (required) => !allowed.includes(required)
  );

  if (missing.length === 0) {
    return { message: null, outcome: 'ok' };
  }

  return {
    message:
      `The selected channel is ${channel.siteTypeLabel}, which does not ` +
      `accept ${missing.join(' or ')} accounts. Choose a different account ` +
      'type, or a channel whose site type accepts it.',
    outcome: 'block',
  };
}
