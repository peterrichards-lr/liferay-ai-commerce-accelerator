const {
  AICA_OWNED,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
  OWNERSHIP_SCOPE_CONFIRMATION,
  OWNERSHIP_SCOPE_CONFIRMATION_FIELD,
  ownershipScopeFromId,
  ownershipScopeFromRequestBody,
  resolveOwnershipScope,
} = require('../utils/ownershipScope.cjs');

describe('ownership scope (#850)', () => {
  describe('the AICA-owned default', () => {
    // The prefixes deleteCoordinatorService hardcoded before the scope
    // existed. They are the default's whole definition, so they are asserted
    // rather than assumed - including 'AICAOPT', the hyphen-less form left by
    // options built before the prefix was marked compound.
    it.each([
      'AICA-PRODUCT-1',
      'AICAOPT-COLOUR',
      'AICAOPT-CAT-SIZE',
      'PL-GENERAL-1',
      'PL-PROMO-1',
      'SEG-BUSINESS',
      'WH-LONDON',
      'PE-1',
    ])('claims %s', (erc) => {
      expect(AICA_OWNED.owns(erc)).toBe(true);
    });

    it.each(['COLOUR-BY-HAND', 'CUSTOMER-SKU-1', 'aica-lowercase', ''])(
      'does not claim %s',
      (erc) => {
        expect(AICA_OWNED.owns(erc)).toBe(false);
      }
    );

    it('does not claim an entity with no code at all', () => {
      expect(AICA_OWNED.owns(undefined)).toBe(false);
      expect(AICA_OWNED.owns(null)).toBe(false);
    });

    it('is what a caller that asks for nothing gets', () => {
      expect(resolveOwnershipScope()).toBe(AICA_OWNED);
      expect(resolveOwnershipScope(undefined)).toBe(AICA_OWNED);
      expect(resolveOwnershipScope(null)).toBe(AICA_OWNED);
    });
  });

  describe('the everything scope', () => {
    it('claims exactly what the default rejects', () => {
      const strangers = ['COLOUR-BY-HAND', 'CUSTOMER-SKU-1', '', undefined];

      for (const erc of strangers) {
        expect(AICA_OWNED.owns(erc)).toBe(false);
        expect(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.owns(erc)).toBe(
          true
        );
      }
    });

    it('is selectable by reference and only by reference', () => {
      expect(
        resolveOwnershipScope(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE)
      ).toBe(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE);
    });

    // A scope object cannot be written in JSON, so no request body, query
    // string or header can carry one. These are the shapes something arriving
    // over the wire could take, and every one of them has to be refused rather
    // than coerced into the widest possible delete.
    it('refuses every shape that could arrive over the wire', () => {
      const overTheWire = [
        true,
        'true',
        1,
        'everything',
        'EVERYTHING',
        'aica-owned',
        { id: 'everything', owns: () => true },
        ['everything'],
      ];

      for (const value of overTheWire) {
        expect(() => resolveOwnershipScope(value)).toThrow(TypeError);
      }
    });

    it('cannot be reconstructed from its own serialised form', () => {
      const overTheWire = JSON.parse(
        JSON.stringify(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE)
      );

      expect(overTheWire).not.toBe(
        EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE
      );
      expect(() => resolveOwnershipScope(overTheWire)).toThrow(TypeError);
    });

    it('cannot be tampered into the default', () => {
      expect(Object.isFrozen(AICA_OWNED)).toBe(true);
      expect(
        Object.isFrozen(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE)
      ).toBe(true);
    });
  });

  describe('what a request can ask for', () => {
    const field = OWNERSHIP_SCOPE_CONFIRMATION_FIELD;

    it('widens only for the confirmation phrase, typed exactly', () => {
      expect(
        ownershipScopeFromRequestBody({ [field]: OWNERSHIP_SCOPE_CONFIRMATION })
      ).toBe(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE);
    });

    // Everything an operator or a stray client might send that is not the
    // phrase. None of it is close enough to count: a delete that removes data
    // AICA did not create is unrecoverable, so a near miss stays narrow.
    it.each([
      undefined,
      null,
      true,
      'true',
      1,
      'yes',
      'everything',
      OWNERSHIP_SCOPE_CONFIRMATION.toLowerCase(),
      ` ${OWNERSHIP_SCOPE_CONFIRMATION}`,
      `${OWNERSHIP_SCOPE_CONFIRMATION} `,
      `${OWNERSHIP_SCOPE_CONFIRMATION}.`,
    ])('leaves the default in place for %o', (confirmation) => {
      expect(ownershipScopeFromRequestBody({ [field]: confirmation })).toBe(
        AICA_OWNED
      );
    });

    it('leaves the default in place for the fields a client might guess', () => {
      const guesses = [
        { deleteEverything: true },
        { ownershipScope: 'everything' },
        { scope: 'everything' },
        { isTotal: true },
        {},
        undefined,
      ];

      for (const body of guesses) {
        expect(ownershipScopeFromRequestBody(body)).toBe(AICA_OWNED);
      }
    });
  });

  describe('recovering a scope from a persisted session', () => {
    it('round-trips both scopes through the id a session stores', () => {
      expect(ownershipScopeFromId(AICA_OWNED.id)).toBe(AICA_OWNED);
      expect(
        ownershipScopeFromId(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id)
      ).toBe(EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE);
    });

    it('narrows to the default for anything it does not recognise', () => {
      // A context written before #850, or one that has been hand-edited, must
      // resume narrow. Widening on a value nobody wrote deliberately is the
      // failure this whole module exists to prevent.
      for (const id of [undefined, null, '', 'all', 'EVERYTHING', 42]) {
        expect(ownershipScopeFromId(id)).toBe(AICA_OWNED);
      }
    });
  });
});
