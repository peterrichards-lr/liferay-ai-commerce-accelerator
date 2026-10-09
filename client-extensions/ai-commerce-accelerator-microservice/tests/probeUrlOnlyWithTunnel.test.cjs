const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * `--probe-url` belongs to the tunnel, not to every run.
 *
 * #1088 added it because a REMOTE stack is reached through a forwarded port,
 * so the address LDM derives points at the node rather than the tunnel. It was
 * applied unconditionally, which broke local runs where there is no tunnel and
 * the derivation was right.
 *
 * The packaging job is a local run. From 21 September it probed
 * `http://<project>.demo` instead — the activation page on an unactivated DXP
 * (#805), which can never satisfy the probe. Release v3.3.54 burned the full
 * 30-minute timeout against a Liferay that had finished initialising nine
 * seconds in, and no `.ldmp` has been produced since 3 September. See #1257.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

/** Evaluate the real block with the outside world stubbed. */
function probeArgsFor(nodeTarget) {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const start = source.indexOf('PROBE_URL_ARGS=()');
  const end = source.indexOf('\nfi\n', start) + 4;

  expect(start).toBeGreaterThan(-1);

  const block = source.slice(start, end);
  const script = [
    'set -u',
    `LDM_NODE_TARGET="${nodeTarget}"`,
    'TARGET_URL=http://aica-e2e.demo',
    // An LDM that DOES support the flag, so a false negative cannot come from
    // the capability probe rather than from the gate under test.
    'ldm() { echo "  --probe-url  Probe this URL"; }',
    block,
    'echo "ARGS:${PROBE_URL_ARGS[*]:-}"',
  ].join('\n');

  const out = execFileSync('bash', ['-c', script], { encoding: 'utf8' });

  return out
    .split('\n')
    .find((l) => l.startsWith('ARGS:'))
    .slice(5);
}

describe('--probe-url is passed only when a tunnel justifies it (#1257)', () => {
  it('passes nothing when there is no node target', () => {
    // The packaging job. Liferay is reached directly; LDM's own derivation is
    // correct and pointing it at the portal is what broke the release.
    expect(probeArgsFor('')).toBe('');
  });

  it("passes nothing for an explicit 'local' target", () => {
    expect(probeArgsFor('local')).toBe('');
  });

  it('passes it for a remote node, where the tunnel makes it necessary', () => {
    // #1088's actual case must keep working — this is not a revert.
    expect(probeArgsFor('aws-1')).toBe('--probe-url http://aica-e2e.demo');
  });

  it('uses the same notion of "is there a tunnel" as open_node_tunnel', () => {
    // Two different answers to that question would drift apart, and the
    // symptom would be a 30-minute timeout rather than an error.
    // Stripped, because this reads the guard out of the script as text. The
    // same condition is quoted in a comment a few lines above it, and an
    // unstripped read would find that one and pass with the code deleted.
    // See #1172.
    const source = withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));
    const fn = source.slice(source.indexOf('open_node_tunnel() {'));
    const guard =
      '[ -n "${LDM_NODE_TARGET:-}" ] && [ "$LDM_NODE_TARGET" != "local" ]';

    expect(fn.slice(0, 400)).toContain(guard);
    expect(
      source.slice(
        source.indexOf('PROBE_URL_ARGS=()'),
        source.indexOf('PROBE_URL_ARGS=()') + 200
      )
    ).toContain(guard);
  });
});
