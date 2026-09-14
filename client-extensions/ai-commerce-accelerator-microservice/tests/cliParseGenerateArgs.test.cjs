const {
  GENERATE_OPTIONS,
  parseGenerateArgs,
} = require('../../../scripts/aica-cli.cjs');

/**
 * Unit coverage for the table-driven half of `aica generate`'s argument
 * parsing (#735), separate from `tests/cliCounts.test.cjs` (which spawns the
 * real binary to prove the whole parse-default-post path against the
 * pre-existing count flags). This exercises the generic mechanism the other
 * 35+ flags now share: a scalar, a `--no-x` boolean, a comma-separated list,
 * and an unrecognised flag - the shapes GENERATE_OPTIONS actually declares.
 */
describe('parseGenerateArgs', () => {
  it('parses a scalar string flag', () => {
    const options = parseGenerateArgs(['--brand-name', 'Acme']);
    expect(options.brandName).toBe('Acme');
  });

  it('parses a scalar integer flag', () => {
    const options = parseGenerateArgs(['--inventory-min', '3']);
    expect(options.inventoryMin).toBe(3);
  });

  it('turns on a boolean flag with its bare form', () => {
    const options = parseGenerateArgs(['--enable-backorders']);
    expect(options.enableBackorders).toBe(true);
  });

  it('turns off a boolean flag with its --no- form', () => {
    const options = parseGenerateArgs(['--no-warehouses']);
    expect(options.createWarehouses).toBe(false);
  });

  it('splits a comma-separated list flag into an array', () => {
    const options = parseGenerateArgs(['--categories', 'Shoes,Bags,Hats']);
    expect(options.categories).toEqual(['Shoes', 'Bags', 'Hats']);
  });

  it('trims whitespace and drops empty entries from a list flag', () => {
    const options = parseGenerateArgs([
      '--selected-languages',
      ' en-US ,,fr-FR',
    ]);
    expect(options.selectedLanguages).toEqual(['en-US', 'fr-FR']);
  });

  it('parses a list-of-integer flag into numbers, not numeric strings', () => {
    const options = parseGenerateArgs(['--channel-ids', '10,20,30']);
    expect(options.channelIds).toEqual([10, 20, 30]);
  });

  it('leaves options empty for a flag it does not recognise', () => {
    const options = parseGenerateArgs(['--totally-not-a-real-flag', 'value']);
    expect(options).toEqual({});
  });

  it('does not choke when an unrecognised flag is mixed with real ones', () => {
    const options = parseGenerateArgs([
      '--products',
      '4',
      '--not-a-flag',
      '--no-tier-pricing',
    ]);

    expect(options.productCount).toBe(4);
    expect(options.generateTierPricing).toBe(false);
  });

  it('accepts an alias exactly like its primary flag', () => {
    const byPrimary = parseGenerateArgs(['--channel-id', '5']);
    const byAlias = parseGenerateArgs(['--channel', '5']);

    expect(byPrimary).toEqual({ channelId: 5 });
    expect(byAlias).toEqual({ channelId: 5 });
  });

  it('parses every scalar/boolean/list entry in GENERATE_OPTIONS at least once', () => {
    // Not a duplicate of cliOptionCoverage.test.cjs - that test checks the
    // table's *keys* line up with normalize.cjs; this checks the table's
    // *rows* are each actually parseable by parseGenerateArgs, so a typo in
    // an entry's own `flag`/`type` cannot hide behind the drift test alone.
    GENERATE_OPTIONS.forEach((opt) => {
      const value =
        opt.type === 'boolean'
          ? undefined
          : opt.type === 'list'
            ? opt.listOf === 'integer'
              ? '1,2'
              : 'a,b'
            : opt.type === 'integer'
              ? String(Math.max(opt.min ?? 0, 1))
              : 'sample';

      const args =
        opt.type === 'boolean' ? [`--${opt.flag}`] : [`--${opt.flag}`, value];

      const options = parseGenerateArgs(args);
      expect(options[opt.key], `--${opt.flag} did not set ${opt.key}`).not.toBe(
        undefined
      );
    });
  });
});
