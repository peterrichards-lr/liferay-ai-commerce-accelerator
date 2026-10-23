const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The node's routes/ ownership is recorded before the first sync and after
 * teardown, because LDM-#2266 needs it and no artifact has ever held it. Both
 * the sync (rsync drops --delete on one I/O error) and `ldm rm --delete` fail
 * inside that directory, and only a root view says why. See #1364.
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
 * Runs the capture under `set -eu`, as the real script does, in a scratch
 * directory so the facts file lands somewhere it can be read back. The
 * trailing SURVIVED marker is what proves a failing stub did not abort it.
 */
function capture(stage, preamble) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'node-routes-'));
  const out = execFileSync(
    'bash',
    [
      '-c',
      `set -eu\nexec 3>&1\n${preamble}\n${extract('capture_node_routes_permissions')}\ncapture_node_routes_permissions ${stage}\necho "SURVIVED"`,
    ],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const facts = path.join(cwd, 'logs', `e2e-node-routes-${stage}.txt`);

  // A path this harness built under its own mkdtemp, not input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  if (!fs.existsSync(facts)) return { out, facts: null };

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return { out, facts: fs.readFileSync(facts, 'utf8') };
}

const REMOTE = [
  'LDM_NODE_TARGET=node-b',
  'PROJECT_NAME=aica-e2e',
  'DOCKER_HOST=ssh://user@10.0.0.1',
  'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
];

const SSH_OK =
  'ssh() { printf "%s\\n" /home/ldm-automation "uid=1001(ldm-automation)" "ls: cannot open directory routes/default: Permission denied"; }';

const DOCKER_ECHO =
  'docker() { echo "DOCKER-ARGS: $*" >&3; echo "ROOT-VIEW"; }';

