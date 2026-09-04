const {
  ANY,
  CUSTOMER_ACCOUNT_TYPES,
  accountTypesForSelection,
  eligibleOrderAccounts,
  noEligibleAccountsMessage,
} = require('../utils/accountTypes.cjs');

const ACCOUNTS = [
  { id: 1, type: 'business' },
  { id: 2, type: 'person' },
  { id: 3, type: 'guest' },
  { id: 4, type: 'supplier' },
];

const ids = (list) => list.map((a) => a.id);

describe('account types', () => {
  describe('accountTypesForSelection', () => {
    it('narrows to a single type when one is named', () => {
      expect(accountTypesForSelection('business')).toEqual(['business']);
      expect(accountTypesForSelection('person')).toEqual(['person']);
    });

    it.each([ANY, 'mixed', '', undefined, 'nonsense'])(
      'treats %s as either kind of customer',
      (selection) => {
        expect(accountTypesForSelection(selection)).toEqual(
          CUSTOMER_ACCOUNT_TYPES
        );
      }
    );

    it('is case insensitive', () => {
      expect(accountTypesForSelection('BUSINESS')).toEqual(['business']);
    });
  });

  describe('eligibleOrderAccounts', () => {
    it('never returns guest or supplier accounts', () => {
      // guest is anonymous checkout; a supplier sells to the business rather
      // than buying from it. Neither should ever own a generated order.
      for (const selection of [ANY, 'business', 'person', 'mixed']) {
        const picked = eligibleOrderAccounts(ACCOUNTS, selection);
        expect(picked.map((a) => a.type)).not.toContain('guest');
        expect(picked.map((a) => a.type)).not.toContain('supplier');
      }
    });

    it('returns both customer types when any will do', () => {
      expect(ids(eligibleOrderAccounts(ACCOUNTS, ANY))).toEqual([1, 2]);
    });

    it('narrows to the requested type', () => {
      expect(ids(eligibleOrderAccounts(ACCOUNTS, 'business'))).toEqual([1]);
      expect(ids(eligibleOrderAccounts(ACCOUNTS, 'person'))).toEqual([2]);
    });

    it('keeps an untyped account when any customer will do', () => {
      // The type may simply not have been returned; dropping it would empty
      // the pool for datasets that generated orders fine before.
      const withUntyped = [...ACCOUNTS, { id: 5 }];
      expect(ids(eligibleOrderAccounts(withUntyped, ANY))).toContain(5);
    });

    it('excludes an untyped account when a specific type is required', () => {
      const withUntyped = [...ACCOUNTS, { id: 5 }];
      expect(ids(eligibleOrderAccounts(withUntyped, 'business'))).toEqual([1]);
    });

    it('handles an empty list', () => {
      expect(eligibleOrderAccounts([], 'business')).toEqual([]);
      expect(eligibleOrderAccounts(undefined, 'business')).toEqual([]);
    });
  });

  describe('noEligibleAccountsMessage', () => {
    it('names what was wanted and what was actually there', () => {
      const message = noEligibleAccountsMessage('business', [
        { type: 'person' },
        { type: 'guest' },
      ]);
      expect(message).toMatch(/No business accounts/);
      expect(message).toMatch(/guest, person/);
    });

    it('says so when nothing reported a type', () => {
      expect(noEligibleAccountsMessage('person', [{ id: 1 }])).toMatch(
        /none reporting a type/
      );
    });
  });
});
