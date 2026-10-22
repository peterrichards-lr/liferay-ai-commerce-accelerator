const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The machine that builds the image must be measured before it is used.
 *
 * `resource-monitor.log` watches the GitHub runner. On run 38276108860 it
 * reported 15989MB of memory and 145G at 44% while `/mnt/docker-data` on the
 * node - the host actually running BuildKit - was at 98MB free of 30GB. Every
 * nightly from 4 October failed at `RUN yarn install`, and the capture work in
 * #1235 and #1247 made the failure legible without ever making it explicable,
 * because the number that explained it was on a host nothing asked.
 *
 * Two shapes are locked here, both found the hard way:
 *
 *   - Reading the wrong filesystem. `/` on that node is 81% used and looks
 *     fine; the daemon builds on a different mount entirely. The probe runs
 *     inside a container precisely so it cannot be pointed at the wrong path.
 *   - Treating an unmeasurable node as a healthy one. A probe that returns
 *     nothing is not evidence of space.
 *
 * The assertions run the script's own function against `df` output rather than
 * checking that the script contains a `df` call. imageBuildIsDiagnosable.test
 * .cjs records why: its first three tests asserted the shape of a capture that
 * had never captured anything, and passed for the whole life of the bug.
 *
 * See #1278.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

const rawScript = () => fs.readFileSync(SCRIPT, 'utf8');
const script = () => withoutHashComments(rawScript());

/**
 * `df -P /` as read inside a container on the node, 12 October.
 *
 * Reconstructed from the `df -h` reading taken that day - 30G size, 28G used,
 * 98M available, 100% - rather than captured verbatim, because the node is
 * powered down between runs and waking it is billable. The figures are the
 * real ones; only the block formatting is restated.
 */
const FULL_DISK = [
  'Filesystem     1024-blocks     Used Available Capacity Mounted on',
  'overlay           31457280 31356928    100352     100% /',
].join('\n');

/** The same node after `docker system prune -a --volumes`: 23G free of 30G. */
const HEALTHY_DISK = [
  'Filesystem     1024-blocks     Used Available Capacity Mounted on',
  'overlay           31457280  6187008  24117248      21% /',
].join('\n');

const SYSTEM_DF = [
  'TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE',
  'Images          21        2         18.46GB   18.24GB (98%)',
].join('\n');

/** The block of the script under test, lifted verbatim. */
function headroomSource() {
  const source = rawScript();
  const start = source.indexOf('NODE_MIN_BUILD_HEADROOM_GB=');
  const marker = 'assert_node_build_headroom() {';
  const end = source.indexOf('\n}\n', source.indexOf(marker));

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end + 3);
}

/**
 * Runs the real function with a stub `docker` ahead of any real one on PATH.
 *
 * `dfOutput` of null makes the probe produce nothing, which is the
 * unmeasurable case - a dead transport, or a disk too full to start the
 * container.
 */
