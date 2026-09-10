/**
 * Which entities a run is allowed to act on.
 *
 * The predicate lived inside deleteCoordinatorService as a hardcoded
 * `isAICAOwned`, so every delete run was scoped to AICA's own prefixes and
 * there was no way to ask for anything else. That is the right default and was
 * the wrong only-option: a scratch environment being reset, or a catalogue
 * imported by other means, could not be cleared at all. See #850.
 *
 * It lives here rather than in the delete coordinator because the same choice
 * applies in the other direction to capture (#849): reading an existing
 * instance is only worth having if it can see a catalogue nobody generated.
 * One notion of scope shared by both, rather than each growing its own flag.
 *
 * A scope is a frozen object, not a string or a boolean, and that is the whole
 * safety property. Deleting everything on an instance holding restored
 * production data is unrecoverable, so widening the scope has to be an act, not
 * an accident:
 *
 *   - `resolveOwnershipScope` accepts the exported objects by reference and
 *     nothing else. No JSON body, query string or header can express one, so
 *     no request can widen a run by carrying an unexpected field.
 *   - The one HTTP route in, `ownershipScopeFromRequestBody`, requires an
 *     exact confirmation phrase typed out in full. A stray `true`, `"true"`,
 *     `1` or `"everything"` leaves the default in place rather than widening.
 *   - `EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE` is deliberately
 *     unwieldy: a call site that selects it says what it is doing.
 */

/**
 * HARDENING: Match explicit AICA prefix OR stable generated prefixes.
 *
 * Options and option categories built before the prefix was marked compound
 * lost the hyphen from 'AICA-OPT' and 'AICA-OPT-CAT', so they read as
 * 'AICAOPT...' and no crawl could see them. They were therefore never deleted
 * and accumulated on every run. The mangled form is matched so the records
 * already in an instance can be removed.
 */
const AICA_OWNED_ERC_PREFIXES = Object.freeze([
  'AICA-',
  'AICAOPT',
  'PL-GENERAL',
  'PL-PROMO',
  'SEG-',
  'WH-',
  'PE-',
]);

/**
 * The default, and the only scope any existing caller gets. An entity counts
 * as AICA's only if its external reference code says so.
 */
const AICA_OWNED = Object.freeze({
  id: 'aica-owned',
  label: 'AICA-owned data only',
  owns(erc) {
    if (!erc) return false;
    return AICA_OWNED_ERC_PREFIXES.some((prefix) => erc.startsWith(prefix));
  },
});

/**
 * Everything the crawl can see, whoever created it. Never a default, never
 * reachable by a truthy value, and named at length so no call site selects it
 * without meaning to.
 */
const EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE = Object.freeze({
  id: 'everything',
  label: 'everything, including data AICA did not create',
  owns() {
    return true;
  },
});

const SCOPES_BY_ID = new Map([
  [AICA_OWNED.id, AICA_OWNED],
  [
    EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE.id,
    EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
  ],
]);

/**
 * The exact words an operator has to type to widen a run past AICA's own data.
 * Phrased for both delete and capture so #849 does not need a second field.
 */
const OWNERSHIP_SCOPE_CONFIRMATION = 'INCLUDE DATA AICA DID NOT CREATE';

/** The single body field either route reads to choose a scope. */
const OWNERSHIP_SCOPE_CONFIRMATION_FIELD = 'ownershipScopeConfirmation';

/**
 * Normalise a caller-supplied scope.
 *
 * Absent means the default. A scope object is taken by identity. Anything else
 * throws rather than being coerced: a value that reached here from JSON is a
 * value nobody meant as a scope, and quietly picking one for it is how an
 * unrecoverable delete happens.
 */
function resolveOwnershipScope(scope) {
  if (scope === undefined || scope === null) return AICA_OWNED;

  if (
    scope === AICA_OWNED ||
    scope === EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE
  ) {
    return scope;
  }

  throw new TypeError(
    'ownershipScope must be one of the scope objects exported by utils/ownershipScope.cjs. ' +
      'Strings and booleans are rejected so that no request body can widen a run (#850).'
  );
}

/**
 * Recover a scope from a persisted session context.
 *
 * A scope object cannot survive the round trip through the session store, so
 * runs record `scope.id` and read it back here. An unrecognised id narrows to
 * the default: a corrupt or hand-edited context must not be able to widen the
 * run it is resumed into.
 */
function ownershipScopeFromId(id) {
  return SCOPES_BY_ID.get(id) || AICA_OWNED;
}

/**
 * The only path from an HTTP request to a scope.
 *
 * Requires the confirmation phrase, exactly, as a string. Every other value -
 * including `true`, `'true'`, `1`, `'everything'` and a lower-cased phrase -
 * yields the default, because a request that did not type the words out did
 * not ask for this.
 */
function ownershipScopeFromRequestBody(body) {
  // Spelled out rather than indexed by the constant so the one field a request
  // can use to widen a run is greppable in the source.
  const confirmation = body?.ownershipScopeConfirmation;

  return confirmation === OWNERSHIP_SCOPE_CONFIRMATION
    ? EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE
    : AICA_OWNED;
}

module.exports = {
  AICA_OWNED,
  AICA_OWNED_ERC_PREFIXES,
  EVERYTHING_INCLUDING_DATA_AICA_DID_NOT_CREATE,
  OWNERSHIP_SCOPE_CONFIRMATION,
  OWNERSHIP_SCOPE_CONFIRMATION_FIELD,
  ownershipScopeFromId,
  ownershipScopeFromRequestBody,
  resolveOwnershipScope,
};
