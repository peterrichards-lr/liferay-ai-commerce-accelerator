const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The microservice log artifact must actually contain the microservice's logs.
 *
 * `logs/e2e-microservice.log` was created, truncated and never written to. It
 * had been written by a locally-run microservice; once the extension became a
 * container its output went to the node's docker daemon, and the artifact was
 * uploaded empty on every run - 166 bytes, indefinitely.
 *
 * That cost real time. Diagnosing the Phase 5 401s needed the microservice's
 * own errors, and the artifact that exists to carry them could not: the
 * evidence was on the node, the file was on the runner. Going after it from a
 * workstation instead put concurrent SSH against the node while the run was
 * using it, and the run failed with "Docker not accessible".
 *
 * These cases run the real function with `docker` stubbed, because the
 * property that matters is what lands on disk.
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

// A stub docker standing in for the node's daemon. `logs` writes to stderr, as
// the real one does for a Node process, so the capture has to redirect it.
function stubDocker(dir, { container = 'aica-e2e-microservice' } = {}) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/bash
case "$1" in
  ps) ${container ? `echo "${container}"` : 'true'} ;;
  logs) echo "microservice boot line" >&2; echo "ENOTFOUND aica-e2e.demo" >&2 ;;
  inspect)
     if [[ "$*" == *ExtraHosts* ]]; then echo 'null'
     else
       echo "LIFERAY_API_URL=https://aica-e2e.demo"
       echo "LIFERAY_OAUTH_CLIENT_SECRET=super-secret-value"
       echo "OPENAI_API_KEY=sk-live-aaaaaaaa"
     fi ;;
  exec) echo "stub-exec-output" ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  return bin;
}

function runCapture(dir, { container = 'aica-e2e-microservice' } = {}) {
  const bin = stubDocker(dir, { container });
  const harness = path.join(dir, 'capture.sh');
  fs.writeFileSync(
    harness,
    [
      'set -e',
      'TARGET_HOST=aica-e2e.demo',
      functionSource('capture_microservice_diagnostics'),
      'capture_microservice_diagnostics',
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
    stderr: result.stderr,
    log: read('logs/e2e-microservice.log'),
    facts: read('logs/e2e-microservice-container.txt'),
  };
}

function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aica-diag-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('microservice container diagnostics', () => {
  test('the log artifact carries the container output', () => {
    sandbox((dir) => {
      const { log } = runCapture(dir);
      // The whole defect: this file existed and was empty.
      expect(log).toBeTruthy();
      expect(log).toMatch(/ENOTFOUND aica-e2e.demo/);
    });
  });

  test('captures stderr, not just stdout', () => {
    sandbox((dir) => {
      // A Node microservice logs errors to stderr; capturing stdout alone
      // reproduces the empty file for the lines that matter most.
      expect(runCapture(dir).log).toMatch(/microservice boot line/);
    });
  });

  test('records the resolution facts the 401 diagnosis needed', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).toMatch(/ExtraHosts/);
      expect(facts).toMatch(/LIFERAY_API_URL=https:\/\/aica-e2e\.demo/);
      expect(facts).toMatch(/routes/);
    });
  });

  test('redacts credential-shaped values', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).not.toMatch(/super-secret-value/);
      expect(facts).not.toMatch(/sk-live-aaaaaaaa/);
      // The names stay - knowing a variable arrived is the diagnostic.
      expect(facts).toMatch(/LIFERAY_OAUTH_CLIENT_SECRET=<redacted>/);
      expect(facts).toMatch(/OPENAI_API_KEY=<redacted>/);
    });
  });

  test('says so plainly when there is no container', () => {
    sandbox((dir) => {
      const { facts, status } = runCapture(dir, { container: '' });
      expect(facts).toMatch(/No microservice container/);
      expect(status).toBe(0);
    });
  });

  test('never fails the run it is diagnosing', () => {
    sandbox((dir) => {
      // It runs inside the EXIT trap. A non-zero return there would replace
      // the run's real failure with this one.
      expect(runCapture(dir).status).toBe(0);
    });
  });

  test('runs before the removal that destroys the container', () => {
    const cleanup = functionSource('cleanup');
    const captured = cleanup.indexOf('capture_microservice_diagnostics');
    const removed = cleanup.indexOf('ldm_cmd rm');
    expect(captured).toBeGreaterThan(-1);
    expect(removed).toBeGreaterThan(-1);
    expect(captured).toBeLessThan(removed);
  });

  test('is defined before cleanup calls it', () => {
    const def = lines.findIndex((l) =>
      l.startsWith('capture_microservice_diagnostics() {')
    );
    const cleanupDef = lines.findIndex((l) => l.startsWith('cleanup() {'));
    expect(def).toBeGreaterThan(-1);
    expect(def).toBeLessThan(cleanupDef);
  });
});
