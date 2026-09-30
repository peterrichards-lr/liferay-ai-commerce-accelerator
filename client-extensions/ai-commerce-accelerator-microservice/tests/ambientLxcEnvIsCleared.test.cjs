const {
  AMBIENT_LXC_PREFIX,
  clearAmbientLxcEnv,
} = require('./fixtures/ambientLxcEnv.cjs');

/**
 * The suite must not inherit a Liferay target from the environment it runs in.
 *
 * Run 36538159793 stopped a nightly at `yarn test`, five minutes in and before
 * LDM started, because `healthCheckTargetWithoutLxc.test.cjs` asserted what
 * happens when nothing is configured while COM_LIFERAY_LXC_DXP_MAIN_DOMAIN
 * sat in the environment naming the orchestrator's target. See #1199.
 *
 * The obvious guard - "no COM_LIFERAY_LXC_* in process.env" - is green on any
 * clean workstation with or without the sweep that makes it true, so it could
 * not have caught the sweep being removed, which is the failure it exists to
 * prevent. It asserts instead that the sweep RAN, from the record setup.mjs
 * leaves behind. Deleting that call turns this red everywhere, not only on a
 * machine that happens to export one.
 */
describe('the ambient LXC environment is cleared before any test loads (#1199)', () => {
  it('records that setup.mjs swept, rather than that the result looks clean', () => {
    // On globalThis rather than process.env: a fork inherits the environment,
    // so a record kept there can be supplied by the shell. Deleting the sweep
    // AND exporting the old variable by hand left this green, which is a
    // guard that cannot fail in exactly the case it was written for (#1203).
    const swept = globalThis.__aicaAmbientLxcSweep;

    expect(swept).toBeDefined();
    expect(swept.ran).toBe(true);
    // The contents, not merely the shape. The sentinel is planted immediately
    // before the sweep, so it must be among what the sweep removed - on every
    // machine, including one with no ambient LXC variables of its own.
    expect(swept.cleared).toContain(swept.sentinel);
    expect(process.env[swept.sentinel]).toBeUndefined();
  });

  it('leaves no ambient config source behind', () => {
    const survivors = Object.keys(process.env).filter((key) =>
      AMBIENT_LXC_PREFIX.test(key)
    );

    expect(survivors).toEqual([]);
  });

  it('actually removes a variable, and hands it back', () => {
    // Or the two cases above are satisfied by a sweep that does nothing, in a
    // process where there was nothing to do - the same shape as a comment
    // stripper returning '' and passing every negative guard in the suite.
    const env = { COM_LIFERAY_LXC_DXP_MAIN_DOMAIN: 'poisoned.invalid' };

    const cleared = clearAmbientLxcEnv(env);

    expect(env.COM_LIFERAY_LXC_DXP_MAIN_DOMAIN).toBeUndefined();
    expect(cleared).toEqual({
      COM_LIFERAY_LXC_DXP_MAIN_DOMAIN: 'poisoned.invalid',
    });
  });

  it('leaves variables outside the family alone', () => {
    const env = {
      COM_LIFERAY_LXC_DXP_MAIN_DOMAIN: 'poisoned.invalid',
      LIFERAY_LXC_DXP_MAIN_DOMAIN: 'set-by-a-test.invalid',
      COM_LIFERAY_SOMETHING_ELSE: 'unrelated',
    };

    clearAmbientLxcEnv(env);

    expect(env.LIFERAY_LXC_DXP_MAIN_DOMAIN).toBe('set-by-a-test.invalid');
    expect(env.COM_LIFERAY_SOMETHING_ELSE).toBe('unrelated');
  });
});
