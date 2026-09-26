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
function stubDocker(
  dir,
  {
    container = 'aica-e2e-microservice',
    logsFail = false,
    treesPopulated = false,
    mainDomain = 'aica-e2e.demo',
  } = {}
) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/bash
# 'docker exec -u 0 ...' puts the flag before the container name, so the
# case below must not assume $1 is the subcommand's first argument.
AS_ROOT=0
[[ "$*" == *"-u 0"* ]] && AS_ROOT=1
case "$1" in
  id) echo "liferay" ;;
  ps) ${container ? `echo "${container}"` : 'true'} ;;
  logs) ${logsFail ? 'exit 1' : 'echo "microservice boot line" >&2; echo "ENOTFOUND aica-e2e.demo" >&2'} ;;
  inspect)
     if [[ "$*" == *StartedAt* ]]; then echo '2026-09-26T06:36:18.000000000Z'
     elif [[ "$*" == *Health.Log* ]]; then echo '  2026-09-26T06:44:30Z exit=0'
     elif [[ "$*" == *depends_on* ]]; then echo 'liferay:service_healthy'
     elif [[ "$*" == *ExtraHosts* ]]; then echo 'null'
     elif [[ "$*" == *Mounts* ]]; then echo '[{"Type":"bind","Source":"/opt/ldm/aica-e2e/routes/default/ai-commerce-accelerator-microservice","Destination":"/etc/liferay/lxc/ext-init-metadata"}]'
     else
       echo "LIFERAY_API_URL=https://aica-e2e.demo"
       echo "LIFERAY_OAUTH_CLIENT_SECRET=super-secret-value"
       echo "OPENAI_API_KEY=sk-live-aaaaaaaa"
     fi ;;
  exec)
     # Must precede the listing branch below: both mention LIFERAY_ROUTES_DXP,
     # and only this one reads the files.
     if [[ "$*" == *basename* ]]; then
       echo "com.liferay.lxc.dxp.main.domain = ${mainDomain}"
       echo "com.liferay.lxc.dxp.server.protocol = https"
       echo "com.liferay.lxc.dxp.client.secret = should-not-appear"
     elif [[ "$*" == *"id -un"* ]]; then echo "liferay"
     elif [[ "$*" == *LIFERAY_ROUTES_DXP* ]]; then
       ${
         treesPopulated
           ? 'echo "--- /etc/liferay/lxc/dxp-metadata ---"; echo "com.liferay.lxc.dxp.main.domain"; echo "--- /etc/liferay/lxc/ext-init-metadata ---"; echo "com.liferay.lxc.ext.oauth.application.external.reference.codes"'
           : 'echo "--- /etc/liferay/lxc/dxp-metadata ---"; echo "  (path does not exist - nothing mounted here)"'
       }
     elif [[ "$*" == *"for d in /opt/liferay/routes/default"* ]]; then
       echo "--- /opt/liferay/routes/default/dxp/ ---"
       echo "-rw-r----- 1 liferay liferay 9 Sep 23 11:40 com.liferay.lxc.dxp.main.domain"
       echo "--- /opt/liferay/routes/default/ai-commerce-accelerator-microservice/ ---"
       echo "-rw-r----- 1 liferay liferay 44 Sep 24 14:57 ...oauth2.headless.server.client.id"
     elif [[ "$*" == *"ls -la /opt/liferay/routes/default"* ]]; then
       echo "drwxr-xr-x 2 root    root    4096 dxp"
       echo "drwxr-xr-x 2 root    root    4096 ai-commerce-accelerator-microservice"
       echo "--- whoami ---"; echo "uid=1000(liferay) gid=1000(liferay)"
     elif [[ "$*" == *"ls -A /opt/liferay/routes"* ]]; then echo "16"
     else echo "stub-exec-output"; fi ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  return bin;
}

