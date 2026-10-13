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

/**
 * Run one of the script's functions with its outside world stubbed.
 *
 * `set -e` as well as `set -u`, because `run-e2e-ldm.sh` sets it on line 4 and
 * a harness that omits it cannot catch the failure mode it most needs to.
 * This harness ran with `set -u` alone and passed a version of
 * `remove_stale_node_dxp_tree` that ABORTED THE RUN: a bare `err="$(cmd)"`
 * whose command fails exits the script under errexit, so run 37632331741 died
 * at the removal and went straight to cleanup. Eleven green tests said nothing
 * about it. See #1252.
 *
 * The trailing marker is what proves survival: if the function aborts, it is
 * never printed and execFileSync throws.
 */
function run(name, preamble) {
  // Called as the condition of an `if`, because `remove_stale_node_dxp_tree`
  // can now legitimately return non-zero - a tree that survives removal ends
  // the run (#1252). A bare call would be aborted by errexit before `exit=$?`
  // could record the status, so the one outcome most worth asserting would be
  // indistinguishable from the abort this harness exists to detect.
  return execFileSync(
    'bash',
    [
      '-c',
      // fd 3 is the harness's own stdout, opened before anything runs. A stub
      // that echoes its argv to stdout OR stderr is swallowed by the
      // function's own `2>&1` capture - and worse, the captured text then
      // contains the container script, which includes the literal `echo
      // GONE`, so a SURVIVED verdict matched the success case. The stub
      // reports through 3; the function never sees it.
      `set -eu\nexec 3>&1\n${preamble}\n${extract(name)}\nif ${name}; then echo "exit=0"; else echo "exit=$?"; fi\necho "SURVIVED"`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

/** A `docker` stub whose helper container reports `verdict`. */
const dockerSaying = (verdict) =>
  `docker() { echo "DOCKER-ARGS: $*" >&3; ${
    verdict === null ? 'return 1' : `echo "${verdict}"`
  }; }`;

/** An `ssh` stub that resolves $HOME the way the real node does. */
const SSH_OK = 'ssh() { printf %s /home/ldm-automation; }';

describe('the stale DXP tree is removed before the build (#1252)', () => {
  const removal = (stubs) =>
    run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        ...stubs,
      ].join('\n')
    );

  it('removes it as root, scoped to this project, on the node', () => {
    // NOT over SSH, and this is not a preference.
    //
    // The first version was `ssh … rm -rf …` and failed on every run between
    // merging and being replaced - seven for seven, never once succeeding.
    // `routes/default` is drwxr-x--- owned by uid 1000 and the SSH user is
    // 1001, so that account cannot traverse it to remove anything: not with
    // `rm`, not with `chmod`, not with `sudo` (it has none), and not through
    // rsync's own -p/-g/-o, which attempted the same repair in the same run
    // and was refused with `chgrp … Operation not permitted`. The node's
    // docker daemon runs as root and is the only identity available that can.
    const out = removal([SSH_OK, dockerSaying('GONE')]);

    expect(out).toMatch(/rm -rf \/project\/routes\/default\/dxp/);
    expect(out).toMatch(/Removed any stale DXP config tree/);
    expect(out).toContain('exit=0');
  });

  it('mounts the project directory, never the tree itself', () => {
    // `docker run -v` creates a missing host path as root. Mounting
    // routes/default/dxp would create it root-owned exactly where
    // ldm-automation needs to write - the bug, manufactured by its own fix.
    // Liferay's _deleteRoutes deltrees that directory and recreates it, so it
    // is routinely absent at this point (LDM-#1944).
    const out = removal([SSH_OK, dockerSaying('GONE')]);

    expect(out).toMatch(
      /-v \/home\/ldm-automation\/\.liferay-docker\/projects\/aica-e2e:\/project/
    );
    expect(out).not.toMatch(/-v [^ ]*routes\/default\/dxp:/);
  });

  it('ends the run when the tree survives removal', () => {
    // #1253 warned here instead, seven times, and the warning is why nobody
    // noticed its fix had never once worked. A surviving tree is proof the
    // suite cannot pass: Liferay publishes the stale domain, no OAuth
    // redirect URI matches, and twelve specs fail ninety minutes later on
    // elements that never render.
    const out = removal([SSH_OK, dockerSaying('SURVIVED')]);

    expect(out).toContain('::error::');
    expect(out).toMatch(/exit=[^0]/);
    expect(out).toContain('SURVIVED');
  });

  it('neither succeeds nor fails when the helper container did not run', () => {
    // No output is not proof the tree is there, and not proof it is gone.
    // Ending the run on it would make a broken daemon indistinguishable from
    // the defect; reporting success would be the #1253 failure again.
    const out = removal([SSH_OK, dockerSaying(null)]);

    expect(out).toContain('::warning::');
    expect(out).toContain('exit=0');
    expect(out).not.toMatch(/Removed any stale DXP config tree/);
  });

  it('does not attempt the removal over SSH', () => {
    // The regression that matters: the obvious "simplification" of the above
    // is the version that cannot work.
    const source = withoutHashComments(extract('remove_stale_node_dxp_tree'))
      .replace(/\\\n\s*/g, ' ')
      .split('\n')
      .filter((line) => /\bssh\b/.test(line))
      .join('\n');

    expect(source).not.toBe('');
    expect(source).not.toMatch(/rm\s+-rf/);
    expect(source).not.toMatch(/routes\/default/);
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

  it('cannot abort the run when ssh fails, under errexit', () => {
    // The defect run 37632331741 died on. `set -e` is on in the real script,
    // and a bare `err="$(cmd)"` that fails aborts AT THE ASSIGNMENT - the
    // following `status=$?` never runs. A diagnostic becoming a second way for
    // the run to die is #1238, committed while fixing a diagnostic.
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "nope" >&2; return 255; }',
      ].join('\n')
    );

    expect(out).toContain('SURVIVED');
  });

  it('reports the real ssh exit code, not the negation of one', () => {
    // `if ! err="$(cmd)"` also survives errexit, but inside the branch $? is
    // the negation's status - always 0 - so the message would say "ssh exit 0"
    // for a failure. Surviving is not enough; the code must be the real one.
    const out = run(
      'remove_stale_node_dxp_tree',
      [
        'LDM_NODE_TARGET=aws-1',
        'PROJECT_NAME=aica-e2e',
        'TARGET_HOST=aica-e2e.demo',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "nope" >&2; return 255; }',
      ].join('\n')
    );

    expect(out).toContain('ssh exit 255');
    expect(out).not.toContain('ssh exit 0');
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
    const remove = source.indexOf('if ! remove_stale_node_dxp_tree; then');

    expect(imp).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(imp);
  });

  it('runs before the stack is built, not after', () => {
    const source = script();
    const remove = source.indexOf('if ! remove_stale_node_dxp_tree; then');
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
