const {
  evaluateChannelSiteType,
  evaluateGenerationRun,
} = require('../utils/channelSiteType.cjs');

// Shaped as the commerce-site-type module reports them.
const B2C = {
  allowedAccountTypes: ['person'],
  channelId: 1,
  configured: true,
  siteType: 0,
  siteTypeLabel: 'B2C',
  siteTypeStatus: 'CONFIGURED',
};

const B2B = {
  allowedAccountTypes: ['business', 'supplier'],
  channelId: 2,
  configured: true,
  siteType: 1,
  siteTypeLabel: 'B2B',
  siteTypeStatus: 'CONFIGURED',
};

const B2X = {
  allowedAccountTypes: ['business', 'person', 'supplier'],
  channelId: 3,
  configured: true,
  siteType: 2,
  siteTypeLabel: 'B2X',
  siteTypeStatus: 'CONFIGURED',
};

// The module reports a label of 'B2C' for an unset site type, because the
// underlying value defaults to 0. The status is what distinguishes them.
const UNSET = {
  allowedAccountTypes: [],
  channelId: 4,
  configured: false,
  siteType: 0,
  siteTypeLabel: 'B2C',
  siteTypeStatus: 'NOT_CONFIGURED',
};

const UNRECOGNISED = {
  allowedAccountTypes: [],
  channelId: 5,
  configured: true,
  siteType: 9,
  siteTypeLabel: 'UNKNOWN',
  siteTypeStatus: 'UNRECOGNISED',
};

