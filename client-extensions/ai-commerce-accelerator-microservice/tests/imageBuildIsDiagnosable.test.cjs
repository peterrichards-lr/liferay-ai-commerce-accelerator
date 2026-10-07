const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * A failing image build must say why, and must not float.
 *
 * Nightlies 37106009658, 37186266764 and 37280776231 all died at
 * `RUN yarn install` in the microservice image and none says why. Our compose
 * file has a `build:` section, so `compose up` builds a missing image without
 * `--build` — the build happens inside the bring-up, and in tty mode BuildKit
 * redraws one frame in place, so a captured copy keeps only the last repaint.
 *
 * THIS FILE PREVIOUSLY ENFORCED THE BUG (#1247). Its first three tests
 * asserted that the script ran `docker compose ... build` with
 * `--progress plain` BEFORE `ldm run`, and that the string
 * "build reported a failure" was present. All three passed for the whole life
 * of a capture that emitted `no configuration file provided: not found` on
 * every run and never captured a build — because LDM generates the compose
 * file DURING `ldm run`, so there was nothing to build from.
 *
 * The lesson is encoded below: asserting the SHAPE of a capture cannot tell
 * you the capture works. These tests run the capture's own check against real
 * inputs instead, and lock the two shapes that must never come back.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');
const DOCKERFILE = path.join(
  ROOT,
  'client-extensions',
  'ai-commerce-accelerator-microservice',
  'Dockerfile'
);

const rawScript = () => fs.readFileSync(SCRIPT, 'utf8');
const script = () => withoutHashComments(rawScript());
const dockerfile = () => fs.readFileSync(DOCKERFILE, 'utf8');

/** Run the script's own assertion against a log we control. */
function runAssertion(contents) {
  const source = rawScript();
  const start = source.indexOf('assert_build_output_captured() {');
  const end = source.indexOf('\n}\n', start);

  expect(start).toBeGreaterThan(-1);

  const fn = source.slice(start, end + 3);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-capture-'));
  const log = path.join(dir, 'ldm-run.txt');

  fs.writeFileSync(log, contents);

  try {
    return execFileSync(
      'bash',
      ['-c', `${fn}\nassert_build_output_captured "${log}"`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the build capture reports what actually happened (#1247)', () => {
  it('recognises a real build', () => {
    const out = runAssertion(
      '#1 [internal] load build definition from Dockerfile\n#5 DONE 0.3s\n'
    );

    expect(out).toMatch(/Build output captured/);
    expect(out).not.toMatch(/::warning::/);
  });

  it('calls a warm cache a warm cache, not a broken capture', () => {
    // The outcome the old capture could not express. A run with nothing to
    // rebuild is healthy, and reporting it as a failed capture is how a
    // reader learns to ignore the artifact.
    const out = runAssertion(
      'Pulling liferay...\nStarting Container Stack\nContainer aica-e2e Started\n'
    );

    expect(out).toMatch(/No image build this run/);
    expect(out).not.toMatch(/::warning::/);
  });

  it('warns when output arrived but carried no build lines', () => {
    // BUILDKIT_PROGRESS=plain reaching the compose child depends on LDM
    // continuing to set none of its own. True today, not a promised
    // interface — so it must be noticed, not assumed.
    expect(runAssertion('some unrelated output\n')).toMatch(/::warning::/);
  });

  it('warns when nothing was captured at all', () => {
    expect(runAssertion('')).toMatch(/::warning::/);
  });

  it('never fails the run, whatever it finds', () => {
    // Diagnostics must not become a second way for the run to die (#1238).
    // Asserted by execution: execFileSync throws on a non-zero exit, so each
    // call above already proves it, and this states it for the empty case.
    expect(() => runAssertion('')).not.toThrow();
  });
});

describe('the shapes that must not come back (#1247)', () => {
  it('does not run a second `docker compose build` of its own', () => {
    // A reproduction against a different cache state. One that SUCCEEDS while
    // the real build failed would exonerate the thing that broke.
    expect(script()).not.toMatch(/docker compose[\s\S]{0,120}\bbuild\b/);
  });

  it('does not pass --follow to ldm run', () => {
    // It looks like the fix — with --follow, LDM runs the bring-up with
    // capture_output=False and BuildKit streams through. But
    // ldm_core/pipelines/run.py:2830 then runs a DELIBERATELY UNBOUNDED
    // `compose logs -f` and returns early, skipping --no-wait. It would hang
    // the run for ever: the exact failure #1237 exists for.
    const runArgs = script().match(/RUN_ARGS=\(([\s\S]*?)\n\s*\)/);

    expect(runArgs).not.toBeNull();
    expect(runArgs[1]).not.toMatch(/(^|\s)(-f|--follow)(\s|$)/);
  });

  it('exports plain BuildKit progress before the stack starts', () => {
    const source = script();
    const exported = source.indexOf('BUILDKIT_PROGRESS=plain');
    const run = source.indexOf('Starting Liferay container with tag');

    expect(exported).toBeGreaterThan(-1);
    expect(exported).toBeLessThan(run);
  });

  it("takes ldm run's status from PIPESTATUS, not the pipeline", () => {
    // `pipefail` is not set in this script, so a teed command's pipeline
    // status is tee's and is always 0. Without this, a failed bring-up reads
    // as a successful one — worse than the missing output being fixed.
    const source = script();

    expect(source).toMatch(/ldm_run_status=\$\{PIPESTATUS\[0\]\}/);
    expect(source).toMatch(/exit "\$ldm_run_status"/);
  });
});

describe("LDM's trace log survives long enough to be copied (#1250)", () => {
  // LDM writes every shelled-out command's full stdout - including the whole
  // BuildKit build - to ~/.ldm/last-command.log, with no flag. But it opens
  // that file with "w", so EVERY `ldm` invocation truncates it, and seven run
  // after the bring-up. The copy is only correct because nothing touches ldm
  // between the two lines, which neither line shows on its own.

  // An INVOCATION, at a command position. Matching the string `ldm` anywhere
  // is how the first version of these tests failed three times over: it hit
  // the variable `ldm_run_status`, and the words "No ldm run output" inside an
  // echoed warning. Neither runs anything.
  //
  // Two positions, because the first version only checked one and a
  // perturbation walked straight through it: restoring `$(ldm --version)`
  // inside an echoed warning left all 14 tests green. A command substitution
  // is an invocation and truncates the trace exactly the same way.
  const invokesLdm = (text) =>
    text
      .split('\n')
      .some(
        (line) =>
          /^\s*(ldm|ldm_cmd)\s/.test(line) ||
          /\$\(\s*(ldm|ldm_cmd)\s/.test(line)
      );

  const RUN_CALL = 'ldm_cmd "${RUN_ARGS[@]}"';

  it('copies the trace before anything else can invoke ldm', () => {
    const source = script();
    const run = source.indexOf(RUN_CALL);
    const copy = source.indexOf('LDM_TRACE_LOG="logs/');

    expect(run).toBeGreaterThan(-1);
    expect(copy).toBeGreaterThan(run);
    expect(invokesLdm(source.slice(run + RUN_CALL.length, copy))).toBe(false);
  });

  it('is guarding against a hazard that really exists', () => {
    // Non-vacuous: ldm IS invoked after the copy - deploy, info, logs, wait,
    // configuration - so the ordering above is load-bearing rather than
    // incidentally true. If this ever fails, the guard above has stopped
    // meaning anything and should be reconsidered, not deleted.
    const source = script();
    const copy = source.indexOf('LDM_TRACE_LOG="logs/');

    expect(invokesLdm(source.slice(copy))).toBe(true);
  });

  it('runs no ldm command inside the build-output assertion', () => {
    // The first version ended with `ldm --version` in its warning branch,
    // truncating the trace log in the exact case where the build output was
    // missing and most wanted - a diagnostic destroying its own evidence.
    const source = script();
    const start = source.indexOf('assert_build_output_captured() {');
    const end = source.indexOf('\n}\n', start);

    expect(start).toBeGreaterThan(-1);
    expect(invokesLdm(source.slice(start, end))).toBe(false);
  });

  it('reads the trace copy as well as the teed stdout', () => {
    expect(script()).toMatch(/logs\/e2e-ldm-trace\.txt/);
  });
});

describe('the base image does not float (#1235)', () => {
  it('is pinned by digest, not a tag', () => {
    const from = dockerfile().match(/^FROM\s+(\S+)/m);

    expect(from).not.toBeNull();
    expect(from[1]).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(from[1]).not.toMatch(/:latest$/);
  });
});
