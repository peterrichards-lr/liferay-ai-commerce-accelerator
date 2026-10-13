const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * A bring-up that was still working must not be reported as a broken Liferay.
 *
 * Run 36833980419 died with `dependency failed to start: container aica-e2e is
 * unhealthy`, and Liferay's console log for that run has **zero** errors. It
 * shows `BundleSiteInitializer` mid-run and
 * `Invoking addLayoutPageTemplates took 7156 ms` as its last line, with
 * compose giving up twenty seconds later. The gate is about one
 * site-initialiser step wide: 5m53s cleared it on 30 September and 7m17s did
 * not on 1 October, same commit, same LDM, same node.
 *
 * #1218 deliberately proposes no new timeout, because raising one until the
 * symptom stops is how a margin gets re-consumed by the next slow step. Two
 * of its three acceptance criteria are what this covers:
 *
 *   - the failure message distinguishes "still initialising" from "failed"
 *   - boot duration is recorded per run, so the margin is observable rather
 *     than discovered when it is exceeded
 *
 * The third - not killing a bring-up that is still making progress - needs the
 * distribution this recording produces, and is not attempted here.
 *
 * The classification runs against captured log text rather than being inferred
 * from the shape of the script, for the reason imageBuildIsDiagnosable.test
 * .cjs records: asserting that a capture exists cannot tell you it works.
 */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'run-e2e-ldm.sh');

const rawScript = () => fs.readFileSync(SCRIPT, 'utf8');
const script = () => withoutHashComments(rawScript());

/** The compose gate's own signature, as LDM relays it. */
const GATE_FIRED = [
  ' Container aica-e2e-db  Healthy',
  ' Container aica-e2e     Started',
  ' Container aica-e2e     Waiting',
  ' Container aica-e2e     Error',
  'dependency failed to start: container aica-e2e is unhealthy',
].join('\n');

/**
 * Liferay's log from run 36833980419, at the moment it was killed.
 *
 * The three lines quoted on #1218, which is all that is needed: progress, and
 * nothing resembling an error.
 */
const STILL_INITIALISING = [
  '08:14:13.563 INFO  [main][BundleSiteInitializer:264] Invoking addFragmentEntries took 1786 ms',
  '08:14:20.721 INFO  [main][BundleSiteInitializer:264] Invoking addLayoutPageTemplates took 7156 ms',
].join('\n');

/** A Liferay that genuinely failed, rather than one that ran out of time. */
const ACTUALLY_BROKEN = [
  '08:14:13.563 INFO  [main][BundleSiteInitializer:264] Invoking addFragmentEntries took 1786 ms',
  '08:14:19.002 ERROR [main][PortalInstanceLifecycleListener:67] com.liferay.portal.kernel.exception.SystemException',
  '08:14:19.100 SEVERE [main][ModuleFrameworkImpl:1583] Exception while starting framework',
].join('\n');

function extract(name) {
  const source = rawScript();
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);

  expect(start).toBeGreaterThan(-1);

  return source.slice(start, end + 3);
}

/** Runs the real classifier against two logs we control. */
function classify(ldmLog, liferayLog) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bringup-'));
  const ldm = path.join(dir, 'ldm-run.txt');
  const liferay = path.join(dir, 'liferay.log');

  fs.writeFileSync(ldm, ldmLog);
  fs.writeFileSync(liferay, liferayLog);

  try {
    return execFileSync(
      'bash',
      [
        '-c',
        `set -eu\n${extract(
          'classify_bringup_failure'
        )}\nclassify_bringup_failure "${ldm}" "${liferay}"\necho "SURVIVED"`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('a bring-up that ran out of time says so (#1218)', () => {
  it('names a killed-but-working Liferay as timing, not failure', () => {
    const out = classify(GATE_FIRED, STILL_INITIALISING);

    expect(out).toMatch(/did not fail to start - it ran out of time/);
    expect(out).toContain('#1218');
  });

  it('quotes the last thing it managed to do', () => {
    // Without this the reader is told it ran out of time and given nothing
    // to judge how close it came.
    const out = classify(GATE_FIRED, STILL_INITIALISING);

    expect(out).toMatch(/addLayoutPageTemplates took 7156 ms/);
  });

  it('says a genuinely broken Liferay is broken', () => {
    // The opposite error, and the more dangerous one: a real failure dressed
    // as a timing problem sends the reader to the wrong issue entirely.
    const out = classify(GATE_FIRED, ACTUALLY_BROKEN);

    expect(out).toMatch(/failed during bring-up/);
    expect(out).not.toMatch(/ran out of time/);
  });

  it('stays silent on a bring-up failure that is not the gate', () => {
    // An image build failure is a different question and must not be dressed
    // as this one.
    const out = classify(
      'failed to solve: process "/bin/sh -c yarn install" did not complete successfully',
      STILL_INITIALISING
    );

    expect(out).not.toMatch(/ran out of time|failed during bring-up/);
    expect(out).toContain('SURVIVED');
  });

  it('distinguishes an uncaptured log from a healthy one', () => {
    // An empty log is not evidence Liferay was fine, and reporting it as
    // timing would invent a diagnosis from an absence.
    const out = classify(GATE_FIRED, '');

    expect(out).toMatch(/::warning::/);
    expect(out).not.toMatch(/ran out of time/);
  });

  it('cannot fail the run, whatever it finds', () => {
    // #1238: a diagnostic must not become a second way for the run to die.
    for (const liferayLog of [STILL_INITIALISING, ACTUALLY_BROKEN, '']) {
      expect(classify(GATE_FIRED, liferayLog)).toContain('SURVIVED');
    }
  });
});

describe('the bring-up duration is recorded every run (#1218)', () => {
  it('records a cleared bring-up as well as a failed one', () => {
    // A distribution made only of failures says nothing about the margin,
    // and one made only of successes says nothing about where it was
    // exceeded. #1218 needs both or it needs neither.
    const text = script();

    expect(text).toMatch(
      /record_bringup_duration "\$bringup_seconds" "failed"/
    );
    expect(text).toMatch(
      /record_bringup_duration "\$bringup_seconds" "cleared"/
    );
  });

  it('measures the call the gate is actually racing', () => {
    const text = script();
    const started = text.indexOf('bringup_started=$SECONDS');
    const run = text.indexOf('ldm_cmd "${RUN_ARGS[@]}"');
    const stopped = text.indexOf(
      'bringup_seconds=$((SECONDS - bringup_started))'
    );

    expect(started).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(started);
    expect(stopped).toBeGreaterThan(run);
  });

  it('writes somewhere the artifact will carry', () => {
    // logs/ is what the workflow uploads. A figure recorded only to the step
    // log expires with the run, which is the whole problem #1218 describes.
    expect(script()).toMatch(/BOOT_DURATION_LOG="logs\/[^"]+"/);
  });

  it('cannot fail the run if the figure cannot be written', () => {
    const source = withoutHashComments(extract('record_bringup_duration'));

    expect(source).toMatch(/\|\| true/);
  });
});
