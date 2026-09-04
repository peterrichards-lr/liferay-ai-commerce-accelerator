import { describe, expect, it } from 'vitest';
import {
  channelOptionLabel,
  channelSiteTypeSuffix,
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

  it('warns rather than flags when the site type is unset', () => {
    // Decisive: UNSET reports the label 'B2C', so trusting the label over the
    // status would flag every business run against a freshly created channel.
    const { message, outcome } = evaluateAccountType('business', UNSET);

    expect(outcome).toBe('warn');
    expect(message).toContain('no commerce site type set');
  });

  it('says nothing when no channel is selected', () => {
    expect(evaluateAccountType('business', undefined).outcome).toBe('ok');
  });

  it('says nothing when the channel was not annotated', () => {
    expect(evaluateAccountType('business', UNANNOTATED).outcome).toBe('ok');
  });
});
