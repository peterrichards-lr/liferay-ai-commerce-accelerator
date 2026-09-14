const fs = require('fs');
const path = require('path');
const {
  GENERATE_OPTIONS,
  WITHHELD_GENERATE_KEYS,
} = require('../../../scripts/aica-cli.cjs');

/**
 * Keeps the CLI's generate flags from drifting away from what the
 * microservice actually accepts - the failure mode #735 was filed over.
 *
 * `handleGenerate` used to build its payload by hand, 22 keys, while
 * `buildConfigAndOptions` here destructured 57 off `req.body`. Nothing
 * connected the two, so the gap grew one unreviewed field at a time until 35
 * of them were reachable from no flag at all - including `accountType`,
 * which a channel with no commerce site type set explicitly tells the
 * operator to change, in a tool that could not express the change.
 *
 * This does not hardcode the 57 - a copied list would drift exactly the same
 * way the CLI itself did. It reads `buildConfigAndOptions`'s own destructure
 * out of its source, so a field added there without a matching CLI flag or a
 * stated reason to withhold it fails this test immediately, rather than
 * waiting for someone to notice the gap by hand again.
 */
const NORMALIZE_PATH = path.resolve(__dirname, '..', 'utils', 'normalize.cjs');

function destructuredRequestBodyKeys() {
  const source = fs.readFileSync(NORMALIZE_PATH, 'utf8');
  const match = source.match(
    /function buildConfigAndOptions\(req\) \{\s*const \{([\s\S]*?)\}\s*=\s*req\.body \|\| \{\};/
  );

  if (!match) {
    throw new Error(
      'Could not find the buildConfigAndOptions destructure in normalize.cjs - ' +
        'has its shape changed? Update the regex above rather than skip this test.'
    );
  }

  return match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

describe('CLI generate option coverage (#735)', () => {
  const requestBodyKeys = destructuredRequestBodyKeys();

  it('reads a real destructure, so it cannot pass by finding nothing', () => {
    // A regex that stopped matching would return an empty array, and every
    // assertion below would pass vacuously. 57 was the count when this test
    // was written; the floor only needs to rule out "found nothing".
    expect(requestBodyKeys.length).toBeGreaterThan(50);
  });

  it('accounts for every buildConfigAndOptions input as a CLI flag or a stated withhold', () => {
    const flagged = new Set(GENERATE_OPTIONS.map((opt) => opt.key));
    const withheld = new Set(Object.keys(WITHHELD_GENERATE_KEYS));

    const unaccounted = requestBodyKeys.filter(
      (key) => !flagged.has(key) && !withheld.has(key)
    );

    expect(unaccounted).toEqual([]);
  });

  it('has no flag or withhold for a key normalize.cjs no longer accepts', () => {
    const requestBodySet = new Set(requestBodyKeys);
    const stale = [
      ...GENERATE_OPTIONS.map((opt) => opt.key),
      ...Object.keys(WITHHELD_GENERATE_KEYS),
    ].filter((key) => !requestBodySet.has(key));

    expect(stale).toEqual([]);
  });

  it('never withholds a key it also flags, or vice versa', () => {
    const flagged = new Set(GENERATE_OPTIONS.map((opt) => opt.key));
    const overlap = Object.keys(WITHHELD_GENERATE_KEYS).filter((key) =>
      flagged.has(key)
    );

    expect(overlap).toEqual([]);
  });

  it('gives every withheld key a real reason, not a placeholder', () => {
    Object.entries(WITHHELD_GENERATE_KEYS).forEach(([key, reason]) => {
      expect(typeof reason, `${key}'s reason`).toBe('string');
      expect(
        reason.length,
        `${key}'s reason is too short to be one`
      ).toBeGreaterThan(30);
    });
  });

  it('gives every flag a unique key and a usable flag name', () => {
    const keys = GENERATE_OPTIONS.map((opt) => opt.key);
    expect(new Set(keys).size).toBe(keys.length);

    GENERATE_OPTIONS.forEach((opt) => {
      expect(typeof opt.flag, `${opt.key}'s flag`).toBe('string');
      expect(opt.flag.length).toBeGreaterThan(0);
      expect(['string', 'integer', 'boolean', 'list']).toContain(opt.type);
    });
  });
});