function runCapture(
  dir,
  {
    container = 'aica-e2e-microservice',
    stage = 'pre-tests',
    logsFail = false,
    treesPopulated = false,
    mainDomain = 'aica-e2e.demo',
  } = {}
) {
  const bin = stubDocker(dir, {
    container,
    logsFail,
    treesPopulated,
    mainDomain,
  });
  const harness = path.join(dir, 'capture.sh');
  fs.writeFileSync(
    harness,
    [
      'set -e',
      'TARGET_HOST=aica-e2e.demo',
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
    stderr: result.stderr,
    log: read('logs/e2e-microservice.log'),
    facts: read(`logs/e2e-microservice-container-${stage}.txt`),
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

  test('captures while the node is still reachable, not only at teardown', () => {
    // Run 35786135201 failed and every docker call in cleanup then timed out
    // after ~62s, so a teardown-only capture recorded "no container found"
    // against a stack that had been up for forty minutes. The moment the run
    // fails is the moment the node is least likely to answer.
    const body = fs.readFileSync(SCRIPT, 'utf8');
    const preTests = body.indexOf('capture_microservice_diagnostics pre-tests');
    const phase5 = body.indexOf('Phase 5: Running Playwright');
    expect(preTests).toBeGreaterThan(-1);
    expect(preTests).toBeLessThan(phase5);
  });

  test('a dead daemon at teardown cannot blank an earlier capture', () => {
    sandbox((dir) => {
      runCapture(dir, { stage: 'pre-tests' });
      const collected = fs.readFileSync(
        path.join(dir, 'logs', 'e2e-microservice.log'),
        'utf8'
      );
      expect(collected).toMatch(/ENOTFOUND/);

      // The real shape: cleanup still names the container, but every docker
      // call against the dead daemon fails. An unconditional redirect
      // truncates the file before that failure is known.
      runCapture(dir, { stage: 'teardown', logsFail: true });
      expect(
        fs.readFileSync(path.join(dir, 'logs', 'e2e-microservice.log'), 'utf8')
      ).toBe(collected);
    });
  });

  test('records the stage, so two captures are tellable apart', () => {
    sandbox((dir) => {
      expect(runCapture(dir, { stage: 'pre-tests' }).facts).toMatch(
        /stage: pre-tests/
      );
    });
  });

  test('records the LXC config trees, which is what answers LDM-#1915', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir, { treesPopulated: true });
      expect(facts).toMatch(/LXC config trees/);
      expect(facts).toMatch(/dxp-metadata/);
      expect(facts).toMatch(/ext-init-metadata/);
    });
  });

  test('distinguishes an unmounted path from a mounted empty one', () => {
    sandbox((dir) => {
      // Before LDM-#1928 nothing was mounted at ext-init-metadata at all.
      // "empty" and "absent" are different answers to #1915 and the report
      // has to tell them apart.
      const probe = fs.readFileSync(SCRIPT, 'utf8');
      expect(probe).toMatch(/path does not exist - nothing mounted here/);
      expect(probe).toMatch(/\(mounted, empty\)/);
    });
  });

  // The rule is "never read ext-init contents", not "never use cat". This
  // used to slice to the end of the function and forbid `cat` outright, which
  // caught the #1137 change that reads the DXP tree's values - domains and a
  // protocol, deliberately printed. Scoped to what it actually means, and
  // still able to fail: point the values probe at ext-init and it does.
  test('lists the credential tree by name, never by content', () => {
    const body = functionSource('capture_microservice_diagnostics');
    const listing = body.slice(
      body.indexOf('LXC config trees'),
      body.indexOf('DXP config tree values')
    );
    expect(listing).not.toMatch(/\b(cat|head|tail)\b/);
    expect(listing).toMatch(/ls -A/);
  });

  test('the value probe reads the DXP tree only, never ext-init', () => {
    const body = functionSource('capture_microservice_diagnostics');
    // Comments only, stripped: the block explains *why* it avoids
    // ext-init-metadata, and matching that prose would make this pass or fail
    // on the wording rather than the command. #1073 is the same lesson - a
    // guard that counted comments as reads.
    const values = body
      .slice(
        body.indexOf('DXP config tree values'),
        body.indexOf('mounts, as Docker records them')
      )
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    // It reads file contents, so the directory it reads is the whole safety
    // argument. ext-init-metadata holds generated OAuth2 client secrets.
    expect(values).toMatch(/LIFERAY_ROUTES_DXP/);
    expect(values).not.toMatch(/LIFERAY_ROUTES_CLIENT_EXTENSION|ext-init/);
  });

  test('counts the app route handlers as a shadowing canary', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // If a bind mount ever shadows /opt/liferay/routes the container will
      // not start (LDM-#1911). A count of 0 says so immediately.
      expect(facts).toMatch(/app code - must NOT be empty/);
    });
  });

  test('records routes/default with ownership, as Liferay sees it', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // LDM asked for this to settle two questions: a directory that is not
      // the mounted ext-id means an id mismatch; only `dxp` means Liferay
      // never registered the extension. Ownership is what `(Permission
      // denied)` turns on, so `-l` is not optional.
      expect(facts).toMatch(
        /routes\/default, as the Liferay container sees it/
      );
      expect(facts).toMatch(/ai-commerce-accelerator-microservice/);
      expect(facts).toMatch(/uid=1000\(liferay\)/);
    });
  });

  test('reads routes/default from the writing side, not the extension', () => {
    const body = functionSource('capture_microservice_diagnostics');
    const block = body.slice(body.indexOf('routes/default, as the Liferay'));
    // The extension mounts a subtree; Liferay mounts the parent and is the
    // side that writes. Probing the extension would show neither the sibling
    // directories nor the ownership.
    //
    // Asserted on the `docker exec` line itself. An earlier version matched
    // anywhere in the block and was satisfied by the fallback error message,
    // which names the variable without using it - it passed against a version
    // that probed the wrong container.
    const execLine = block.split('\n').find((l) => l.includes('docker exec'));
    expect(execLine).toBeDefined();
    expect(execLine).toMatch(/docker exec "\$LIFERAY_CONTAINER"/);
  });

  test('records the compose depends_on for this service', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      // Settles the ordering question outright rather than inferring it from
      // timestamps, which is how it was got wrong once already.
      expect(facts).toMatch(/compose depends_on/);
      expect(facts).toMatch(/liferay:service_healthy/);
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

  // Run 35992670909 resolved Liferay as https://localhost:8080 and spent the
  // run calling itself. Whether the config tree holds the project host or the
  // portal's local listener is the whole question, and a listing of file names
  // cannot answer it. See #1137.
  test('prints the DXP tree values, not just the file names', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir, { mainDomain: 'aica-e2e.demo' });
      expect(facts).toMatch(/DXP config tree values/);
      expect(facts).toMatch(
        /com\.liferay\.lxc\.dxp\.main\.domain = aica-e2e\.demo/
      );
      expect(facts).toMatch(/com\.liferay\.lxc\.dxp\.server\.protocol = https/);
    });
  });

  test('shows a wrong main domain rather than hiding it behind a file name', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir, { mainDomain: 'localhost:8080' });
      expect(facts).toMatch(
        /com\.liferay\.lxc\.dxp\.main\.domain = localhost:8080/
      );
    });
  });

  // The DXP tree is domains and a protocol today. A key added later might not
  // be, and this lands in a public CI artifact.
  test('redacts a credential-shaped key among the tree values', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).not.toMatch(/should-not-appear/);
      expect(facts).toMatch(/client\.secret = <redacted>/);
    });
  });

  // The half liferay-docker-manager#1944 is missing: Liferay writes
  // routes/default/<ext_id> and the container reads an empty directory, so the
  // remaining explanation is that the two are not the same path.
  test('records where Docker actually binds the ext-init mount', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).toMatch(/mounts, as Docker records them/);
      expect(facts).toMatch(/ext-init-metadata/);
      expect(facts).toMatch(/"Source":/);
    });
  });

  // A live value and a fossil look identical in a directory listing: directory
  // mtime tracks entries added or removed, not contents changed. `dxp` carried
  // `Sep 23 11:40` across two runs a day apart with `ldm rm --delete` between
  // them, so whether Liferay wrote localhost this run is unanswerable without
  // file timestamps. See #1146, #1137.
  // These two assert the capture reaches the artifact; the stub supplies the
  // timestamps, so they cannot tell `ls -la` from `ls -A`. The third case
  // pins the command itself, and is what actually fails if the -l is dropped.
  test('lists each routes subdirectory with file timestamps', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      expect(facts).toMatch(/routes\/default\/\*\/ contents/);
      expect(facts).toMatch(/com\.liferay\.lxc\.dxp\.main\.domain/);
      // A timestamp, which is the entire point of the addition.
      expect(facts).toMatch(/Sep 23 11:40/);
    });
  });

  test('shows whether the per-extension tree holds any files', () => {
    sandbox((dir) => {
      const { facts } = runCapture(dir);
      const block = facts.slice(facts.indexOf('routes/default/*/ contents'));
      expect(block).toMatch(/ai-commerce-accelerator-microservice/);
      expect(block).toMatch(/oauth2\.headless\.server\.client\.id/);
    });
  });

  // ls -la prints names, sizes and times. The per-extension tree holds
  // generated OAuth2 credentials, so the values must never appear (#1128).
  //
  // Comment lines are stripped before matching. This guard has now fired on
  // its own prose three times: twice on #1073, and again when a comment
  // explaining why `head` was avoided here contained the word `head`. A
  // guard that a comment can fail is a guard that a comment can also
  // satisfy, so the stripping is asserted below rather than assumed.
  const withoutComments = (text) =>
    text
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

  test('the routes listing reads no file contents', () => {
    const body = functionSource('capture_microservice_diagnostics');
    const listing = withoutComments(
      body.slice(
        body.indexOf('routes/default/*/ contents'),
        body.indexOf('compose depends_on')
      )
    );
    expect(listing).toMatch(/ls -la/);
    expect(listing).not.toMatch(/\b(cat|head)\b/);
  });

  test('the comment stripping actually strips, and keeps code', () => {
    // Without this, the case above could pass by having stripped everything.
    const stripped = withoutComments(
      [
        '# head of the file',
        'ls -la "$d"',
        '  # cat the thing',
        'echo done',
      ].join('\n')
    );
    expect(stripped).not.toMatch(/\b(cat|head)\b/);
    expect(stripped).toContain('ls -la "$d"');
    expect(stripped).toContain('echo done');
  });
});