function runGate({
  dfOutput,
  target = 'aws-2',
  minGb,
  dfAfterPrune,
  pruneFails = false,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-headroom-'));
  const stub = path.join(dir, 'docker');
  const pruned = path.join(dir, 'pruned');
  const reading = (output) =>
    output === null ? 'exit 1' : [`cat <<'EOF'`, output, 'EOF'].join('\n');

  fs.writeFileSync(
    stub,
    [
      '#!/usr/bin/env bash',
      'for arg in "$@"; do',
      '  if [ "$arg" = "system" ]; then',
      `    cat <<'EOF'`,
      SYSTEM_DF,
      'EOF',
      '    exit 0',
      '  fi',
      'done',
      // After `ldm_cmd system prune`, the disk reads as `dfAfterPrune` - the
      // prune having freed what it frees - or unchanged if none is given.
      `if [ -f '${pruned}' ]; then`,
      reading(dfAfterPrune === undefined ? dfOutput : dfAfterPrune),
      'fi',
      reading(dfOutput),
    ].join('\n'),
    // Set on creation rather than chmod'd after: the stub has to be
    // executable to be found on PATH as `docker`, and one call carries one
    // lint warning instead of two.
    { mode: 0o755 }
  );

  const env = {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
    LDM_NODE_TARGET: target,
  };

  if (minGb !== undefined) env.NODE_MIN_BUILD_HEADROOM_GB = String(minGb);

  try {
    const stdout = execFileSync(
      'bash',
      [
        '-c',
        [
          // The real ldm_cmd appends --node; recording the arguments it was
          // given is what lets a test count prunes and see the flags.
          `ldm_cmd() { echo "LDM-CMD: $*"; touch '${pruned}'; ${
            pruneFails ? 'return 1' : 'return 0'
          }; }`,
          headroomSource(),
          'assert_node_build_headroom',
        ].join('\n'),
      ],
      { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { status: 0, stdout };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? '' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the node is measured before it is asked to build (#1278)', () => {
  describe('reading the figure', () => {
    it('reads the available column from a full disk', () => {
      const out = runGate({ dfOutput: FULL_DISK });

      // 100352 KB is under any sane floor, so this must be the failure path.
      expect(out.status).not.toBe(0);
      expect(out.stdout).toMatch(/0GB free/);
    });

    it('reads it from a healthy disk', () => {
      const out = runGate({ dfOutput: HEALTHY_DISK });

      expect(out.status).toBe(0);
      expect(out.stdout).toMatch(/23GB free/);
    });
  });

  describe('the gate', () => {
    it('ends the run when the node cannot hold the build', () => {
      const out = runGate({ dfOutput: FULL_DISK });

      expect(out.status).not.toBe(0);
      expect(out.stdout).toMatch(/::error::/);
    });

    it('says what is holding the space and how to clear it', () => {
      // An error that stops a nightly and leaves the reader to go and find
      // out why is the failure mode this whole issue is about.
      const out = runGate({ dfOutput: FULL_DISK });

      expect(out.stdout).toMatch(/RECLAIMABLE/);
      // `ldm prune` does not exist; the command is `ldm system prune`.
      expect(out.stdout).toMatch(/ldm system prune --node aws-2/);
      expect(out.stdout).not.toMatch(/ldm prune --node/);
    });

    it('passes quietly when there is room', () => {
      const out = runGate({ dfOutput: HEALTHY_DISK });

      expect(out.status).toBe(0);
      expect(out.stdout).not.toMatch(/::error::|::warning::/);
    });

    it('warns when the margin is thin, without ending the run', () => {
      // 23GB free against a 15GB floor: above it, inside twice it.
      const out = runGate({ dfOutput: HEALTHY_DISK, minGb: 15 });

      expect(out.status).toBe(0);
      expect(out.stdout).toMatch(/::warning::/);
    });
  });

  // Nothing else frees space on the node, so it filled: 5GB, then 4GB and
  // a nightly that stopped at this gate. See #1376.
  describe('pruning before it refuses (#1376)', () => {
    const prunes = (out) =>
      (out.stdout.match(/LDM-CMD: system prune/g) || []).length;

    it('prunes a node under the floor, and continues once there is room', () => {
      const out = runGate({ dfOutput: FULL_DISK, dfAfterPrune: HEALTHY_DISK });

      expect(prunes(out)).toBe(1);
      expect(out.stdout).toMatch(/LDM-CMD: system prune -y --images/);
      expect(out.status).toBe(0);
      expect(out.stdout).toMatch(/23GB free for the build/);
      expect(out.stdout).not.toMatch(/::error::/);
    });

    it('still refuses when pruning did not free enough', () => {
      const out = runGate({ dfOutput: FULL_DISK });

      expect(prunes(out)).toBe(1);
      expect(out.status).not.toBe(0);
      expect(out.stdout).toMatch(/::error::/);
    });

    it('prunes in the warning zone too, and never fails there', () => {
      // 23GB against a 15GB floor: above it, inside twice it.
      const out = runGate({ dfOutput: HEALTHY_DISK, minGb: 15 });

      expect(prunes(out)).toBe(1);
      expect(out.status).toBe(0);
    });

    it('does not prune a node with plenty of room', () => {
      expect(prunes(runGate({ dfOutput: HEALTHY_DISK }))).toBe(0);
    });

    it('decides on the measurement, not on the prune exit status', () => {
      const healed = runGate({
        dfOutput: FULL_DISK,
        dfAfterPrune: HEALTHY_DISK,
        pruneFails: true,
      });
      expect(healed.stdout).toMatch(/::warning::Pruning 'aws-2' failed/);
      expect(healed.status).toBe(0);

      const stuck = runGate({ dfOutput: FULL_DISK, pruneFails: true });
      expect(stuck.status).not.toBe(0);
    });

    it('does not prune an unmeasurable node, or a local one', () => {
      expect(prunes(runGate({ dfOutput: null }))).toBe(0);
      expect(prunes(runGate({ dfOutput: FULL_DISK, target: 'local' }))).toBe(0);
    });
  });

  describe('what it refuses to assume', () => {
    it('does not read an unmeasurable node as a healthy one', () => {
      const out = runGate({ dfOutput: null });

      expect(out.stdout).toMatch(/::warning::/);
      expect(out.stdout).not.toMatch(/free for the build/);
    });

    it('does not end the run on a failed probe alone', () => {
      // A dead transport produces the same silence as a full disk, and only
      // one of them is proof. Ending the run on it would make a broken probe
      // indistinguishable from the defect it looks for.
      expect(runGate({ dfOutput: null }).status).toBe(0);
    });

    it('is a no-op for a local target', () => {
      const out = runGate({ dfOutput: FULL_DISK, target: 'local' });

      expect(out.status).toBe(0);
      expect(out.stdout.trim()).toBe('');
    });
  });

  describe('where it runs', () => {
    it('measures the daemon through a container, not a host path', () => {
      // `Docker Root Dir` is /mnt/docker-data/docker on aws-2 and
      // /var/lib/docker elsewhere. A hardcoded path reads the wrong mount,
      // which is how `/` at 81% was first mistaken for a healthy node.
      const source = headroomSource();

      expect(source).toMatch(/docker run --rm/);
      expect(withoutHashComments(source)).not.toMatch(/var\/lib\/docker/);
      expect(withoutHashComments(source)).not.toMatch(/mnt\/docker-data/);
    });

    it('runs before anything is spent on the node', () => {
      const text = script();
      const gate = text.indexOf('if ! assert_node_build_headroom; then');
      const ldmRun = text.indexOf('ldm_cmd "${RUN_ARGS[@]}"');

      expect(gate).toBeGreaterThan(-1);
      expect(ldmRun).toBeGreaterThan(gate);
    });

    it('runs only once the docker transport reaches the node', () => {
      // Before `route_docker_to_node`, a bare `docker` addresses the runner's
      // own daemon - which is how #1089 measured nine things about the wrong
      // machine.
      const text = script();

      expect(text.indexOf('if ! route_docker_to_node; then')).toBeLessThan(
        text.indexOf('if ! assert_node_build_headroom; then')
      );
    });
  });
});
