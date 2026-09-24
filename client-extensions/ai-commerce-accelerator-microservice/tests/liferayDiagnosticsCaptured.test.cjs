const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The run must keep Liferay's own log.
 *
 * Three diagnoses in one week rested on what Liferay said at boot - the empty
 * `ext-init` tree, the routes permissions, and the unresolved OSGi modules -
 * and none could be settled, because the E2E captured the microservice's log
 * and nothing else. The evidence existed only in a manual `docker logs` that
 * nothing retained, and one of those diagnoses was sent upstream and had to be
 * withdrawn. See #1130.
 *
 * These run the real function with `docker` stubbed: what matters is what
 * lands on disk, not that a command was issued.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const lines = fs.readFileSync(SCRIPT, 'utf8').split('\n');

function functionSource(name) {
  const start = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (start === -1) throw new Error(`${name} is gone from the script`);
  const end = lines.indexOf('}', start);
  return lines.slice(start, end + 1).join('\n');
}

// A Liferay log carrying one line for each candidate cause, plus two secrets
// that must not survive into a public artifact.
const LIFERAY_LOG = [
  'INFO  [main] Liferay starting',
  'ERROR Could not resolve module: com.liferay.custom.client.extension.entry',
  'ERROR [RoutesPortalK8sConfigMapModifier:155] Unable to write routes for foo',
  'ERROR ClientExtension bootstrap Exception: NullPointerException',
  'INFO  oauth2.headless.server.client.secret=SUPERSECRETVALUE',
  'INFO  Authorization: Bearer eyJhbGciOi.REALPAYLOAD.sig',
  // Deliberately matches a signals pattern *and* carries a secret, so the
  // signals assertion below can actually fail. Without it that test passed
  // even with redaction removed - a guard that could not fail.
  'ERROR OAuth2 registration failed, client.secret=SIGNALSECRETVALUE',
].join('\n');

function runCapture(
  dir,
  { liferayReachable = true, stage = 'pre-tests' } = {}
) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/bash
case "$1" in
  ps) echo "aica-e2e-microservice" ;;
  logs)
    if [[ "$*" == *microservice* ]]; then
      echo "microservice boot line" >&2
    else
      ${liferayReachable ? `cat <<'LIFERAY'\n${LIFERAY_LOG}\nLIFERAY` : 'exit 1'}
    fi ;;
  inspect) echo 'null' ;;
  exec) echo "stub-exec-output" ;;
esac
exit 0
`,
    { mode: 0o755 }
  );

  const harness = path.join(dir, 'capture.sh');
  fs.writeFileSync(
    harness,
    [
      'set -e',
      'TARGET_HOST=aica-e2e.demo',
      'PROJECT_NAME=aica-e2e',
      functionSource('capture_microservice_diagnostics'),
      `capture_microservice_diagnostics ${stage}`,
    ].join('\n')
  );

  const result = spawnSync('bash', [harness], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });

  const read = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  };

  return {
    status: result.status,
    liferayLog: read('logs/e2e-liferay.log'),
    signals: read('logs/e2e-liferay-signals.txt'),
  };
}

function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-liferay-diag-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Every spawn here runs bash, the capture function and a stub docker several
// times over. Done per test, that is six subprocess trees in a file that runs
// alongside 180 others - enough to push both this file and the existing
// microservice capture tests past vitest's 5s default under full-suite
// parallelism. The captures are therefore taken once, and the tests assert on
// the strings they produced.
describe('Liferay container log capture (#1130)', () => {
  let captured;
  let afterUnreachable;

  beforeAll(() => {
    captured = sandbox((dir) => runCapture(dir));

    // Sequential, in one sandbox: a teardown capture that cannot reach Liferay
    // must not blank what pre-tests collected. The node is least likely to
    // answer during cleanup - #1125 recorded "no container found" against a
    // stack that had run for forty minutes.
    afterUnreachable = sandbox((dir) => {
      const first = runCapture(dir, { stage: 'pre-tests' });
      const second = runCapture(dir, {
        liferayReachable: false,
        stage: 'teardown',
      });
      return { first, second };
    });
  }, 120000);

  test('the log reaches the artifact and carries content', () => {
    expect(captured.liferayLog).not.toBeNull();
    // A byte count, asserted. #1125 uploaded 166 bytes on every run while
    // claiming to hold the microservice's logs.
    expect(captured.liferayLog.length).toBeGreaterThan(100);
    expect(captured.liferayLog).toMatch(/Liferay starting/);
  });

  test('secrets do not survive into the artifact', () => {
    expect(captured.liferayLog).not.toMatch(/SUPERSECRETVALUE/);
    expect(captured.liferayLog).not.toMatch(/REALPAYLOAD/);
    expect(captured.liferayLog).toMatch(/<redacted>/);
  });

  test('the signals file separates the three candidate causes', () => {
    expect(captured.signals).toMatch(/Could not resolve module/);
    expect(captured.signals).toMatch(/PortalK8sConfigMapModifier/);
    expect(captured.signals).toMatch(/ClientExtension bootstrap Exception/);
  });

  test('the signals file carries no secret values either', () => {
    expect(captured.signals).toMatch(/OAuth2 registration failed/);
    expect(captured.signals).not.toMatch(/SIGNALSECRETVALUE/);
    expect(captured.signals).not.toMatch(/SUPERSECRETVALUE/);
  });

  test('an unreachable Liferay leaves an earlier capture intact and does not fail the run', () => {
    expect(afterUnreachable.first.liferayLog).toMatch(/Liferay starting/);
    expect(afterUnreachable.second.status).toBe(0);
    expect(afterUnreachable.second.liferayLog).toMatch(/Liferay starting/);
  });
});
