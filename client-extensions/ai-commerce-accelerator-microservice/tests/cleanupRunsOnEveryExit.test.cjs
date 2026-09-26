const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * A failed run must not leave its project on the node.
 *
 * `trap cleanup EXIT` sat 200 lines below the readiness wait, so every failure
 * before that point exited with no teardown: the project, its containers and
 * its database volume stayed on the node.
 *
 * That made failures contagious. A run died at readiness and left a
 * half-initialised `aica-e2e` behind; the next run attached to it instead of
 * building its own and booted in 40s rather than 231s:
 *
 *     run9  (clean)  Server startup in [230958] milliseconds -> Liferay Core is UP
 *     run11 (reused) Server startup in  [39706] milliseconds -> NoSuchCompanyException
 *
 * The second failure looked like a new defect and was the first one's
 * leftovers. Two runs were spent on it (#1122).
 *
 * These cases execute the real cleanup with its helpers stubbed, because the
 * property that matters is behavioural - does an early exit tear down - and
 * asserting line numbers would pass while the function silently stopped
 * removing anything.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');
const lines = source.split('\n');

function harness({ exitCode = 1, existing = 0, keep = 0 } = {}) {
  const start = lines.findIndex((l) => l.startsWith('cleanup() {'));
  const end = lines.findIndex((l) => l === 'trap cleanup EXIT');

  const script = [
    'set -e',
    'PROJECT_NAME=aica-e2e; LDM_Y_FLAG=-y; ORIGINAL_DB_MODE=isolated; LDM_NODE_TARGET=local',
    `EXISTING_PROJECT=${existing}; KEEP_PROJECT=${keep}`,
    'write_signal() { echo "[signal] $1"; }',
    'ldm_cmd() { echo "[ldm_cmd] $*"; }',
    'ldm() { echo "[ldm] $*"; }',
    // Declared like the others: cleanup captures the container's logs before
    // removing it, and this harness enumerates cleanup's dependencies. The
    // real one is defined above cleanup - staleProjectRemoval asserts that
    // ordering - so this stands in for it rather than excusing its absence.
    'capture_microservice_diagnostics() { echo "[capture] $*"; }',
    // Stubbed, not guarded with `command -v` in the script. Both capture
    // functions are defined (386, 498) before the trap is installed (866),
    // so they are always available when cleanup runs. `close_node_tunnel`
    // needs the guard because it is defined far below the trap; copying that
    // pattern here would make a genuine ordering mistake skip the capture
    // silently instead of failing loudly. See #1177.
    'capture_proxy_diagnostics() { echo "[capture-proxy] $*"; }',
    lines.slice(start, end + 1).join('\n'),
    'echo "[body] running"',
    `exit ${exitCode}`,
  ].join('\n');

  try {
    return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
  } catch (e) {
    return `${e.stdout || ''}${e.stderr || ''}`;
  }
}

describe('a failing run tears its project down', () => {
  it('removes the project when the run fails', () => {
    // The case that cost two runs: without this the next run inherits a
    // half-initialised database and fails for a different-looking reason.
    expect(harness({ exitCode: 1 })).toMatch(
      /\[ldm_cmd\] rm aica-e2e --delete/
    );
  });

  it('removes it when the run succeeds too', () => {
    expect(harness({ exitCode: 0 })).toMatch(
      /\[ldm_cmd\] rm aica-e2e --delete/
    );
  });

  it('reports the run as failed, not as clean', () => {
    expect(harness({ exitCode: 1 })).toMatch(/\[signal\] FAILED/);
    expect(harness({ exitCode: 0 })).toMatch(/\[signal\] SUCCESS/);
  });

  it('restores the database mode it changed', () => {
    expect(harness({ exitCode: 1 })).toMatch(/Restoring global database mode/);
  });

  it('still honours --keep and an existing project', () => {
    // Teardown must not become unconditional: --keep exists so a developer can
    // inspect a failed environment.
    expect(harness({ keep: 1 })).toMatch(/Skipping cleanup: --keep/);
    expect(harness({ existing: 1 })).toMatch(
      /Skipping cleanup for existing project/
    );
  });
});

describe('the trap is installed before anything can fail', () => {
  it('precedes the readiness wait', () => {
    // 200 lines too late was the whole defect. Ordering is asserted as well as
    // behaviour, because the behavioural cases above run cleanup directly and
    // would pass however late the trap were installed.
    const trapAt = lines.findIndex((l) => l === 'trap cleanup EXIT');
    const readinessAt = lines.findIndex((l) =>
      l.includes('Liferay failed to become ready')
    );

    expect(trapAt).toBeGreaterThan(-1);
    expect(readinessAt).toBeGreaterThan(-1);
    expect(trapAt).toBeLessThan(readinessAt);
  });

  it('is installed before anything creates a project', () => {
    // The whole property, stated once. Once the trap is installed, every
    // subsequent exit runs cleanup - so it is enough that it precedes the
    // first command that can leave something on the node.
    //
    // Exits between the trap and that point are already covered and simply
    // have nothing to tear down; my first two attempts at this case asserted
    // there were none of them, which is neither true nor what matters.
    const trapAt = lines.findIndex((l) => l === 'trap cleanup EXIT');
    const firstCreate = lines.findIndex((l) =>
      /ldm_cmd (import|"\$\{RUN_ARGS)/.test(l)
    );

    expect(trapAt).toBeGreaterThan(-1);
    expect(firstCreate).toBeGreaterThan(-1);
    expect(trapAt).toBeLessThan(firstCreate);
  });

  it('does not die inside its own trap on an early exit', () => {
    // close_node_tunnel is defined with the tunnel, far below the trap. An
    // exit before then has none to close, and an undefined function under
    // `set -e` would replace the run's real failure with "command not found".
    expect(source).toMatch(
      /command -v close_node_tunnel >\/dev\/null 2>&1 && close_node_tunnel/
    );
    expect(harness({ exitCode: 1 })).not.toMatch(/command not found/);
  });
});
