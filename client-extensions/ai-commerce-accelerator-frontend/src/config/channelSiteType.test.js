import { describe, expect, it } from 'vitest';
import {
  channelOptionLabel,
  channelSiteTypeSuffix,
  defaultAccountTypeFor,
  evaluateAccountType,
} from './channelSiteType';

const B2C = {
  allowedAccountTypes: ['person'],
  id: 1,
  name: 'Storefront',
  siteTypeLabel: 'B2C',
  siteTypeStatus: 'CONFIGURED',
};

const B2B = {
  allowedAccountTypes: ['business', 'supplier'],
  id: 2,
  name: 'Wholesale',
  siteTypeLabel: 'B2B',
  siteTypeStatus: 'CONFIGURED',
};

const B2X = {
  allowedAccountTypes: ['business', 'person', 'supplier'],
  id: 3,
  name: 'Both',
  siteTypeLabel: 'B2X',
  siteTypeStatus: 'CONFIGURED',
};

// An unset site type still reports a label, because the underlying value
// defaults to 0. Only the status separates it from a real B2C channel.
const UNSET = {
  allowedAccountTypes: [],
  id: 4,
  name: 'New Channel',
  siteTypeLabel: 'B2C',
  siteTypeStatus: 'NOT_CONFIGURED',
};

// What a channel looks like when the module is not deployed at all.
const UNANNOTATED = { id: 5, name: 'Plain' };

describe('channelSiteTypeSuffix', () => {
  it('shows the site type when it is set', () => {
    expect(channelSiteTypeSuffix(B2B)).toBe('B2B');
  });

  it('says so when it is not set', () => {
    expect(channelSiteTypeSuffix(UNSET)).toBe('site type not set');
  });

  it('claims nothing when the channel was not annotated', () => {
    expect(channelSiteTypeSuffix(UNANNOTATED)).toBeNull();
  });
});

describe('channelOptionLabel', () => {
  it('appends the site type to the channel name', () => {
    expect(channelOptionLabel(B2C)).toBe('Storefront — B2C');
  });

  it('leaves an unannotated channel showing just its name', () => {
    expect(channelOptionLabel(UNANNOTATED)).toBe('Plain');
  });
});

describe('evaluateAccountType', () => {
  it('passes an account type the channel accepts', () => {
    expect(evaluateAccountType('person', B2C).outcome).toBe('ok');
    expect(evaluateAccountType('mixed', B2X).outcome).toBe('ok');
  });

  it('flags an account type the channel cannot hold', () => {
    expect(evaluateAccountType('business', B2C).outcome).toBe('block');
    expect(evaluateAccountType('mixed', B2B).outcome).toBe('block');
  });

  it('names the site type and the account type in the message', () => {
    const { message } = evaluateAccountType('person', B2B);

    expect(message).toContain('B2B');
    expect(message).toContain('person');
  });

  // An unset site type is not unknown: siteType comes through Liferay's
  // fallback and defaults to 0, so the effective type is B2C and Liferay
  // behaves that way. Warning and proceeding produced exactly the unusable
  // data this check exists to prevent (#640).
  it('flags business accounts against an unset site type, which defaults to B2C', () => {
    const { message, outcome } = evaluateAccountType('business', UNSET);

    expect(outcome).toBe('block');
    // Worded as a default, not a choice.
    expect(message).toContain('no commerce site type set');
    expect(message).toContain('defaults it to B2C');
    expect(message).toContain('business');
  });

  it('accepts person accounts against an unset site type, since B2C takes them', () => {
    expect(evaluateAccountType('person', UNSET).outcome).toBe('ok');
  });

  it('flags mixed accounts against an unset site type', () => {
    expect(evaluateAccountType('mixed', UNSET).outcome).toBe('block');
  });

  it('says nothing when an unset type reports a value that is not the default', () => {
    // A contradiction is not something to act on.
    expect(
      evaluateAccountType('business', { ...UNSET, siteType: 1 }).outcome
    ).toBe('ok');
  });

  it('treats an absent site type as the default it falls back to', () => {
    expect(
      evaluateAccountType('business', { ...UNSET, siteType: undefined }).outcome
    ).toBe('block');
  });

  it('says nothing when no channel is selected', () => {
    expect(evaluateAccountType('business', undefined).outcome).toBe('ok');
  });

  it('says nothing when the channel was not annotated', () => {
    expect(evaluateAccountType('business', UNANNOTATED).outcome).toBe('ok');
  });
});

describe('defaultAccountTypeFor', () => {
  // The app defaulted to 'business' whatever the channel, and an unconfigured
  // channel defaults to B2C — so the form opened on a pair the microservice
  // refuses. The default has to come from the channel (#640).
  it('gives person for a channel with no site type set, which Liferay treats as B2C', () => {
    expect(defaultAccountTypeFor({ siteTypeStatus: 'NOT_CONFIGURED' })).toBe(
      'person'
    );
  });

  it('gives business for a B2B channel', () => {
    expect(
      defaultAccountTypeFor({
        siteTypeStatus: 'CONFIGURED',
        allowedAccountTypes: ['business'],
      })
    ).toBe('business');
  });

  it('gives person for a B2C channel', () => {
    expect(
      defaultAccountTypeFor({
        siteTypeStatus: 'CONFIGURED',
        allowedAccountTypes: ['person'],
      })
    ).toBe('person');
  });

  it('gives mixed for a channel that holds both', () => {
    expect(
      defaultAccountTypeFor({
        siteTypeStatus: 'CONFIGURED',
        allowedAccountTypes: ['business', 'person'],
      })
    ).toBe('mixed');
  });

  // Nothing is claimed about an unreadable site type anywhere else in this
  // module, and guessing here would replace a deliberate choice with a coin
  // toss.
  it('proposes nothing when the site type could not be read', () => {
    expect(
      defaultAccountTypeFor({ siteTypeStatus: 'UNRECOGNISED' })
    ).toBeNull();
    expect(defaultAccountTypeFor({})).toBeNull();
    expect(defaultAccountTypeFor(null)).toBeNull();
  });

  // Whatever it proposes must survive the check that runs next to it.
  it.each([
    [{ siteTypeStatus: 'NOT_CONFIGURED' }],
    [{ siteTypeStatus: 'CONFIGURED', allowedAccountTypes: ['business'] }],
    [{ siteTypeStatus: 'CONFIGURED', allowedAccountTypes: ['person'] }],
    [
      {
        siteTypeStatus: 'CONFIGURED',
        allowedAccountTypes: ['business', 'person'],
      },
    ],
  ])('proposes an account type the same channel accepts: %j', (channel) => {
    const proposed = defaultAccountTypeFor(channel);

    expect(evaluateAccountType(proposed, channel).outcome).toBe('ok');
  });
});