describe("the node's routes/ ownership is recorded (#1364)", () => {
  it('mounts projects/ read-only, never the project directory itself', () => {
    // After a teardown that worked the project is gone, and `docker run -v`
    // creates a missing host path as root - the capture would manufacture the
    // root-owned directory the next sync fails on.
    const { out } = capture(
      'post-teardown',
      [...REMOTE, SSH_OK, DOCKER_ECHO].join('\n')
    );

    expect(out).toMatch(
      /-v \/home\/ldm-automation\/\.liferay-docker\/projects:\/projects:ro/
    );
    expect(out).not.toMatch(/-v [^ ]*projects\/aica-e2e:/);
  });

  it('records both the SSH user view and the root view', () => {
    const { facts } = capture(
      'pre-sync',
      [...REMOTE, SSH_OK, DOCKER_ECHO].join('\n')
    );

    expect(facts).toContain('uid=1001(ldm-automation)');
    expect(facts).toContain('Permission denied');
    expect(facts).toContain('ROOT-VIEW');
    // $HOME is the protocol's first line, not part of the finding.
    expect(facts).not.toMatch(/^\/home\/ldm-automation$/m);
  });

  it('mounts nothing when projects/ does not exist on the node', () => {
    const { out, facts } = capture(
      'pre-sync',
      [
        ...REMOTE,
        'ssh() { echo NO_PROJECTS_DIR; echo "uid=1001"; }',
        DOCKER_ECHO,
      ].join('\n')
    );

    expect(out).not.toContain('DOCKER-ARGS');
    expect(facts).toContain('nothing was mounted');
  });

  it('mounts nothing when docker is not routed to the node', () => {
    // A run that died before route_docker_to_node still reaches the
    // post-teardown capture through cleanup. Unrouted, the helper would run
    // on the runner and mount a path that only exists on the node.
    const unrouted = (dockerHost) =>
      capture(
        'post-teardown',
        [
          ...REMOTE.filter((l) => !l.startsWith('DOCKER_HOST')),
          dockerHost,
          SSH_OK,
          DOCKER_ECHO,
        ].join('\n')
      );

    const unset = unrouted('unset DOCKER_HOST');
    expect(unset.out).not.toContain('DOCKER-ARGS');
    expect(unset.facts).toContain('DOCKER_HOST=unset');

    // Set is not routed: a workstation's colima socket is local.
    const local = unrouted(
      'DOCKER_HOST=unix:///Users/me/.colima/default/docker.sock'
    );
    expect(local.out).not.toContain('DOCKER-ARGS');
    expect(local.facts).toContain('nothing was mounted');
  });

  it('records an ssh failure as unread, with the reason, and survives errexit', () => {
    // Unknown is not absent: an empty section would read as an empty
    // directory. And a diagnostic must not become a way for the run to die
    // (#1238).
    const { out, facts } = capture(
      'pre-sync',
      [
        ...REMOTE,
        'ssh() { echo "Connection timed out" >&2; return 255; }',
        DOCKER_ECHO,
      ].join('\n')
    );

    expect(out).toContain('SURVIVED');
    expect(out).not.toContain('DOCKER-ARGS');
    expect(facts).toContain('UNREAD: ssh exit 255');
    expect(facts).toContain('Connection timed out');
  });

  it('records a refused listing as the finding, not as an unread node', () => {
    // The remote command itself, run by `sh` against a routes/default its
    // user cannot open - the node's real condition. Its last `ls` fails, and
    // without the trailing `true` ssh would exit non-zero and the whole SSH
    // view would be filed as UNREAD, hiding exactly the denial being sought.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'node-home-'));
    const routesDefault = path.join(
      home,
      '.liferay-docker',
      'projects',
      'aica-e2e',
      'routes',
      'default'
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(routesDefault, { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.chmodSync(routesDefault, 0o000);

    try {
      const { facts } = capture(
        'pre-sync',
        [
          ...REMOTE,
          `ssh() { eval "set -- \\"\\\${$#}\\""; HOME='${home}' sh -c "$1"; }`,
          DOCKER_ECHO,
        ].join('\n')
      );

      expect(facts).not.toContain('UNREAD: ssh');
      expect(facts).toMatch(/Permission denied/);
      expect(facts).toContain('ROOT-VIEW');
    } finally {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.chmodSync(routesDefault, 0o755);
    }
  });

  it('records a helper container failure as unread, and survives errexit', () => {
    const { out, facts } = capture(
      'post-teardown',
      [...REMOTE, SSH_OK, 'docker() { return 125; }'].join('\n')
    );

    expect(out).toContain('SURVIVED');
    expect(facts).toContain('UNREAD: helper container exit 125');
  });

  it('does nothing for a local target', () => {
    const { out, facts } = capture(
      'pre-sync',
      [
        'LDM_NODE_TARGET=local',
        'PROJECT_NAME=aica-e2e',
        'node_ssh_endpoint() { echo "user@10.0.0.1"; }',
        'ssh() { echo "SSH-ARGS" >&3; }',
        DOCKER_ECHO,
      ].join('\n')
    );

    expect(out).not.toContain('SSH-ARGS');
    expect(out).not.toContain('DOCKER-ARGS');
    expect(facts).toBeNull();
  });

  it('captures before the first sync, which is ldm import', () => {
    const source = script();
    const captureAt = source.indexOf(
      'capture_node_routes_permissions pre-sync'
    );
    const importAt = source.indexOf('ldm_cmd import .');

    expect(captureAt).toBeGreaterThan(-1);
    expect(captureAt).toBeLessThan(importAt);
  });

  it('captures after teardown and before the node is put to sleep', () => {
    const cleanup = withoutHashComments(extract('cleanup'));
    const rm = cleanup.indexOf('ldm_cmd rm "$PROJECT_NAME" --delete');
    const captureAt = cleanup.indexOf(
      'capture_node_routes_permissions post-teardown'
    );
    const sleep = cleanup.indexOf('node_power.sh sleep');

    expect(rm).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(rm);
    expect(captureAt).toBeLessThan(sleep);
  });

  it('cannot fail the run at either call site', () => {
    const source = script();

    expect(source).toContain(
      'capture_node_routes_permissions pre-sync || true'
    );
    expect(source).toContain(
      'capture_node_routes_permissions post-teardown || true'
    );
  });
});
