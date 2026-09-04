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
    const status = channel.siteTypeStatus;

    if (status === 'NOT_CONFIGURED') {
      return {
        message:
          'This channel has no commerce site type set, so it will accept ' +
          'these accounts but may not behave as a B2B or B2C storefront. ' +
          'Set it in Commerce → Channels if the demo depends on that.',
        outcome: 'warn',
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