describe('channel site type', () => {
  describe('evaluateChannelSiteType', () => {
    it('accepts an account type the channel allows', () => {
      expect(evaluateChannelSiteType('person', B2C).outcome).toBe('ok');
      expect(evaluateChannelSiteType('business', B2B).outcome).toBe('ok');
    });

    it('accepts every account type on a B2X channel', () => {
      for (const accountType of ['business', 'person', 'mixed']) {
        expect(evaluateChannelSiteType(accountType, B2X).outcome).toBe('ok');
      }
    });

    it('blocks an account type the channel cannot hold', () => {
      expect(evaluateChannelSiteType('business', B2C).outcome).toBe('block');
      expect(evaluateChannelSiteType('person', B2B).outcome).toBe('block');
    });

    it('blocks mixed on a channel that takes only one of the two', () => {
      expect(evaluateChannelSiteType('mixed', B2C).outcome).toBe('block');
      expect(evaluateChannelSiteType('mixed', B2B).outcome).toBe('block');
    });

    it('names the channel and the account type in the message', () => {
      const { message } = evaluateChannelSiteType('business', B2C);

      expect(message).toContain('B2C');
      expect(message).toContain('business');
    });

    // An unset site type is not an unknown one. `siteType` comes through
    // FallbackKeysSettingsUtil and defaults to 0, so the effective value is
    // B2C and Liferay behaves that way - warning and proceeding produced
    // exactly the unusable data this check exists to prevent (#640).
    it('blocks business accounts against an unset site type, which defaults to B2C', () => {
      const { message, outcome } = evaluateChannelSiteType('business', UNSET);

      expect(outcome).toBe('block');
      // Worded as a default, not a choice: an operator told the channel "is
      // B2C" goes looking for a setting nobody made.
      expect(message).toContain('no commerce site type set');
      expect(message).toContain('defaults it to B2C');
      expect(message).toContain('business');
    });

    it('accepts person accounts against an unset site type, since B2C takes them', () => {
      expect(evaluateChannelSiteType('person', UNSET).outcome).toBe('ok');
    });

    it('blocks mixed accounts against an unset site type', () => {
      // Mixed needs business as well as person.
      expect(evaluateChannelSiteType('mixed', UNSET).outcome).toBe('block');
    });

    it('warns rather than assuming when an unset type reports a value that is not the default', () => {
      // NOT_CONFIGURED with a non-zero site type contradicts the fallback, and
      // a contradiction is not something to act on.
      const { outcome } = evaluateChannelSiteType('business', {
        ...UNSET,
        siteType: 1,
      });

      expect(outcome).toBe('warn');
    });

    it('treats an absent site type as the default it falls back to', () => {
      const { outcome } = evaluateChannelSiteType('business', {
        ...UNSET,
        siteType: undefined,
      });

      expect(outcome).toBe('block');
    });

    it('warns when the site type is not one it recognises', () => {
      const { message, outcome } = evaluateChannelSiteType(
        'business',
        UNRECOGNISED
      );

      expect(outcome).toBe('warn');
      expect(message).toContain('9');
    });

    it('warns when the module could not be reached at all', () => {
      const { message, outcome } = evaluateChannelSiteType('business', null);

      expect(outcome).toBe('warn');
      expect(message).toContain('could not be read');
    });

    it('judges nothing when no account type was chosen', () => {
      for (const accountType of [undefined, null, '', 'guest']) {
        expect(evaluateChannelSiteType(accountType, B2C).outcome).toBe('ok');
      }
    });

    it('ignores case and surrounding space', () => {
      expect(evaluateChannelSiteType('  Business ', B2B).outcome).toBe('ok');
      expect(evaluateChannelSiteType('PERSON', B2B).outcome).toBe('block');
    });

    it('treats an empty allowed list as unreadable, not as forbidding all', () => {
      const noList = { ...B2C, allowedAccountTypes: undefined };

      expect(evaluateChannelSiteType('person', noList).outcome).toBe('warn');
    });
  });

  describe('evaluateGenerationRun', () => {
    // Counts are part of the fixture, not decoration. A setting is judged only
    // when it governs work the run will do, and `routes/generate.cjs` decides
    // that on `accountCount > 0` / `orderCount > 0` - so a run asserting it is
    // blocked has to be a run that would actually create something. These
    // fixtures carried no counts before #926, which meant they described runs
    // that in production add no account steps at all.
    const WILL_GENERATE = { accountCount: 5, orderCount: 5 };

    it('checks the account type new accounts are generated with', () => {
      expect(
        evaluateGenerationRun(
          { ...WILL_GENERATE, accountType: 'business' },
          B2C
        ).outcome
      ).toBe('block');
    });

    it('checks the account type standalone order runs draw from', () => {
      const run = {
        ...WILL_GENERATE,
        accountType: 'person',
        orderAccountType: 'business',
      };

      expect(evaluateGenerationRun(run, B2C).outcome).toBe('block');
    });

    it('judges nothing when order runs accept any customer account', () => {
      const run = {
        ...WILL_GENERATE,
        accountType: 'person',
        orderAccountType: undefined,
      };

      expect(evaluateGenerationRun(run, B2C).outcome).toBe('ok');
    });

    it('prefers a block over a warning from the other setting', () => {
      // Only reachable if the two settings disagree about a partly readable
      // response; the run should still be refused rather than merely flagged.
      const partial = { ...B2C, allowedAccountTypes: ['person'] };
      const run = {
        ...WILL_GENERATE,
        accountType: 'business',
        orderAccountType: 'person',
      };

      expect(evaluateGenerationRun(run, partial).outcome).toBe('block');
    });

    it('blocks a run whose accounts an unset, B2C-defaulted channel cannot hold', () => {
      const run = {
        ...WILL_GENERATE,
        accountType: 'business',
        orderAccountType: 'person',
      };

      expect(evaluateGenerationRun(run, UNSET).outcome).toBe('block');
    });

    it('passes a run an unset, B2C-defaulted channel can hold', () => {
      const run = {
        ...WILL_GENERATE,
        accountType: 'person',
        orderAccountType: 'person',
      };

      expect(evaluateGenerationRun(run, UNSET).outcome).toBe('ok');
    });

    it('passes a run with no account settings at all', () => {
      expect(evaluateGenerationRun({}, B2B).outcome).toBe('ok');
      expect(evaluateGenerationRun(undefined, B2B).outcome).toBe('ok');
    });

    // #926. The guard judged `accountType`, which carries its default whether
    // or not it governs anything, so a run creating nothing was refused for
    // the type it would have used. Reproduced against a live 2026.q3.0 bundle.
    it('does not judge the account type when no accounts will be generated', () => {
      const run = {
        accountCount: 0,
        accountType: 'business',
        orderCount: 0,
      };

      expect(evaluateGenerationRun(run, UNSET).outcome).toBe('ok');
    });

    it('treats an absent count the same as zero, as the route does', () => {
      // `routes/generate.cjs` gates on `accountCount > 0`, and `undefined > 0`
      // is false - so an absent count adds no account steps and there is
      // nothing for the guard to judge either.
      expect(
        evaluateGenerationRun({ accountType: 'business' }, UNSET).outcome
      ).toBe('ok');
    });

    it('still judges the order account type when only orders will run', () => {
      // Orders draw on accounts that already exist, so a zero account count
      // does not make the order setting irrelevant.
      const run = {
        accountCount: 0,
        accountType: 'business',
        orderAccountType: 'business',
        orderCount: 5,
      };

      expect(evaluateGenerationRun(run, UNSET).outcome).toBe('block');
    });

    it('judges a seed pack run, which brings accounts the count does not describe', () => {
      // The pack supplies its own accounts and is not read until later in the
      // route, so its types are unknown here. Judging conservatively keeps
      // #640 rather than opening a hole under a zero count.
      const run = {
        accountCount: 0,
        accountType: 'business',
        orderCount: 0,
        seedPack: 'industrial-power-tools',
      };

      expect(evaluateGenerationRun(run, UNSET).outcome).toBe('block');
    });

    it('keeps refusing the run the guard exists for', () => {
      // #640, restated so the filter above cannot quietly swallow it: a run
      // that really does generate business accounts into a B2C-defaulted
      // channel is still blocked, with the same message.
      const run = { accountCount: 25, accountType: 'business', orderCount: 0 };
      const verdict = evaluateGenerationRun(run, UNSET);

      expect(verdict.outcome).toBe('block');
      expect(verdict.message).toContain('does not accept');
    });
  });
});
