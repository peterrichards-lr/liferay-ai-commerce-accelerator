/**
 * The node the stack under test runs on, or null when it runs on this machine.
 *
 * run-e2e-ldm.sh exports LDM_NODE_TARGET for `--node`, and the workflow sets
 * E2E_TARGET_NODE; either may be `local`, which is not remote.
 */
export function remoteTargetNode() {
  const node = process.env.LDM_NODE_TARGET || process.env.E2E_TARGET_NODE || '';
  return node && node !== 'local' ? node : null;
}

// The CLI runs on this machine and calls the microservice on its loopback,
// which is empty when the stack is on a node. Skipped, not failed, so the
// suite's result says something about the stack. #1389; coverage is #1405.
export const CLI_NEEDS_LOCAL_STACK =
  'The CLI calls the microservice on localhost:3001, which is empty when the stack runs on a remote node. See #1389 and #1405.';
