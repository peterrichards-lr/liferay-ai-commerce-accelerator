const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * The portal's own notion of its domain must match the host the suite uses.
 *
 * On a node, `routes/default/dxp` used to survive every run, because
 * `ldm rm --delete` removed only the LOCAL project directory. Ours was dated 23
 * September and said `localhost`, so every OAuth user-agent application was
 * registered with redirect URIs at `http://localhost/o/oauth2/redirect` and no
 * browser on the real host could complete a handshake. Twelve specs failed on
 * elements that never render (#1252). LDM-#2077 fixed the removal and the
 * workaround went with #1254; the check that names a wrong domain stays.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

const raw = () => fs.readFileSync(SCRIPT, 'utf8');

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
 * a harness that omits it cannot catch the failure mode it most needs to: a
 * bare `x="$(cmd)"` whose command fails exits the script under errexit. Run
 * 37632331741 died that way in a diagnostic and went straight to cleanup, while
 * a `set -u` harness passed it. See #1252.
 *
 * The trailing marker is what proves survival: if the function aborts, it is
 * never printed and execFileSync throws.
 */
function run(name, preamble) {
  // Called as the condition of an `if`, so a non-zero return is recorded as
  // `exit=N` rather than aborted by errexit before `exit=$?` could run - which
  // would make it indistinguishable from the abort this harness exists to
  // detect.
  return execFileSync(
    'bash',
    [
      '-c',
      // fd 3 is the harness's own stdout, opened before anything runs, so a
      // stub can report without its output being captured by the function.
      `set -eu\nexec 3>&1\n${preamble}\n${extract(name)}\nif ${name}; then echo "exit=0"; else echo "exit=$?"; fi\necho "SURVIVED"`,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
}

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
