const {
  eligibleOrderAccounts,
  noEligibleAccountsMessage,
} = require('../utils/accountTypes.cjs');
const {
  AICA_OWNED,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
} = require('../utils/ownershipScope.cjs');
const { buildConfigAndOptions } = require('../utils/normalize.cjs');

/**
 * "AICA-only entity selection" - the third clause of #824's title, and §3 of
 * the issue.
 *
 * Selection has only ever asked what kind of account, never whose, so a run
 * placed orders against every matching account already on the instance. The
 * predicate needed nothing new: `AICA_OWNED` was extracted out of the delete
 * coordinator's `isAICAOwned` in #850 and is taken here by reference, which is
 * what stops a request body widening a run.
 */
const ACCOUNTS = [
  { id: 1, type: 'business', externalReferenceCode: 'AICA-ACC-001' },
  { id: 2, type: 'person', externalReferenceCode: 'AICA-ACC-002' },
  { id: 3, type: 'business', externalReferenceCode: 'ACME-LEGACY-1' },
  { id: 4, type: 'person', externalReferenceCode: 'CRM-IMPORT-9' },
];

const ids = (list) => list.map((account) => account.id);

describe('AICA-owned entity selection (#824 §3)', () => {
  it('draws from everything on the instance by default', () => {
    // Unchanged behaviour, deliberately: narrowing is opt-in, because a
    // selection filter that defaults narrow empties the pool for every run
    // that came before it.
    expect(ids(eligibleOrderAccounts(ACCOUNTS, 'any'))).toEqual([1, 2, 3, 4]);
  });

  it('keeps only what AICA created when the narrow scope is chosen', () => {
    expect(ids(eligibleOrderAccounts(ACCOUNTS, 'any', AICA_OWNED))).toEqual([
      1, 2,
    ]);
  });

  it('applies the account type and the ownership scope together', () => {
    expect(
      ids(eligibleOrderAccounts(ACCOUNTS, 'business', AICA_OWNED))
    ).toEqual([1]);
  });

  it('matches the compound prefixes the delete side already knows', () => {
    const mangled = [
      { id: 10, type: 'business', externalReferenceCode: 'AICAOPT-1' },
      { id: 11, type: 'business', externalReferenceCode: 'SEG-1' },
      { id: 12, type: 'business', externalReferenceCode: 'OTHER-1' },
    ];

    expect(ids(eligibleOrderAccounts(mangled, 'any', AICA_OWNED))).toEqual([
      10, 11,
    ]);
  });

  it('excludes an account with no external reference code from the narrow scope', () => {
    const anonymous = [{ id: 20, type: 'business' }];

    expect(eligibleOrderAccounts(anonymous, 'any', AICA_OWNED)).toEqual([]);
    expect(
      ids(
        eligibleOrderAccounts(
          anonymous,
          'any',
          EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE
        )
      )
    ).toEqual([20]);
  });

  it('refuses a scope expressed as a string rather than coercing one', () => {
    expect(() => eligibleOrderAccounts(ACCOUNTS, 'any', 'aica-owned')).toThrow(
      /must be one of the scope objects/i
    );
    expect(() => eligibleOrderAccounts(ACCOUNTS, 'any', true)).toThrow(
      /must be one of the scope objects/i
    );
  });

  it('says the ownership filter was what emptied the pool', () => {
    const message = noEligibleAccountsMessage(
      'business',
      [{ id: 3, type: 'business', externalReferenceCode: 'ACME-LEGACY-1' }],
      AICA_OWNED
    );

    // Without this the message reads "no business accounts are available" on
    // an instance holding plenty - the exact shape of silent substitution #824
    // is about, told about a filter instead of a default.
    expect(message).toMatch(/restricted to AICA-owned data/i);
    expect(message).toContain('of type: business');
  });

  it('says nothing about ownership when the scope did not narrow anything', () => {
    const message = noEligibleAccountsMessage('business', []);

    expect(message).not.toMatch(/AICA-owned/i);
  });
});

describe('the opt-in reaching a run (#824 §3)', () => {
  const buildOptions = (body) =>
    buildConfigAndOptions({
      body: {
        liferayUrl: 'http://localhost:8080',
        clientId: 'id',
        clientSecret: 'secret',
        ...body,
      },
      headers: { host: 'localhost:3001' },
      correlationId: 'test',
      app: { locals: {} },
    }).options;

  it('is off when the request does not ask for it', () => {
    expect(buildOptions({}).aicaOwnedEntitiesOnly).toBe(false);
  });

  it('is on for the boolean and for the multipart string', () => {
    expect(
      buildOptions({ aicaOwnedEntitiesOnly: true }).aicaOwnedEntitiesOnly
    ).toBe(true);

    expect(
      buildOptions({ aicaOwnedEntitiesOnly: 'true' }).aicaOwnedEntitiesOnly
    ).toBe(true);
  });

  it('cannot be turned on by a value nobody meant as one', () => {
    for (const value of ['maybe', 'everything', 2, {}]) {
      expect(
        buildOptions({ aicaOwnedEntitiesOnly: value }).aicaOwnedEntitiesOnly
      ).toBe(false);
    }
  });
});
