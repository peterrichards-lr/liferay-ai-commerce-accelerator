const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * The step that runs the E2E must not be able to run unbounded.
 *
 * It had no `timeout-minutes`, so nothing ended a stall. Two runs proved it:
 * 37435455079 ran 108 minutes and 37590585149 ran 199, and both stopped only
 * because a person cancelled them. Five hours of runner time between them.
 *
 * The cost is not the minutes. A cancel kills run-e2e-ldm.sh mid-step, so
 * none of its teardown captures run - 37435455079's e2e-logs artifact was
 * 166 bytes, against 347 KB for a run that failed normally at 42 minutes. The
 * most expensive runs produced the least evidence, which is the opposite of
 * what anyone debugging them needed. See #1246.
 *
 * The workflow is parsed rather than scanned as text, but a `run:` block is
 * still shell, and its body is matched below to find the step. The first
 * version of that predicate matched two steps: this one, and "Wake remote
 * target node", whose script mentions run-e2e-ldm.sh only in a comment
 * explaining how its own 3h bound relates to the nightly. A guard satisfied
 * by prose, written one commit after #1172 generalised the fix for exactly
 * that - which is the argument for the shared stripper rather than care.
 */
const WORKFLOWS = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows'
);

const doc = YAML.parse(
  fs.readFileSync(path.join(WORKFLOWS, 'e2e-verification.yml'), 'utf8')
);

const steps = Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []);

// By what the step DOES, not by its name. A second step invoking the script,
// or a rename, is covered without anyone remembering this file exists.
const e2eSteps = steps.filter((step) =>
  /run-e2e-ldm\.sh/.test(withoutHashComments(step?.run ?? ''))
);

/**
 * The window the bound has to sit in, measured from the runs above rather
 * than chosen. Step durations, not job durations - the job is 3-4 minutes
 * longer and the bound applies to the step.
 */
const LONGEST_REAL_STEP = 39;
const SHORTEST_HANG = 108;

describe('the E2E step is bounded (#1246)', () => {
  test('the scan found the step it is supposed to bound', () => {
    // Without this, a rename or a restructured workflow would empty the list
    // and every case below would pass by checking nothing (#1073).
    expect(steps.length).toBeGreaterThan(10);
    expect(e2eSteps).toHaveLength(1);

    // A rename is a legitimate change and should cost one line here, not a
    // puzzle. The bound itself is found by what the step runs, so the cases
    // below survive a rename - this one exists to say which step is meant.
    expect(
      e2eSteps[0].name,
      'The step running the E2E has been renamed. That is fine - update this ' +
        'expectation. The bound is found by what the step runs, not its name.'
    ).toMatch(/Start LDM/);
  });

  test.each(e2eSteps.map((s) => [s.name, s]))(
    '%s carries a timeout',
    (_name, step) => {
      expect(
        step['timeout-minutes'],
        'A step running the E2E with no timeout-minutes can only be ended by a ' +
          'human; runs 37435455079 and 37590585149 ran 108 and 199 minutes.'
      ).toBeGreaterThan(0);
    }
  );

  test.each(e2eSteps.map((s) => [s.name, s]))(
    '%s is bounded above the longest real run and below the hangs',
    (_name, step) => {
      const bound = step['timeout-minutes'];

      // Tighter than the longest legitimate step would be a new failure mode:
      // a cold image build with no layer cache is the real worst case, and a
      // bound that fires during a slow-but-real build is worse than no bound.
      expect(bound).toBeGreaterThan(LONGEST_REAL_STEP);

      // Looser than the shortest observed hang would not have caught either
      // of the two runs this exists for.
      expect(bound).toBeLessThan(SHORTEST_HANG);
    }
  );

  test('the measurements the bound was sized against are written down', () => {
    // Not the prose - the run IDs. The next person changing this number
    // should be able to re-measure rather than re-guess, and an issue
    // reference alone does not survive the issue being closed.
    const source = fs.readFileSync(
      path.join(WORKFLOWS, 'e2e-verification.yml'),
      'utf8'
    );

    expect(source).toContain('37435455079');
    expect(source).toContain('37590585149');
  });
});
