const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

/**
 * A green run must keep its captures.
 *
 * `e2e-verification.yml` uploaded the log artifact `if: failure()`, so a
 * passing run kept nothing. That was tolerable while every run was red, and it
 * was guaranteed to bite exactly once - on the first green run, which is the
 * one worth reading, because every capture we hold describes a broken stack and
 * there is nothing to compare them against. See #1169.
 *
 * Parsed rather than pattern-matched: a comment mentioning `if: always()` would
 * satisfy a grep, which is the defect class #1172 covers. This asserts the
 * structure the runner actually reads.
 */
const WORKFLOW = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'e2e-verification.yml'
);

const steps = () => {
  const doc = YAML.parse(fs.readFileSync(WORKFLOW, 'utf8'));
  const job = doc.jobs['e2e-verification'] || Object.values(doc.jobs)[1];
  return job.steps;
};

const uploadNamed = (fragment) =>
  steps().find(
    (step) =>
      typeof step.uses === 'string' &&
      step.uses.startsWith('actions/upload-artifact') &&
      String(step.with?.name || '').includes(fragment)
  );

const pathsOf = (step) =>
  String(step.with.path)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

describe('a green run keeps its logs (#1169)', () => {
  it('uploads the captures whatever the outcome', () => {
    const step = uploadNamed('e2e-logs-shard');

    expect(step).toBeDefined();
    // The line that would have to change for this to fail, and the exact
    // value that shipped for months.
    expect(step.if).toBe('always()');
    expect(pathsOf(step)).toContain('logs/');
  });

  it('keeps the traces on failure only, where the 57MB is', () => {
    const step = uploadNamed('e2e-playwright-shard');

    expect(step).toBeDefined();
    expect(step.if).toBe('failure()');
    expect(pathsOf(step)).toContain('playwright-report/');
  });

  it('does not put the captures behind the failure condition', () => {
    // Splitting them and then leaving `logs/` in the failure-only artifact
    // would satisfy both cases above and change nothing.
    expect(pathsOf(uploadNamed('e2e-playwright-shard'))).not.toContain('logs/');
  });

  it('loses no path in the split', () => {
    // test-results/ sits between the two groups and could fall out of both.
    const everything = [
      ...pathsOf(uploadNamed('e2e-logs-shard')),
      ...pathsOf(uploadNamed('e2e-playwright-shard')),
    ];

    for (const original of [
      'logs/',
      'client-extensions/*/logs/',
      'test-results/',
      'playwright-report/',
    ]) {
      expect(everything).toContain(original);
    }
  });
});
