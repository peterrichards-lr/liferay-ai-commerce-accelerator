/**
 * The ambient LXC configuration a test must not inherit.
 *
 * config-node's individual-env-vars provider mangles a dotted key into an
 * environment variable name: `com.liferay.lxc.dxp.main.domain` is read from
 * COM_LIFERAY_LXC_DXP_MAIN_DOMAIN. `scripts/run-e2e-ldm.sh` exports that pair
 * before the orchestrator runs `yarn test`, so inside an E2E run every
 * COM_LIFERAY_LXC_* variable is a live config source that no test set.
 *
 * A file asserting what happens when nothing is configured then asserts
 * against the orchestrator's target instead of its own, and the case it exists
 * to cover never runs. The suite has been bitten by this four times - #1124
 * through an inherited LDM_NODE_TARGET, #1158 and #1175 through this family,
 * and #1199, where it stopped a nightly at `yarn test` before LDM started.
 *
 * The first three were each fixed inside the file that failed, which left two
 * private copies of this prefix and no way for a new file to acquire it. This
 * is the one home; `tests/setup.mjs` applies it to every worker so that a file
 * has to opt out rather than remember to opt in.
 *
 * Match the family, not the names: the mangling means any COM_LIFERAY_LXC_*
 * variable is a config source, including ones nobody has exported yet.
 */
const AMBIENT_LXC_PREFIX = /^COM_LIFERAY_LXC_/;

/**
 * config-node reads config TREES as well as individual environment variables,
 * and consults the trees first. A directory holding a file named
 * `com.liferay.lxc.dxp.main.domain` is therefore a config source no less than
 * the mangled variable is, and clearing only the variables leaves it live:
 * #1199 reproduces on unmodified master through LIFERAY_ROUTES_CLIENT_EXTENSION
 * alone, with no COM_LIFERAY_LXC_* set anywhere.
 *
 * Not the live cause of that run - neither the workflow nor run-e2e-ldm.sh
 * exports these on the runner host - but the same class, and a test asserting
 * "nothing is configured" must mean it. See #1203.
 */
const AMBIENT_LXC_TREES = [
  'LIFERAY_ROUTES_CLIENT_EXTENSION',
  'LIFERAY_ROUTES_DXP',
];

/**
 * Deletes every ambient LXC variable from `env`, returning what was removed so
 * a caller scoping the change to one block can put it back.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>} the entries removed, in no order
 */
function clearAmbientLxcEnv(env = process.env) {
  const cleared = {};

  for (const key of Object.keys(env)) {
    if (AMBIENT_LXC_PREFIX.test(key) || AMBIENT_LXC_TREES.includes(key)) {
      cleared[key] = env[key];
      delete env[key];
    }
  }

  return cleared;
}

module.exports = {
  AMBIENT_LXC_PREFIX,
  AMBIENT_LXC_TREES,
  clearAmbientLxcEnv,
};
