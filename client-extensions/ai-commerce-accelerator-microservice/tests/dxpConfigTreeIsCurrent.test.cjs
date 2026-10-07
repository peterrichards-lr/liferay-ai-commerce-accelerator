const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The portal's own notion of its domain must match the host the suite uses.
 *
 * `ldm rm --delete` does not remove the project directory on the NODE — it
 * drops containers, schema and registry entry, then rmtree's the LOCAL path.
 * So `routes/default/dxp` survives every run, and Liferay does not rewrite the
 * four `com.liferay.lxc.dxp.*` values once they exist. Ours was dated 23
 * September and said `localhost`, so every OAuth user-agent application was
 * registered with redirect URIs at `http://localhost/o/oauth2/redirect` and no
 * browser on the real host could complete a handshake. Twelve specs failed on
 * elements that never render. See #1252.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

const raw = () => fs.readFileSync(SCRIPT, 'utf8');
const script = () => withoutHashComments(raw());

function extract(name) {
  const source = raw();
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);

  expect(start).toBeGreaterThan(-1);

  return source.slice(start, end + 3);
}

/** Run one of the script's functions with its outside world stubbed. */
function run(name, preamble) {
  return execFileSync(
    'bash',
    ['-c', `set -u\n${preamble}\n${extract(name)}\n${name}\necho "exit=$?"`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

describe('the stale DXP tree is removed before the build (#1252)', () => {
  it('removes it, scoped to this project, on the node', () => {
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        // Fails on purpose, and echoes its argv to stderr: the function now
        // CAPTURES stderr rather than discarding it, so the failure path is
        // where the command it built becomes visible. On success nothing is
        // printed, which is correct and makes success untestable this way.
        'ssh() { echo "SSH-ARGS: $*" >&2; return 1; }',
      ].join('\n')
    );

    // The exact remote path, and nothing broader. $HOME stays unexpanded
    // locally so the node resolves its own.
    expect(out).toMatch(
      /rm -rf "\$HOME\/\.liferay-docker\/projects\/aica-e2e\/routes\/default\/dxp"/
    );
    expect(out).toContain('exit=0');
  });

  it('builds no rm -rf path from an empty project name', () => {
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=""',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "SSH-ARGS: $*"; return 0; }',
      ].join('\n')
    );

    expect(out).not.toContain('SSH-ARGS');
    expect(out).toContain('exit=0');
  });

  it('does nothing at all for a local target', () => {
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=local',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "SSH-ARGS: $*"; return 0; }',
      ].join('\n')
    );

    expect(out).not.toContain('SSH-ARGS');
  });

  it('says WHY it failed, not merely that it did', () => {
    // Run 37624820282: the removal failed and the warning said only that it
    // had, because the ssh call sent stderr to /dev/null. A diagnostic
    // reporting a failure without reporting the failure — the family this
    // repository keeps producing, written into the fix for an instance of it.
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "Permission denied (publickey)." >&2; return 255; }',
      ].join('\n')
    );

    expect(out).toContain('Permission denied (publickey).');
    expect(out).toContain('255');
    expect(out).toContain('user@10.0.0.1');
    expect(out).toContain('exit=0');
  });

  it('distinguishes a silent failure from a reported one', () => {
    // An ssh that fails with nothing on stderr must not produce a warning that
    // looks like it carries a reason when it does not.
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { return 1; }',
      ].join('\n')
    );

    expect(out).toContain('no output on stderr');
  });

  it('runs AFTER the project is synced to the node', () => {
    // Before `ldm import` is too early: import syncs the project to the node,
    // so a removal before it is undone by whatever import restores. That was
    // wrong in the first version regardless of the ssh failure.
    const source = script();
    const imp = source.indexOf('ldm_cmd import .');
    const remove = source.indexOf('    remove_stale_node_dxp_tree\n');

    expect(imp).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(imp);
  });

  it('runs before the stack is built, not after', () => {
    const source = script();
    const remove = source.indexOf('remove_stale_node_dxp_tree\n');
    const run_ = source.indexOf('Starting Liferay container with tag');

    expect(remove).toBeGreaterThan(-1);
    expect(remove).toBeLessThan(run_);
  });
});

describe('a mismatched domain is named, not left to twelve timeouts (#1252)', () => {
  const check = (dockerStub) =>
    run(
      'assert_dxp_domain_matches_host',
      ['TARGET_HOST=aica-e2e.demo', 'PROJECT_NAME=aica-e2e', dockerStub].join(
        '\n'
      )
    );

  it('passes quietly when the tree matches the host', () => {
    const out = check('docker() { echo "aica-e2e.demo"; }');

    expect(out).toMatch(/matching the suite's host/);
    expect(out).not.toContain('::warning::');
  });

  it('names the mismatch, the cause and the issue', () => {
    const out = check('docker() { echo "localhost"; }');

    expect(out).toContain('::warning::');
    expect(out).toContain('localhost');
    expect(out).toContain('aica-e2e.demo');
    expect(out).toContain('#1252');
  });

  it('distinguishes unreadable from mismatched', () => {
    // An empty read is not a wrong domain, and reporting it as one would be
    // the conflation this repository keeps producing.
    const out = check('docker() { echo ""; }');

    expect(out).toMatch(/Could not read/);
    expect(out).not.toContain('::warning::DXP config tree says');
  });

  it('cannot fail the run, whatever it finds', () => {
    // #1238: a diagnostic must not become a second way for the run to die.
    for (const stub of [
      'docker() { echo "aica-e2e.demo"; }',
      'docker() { echo "localhost"; }',
      'docker() { echo ""; }',
      'docker() { return 1; }',
    ]) {
      expect(check(stub)).toContain('exit=0');
    }
  });
});
