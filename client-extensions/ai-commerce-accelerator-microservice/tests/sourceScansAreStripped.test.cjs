const fs = require('node:fs');
const path = require('node:path');

const {
  withoutHashComments,
  withoutSlashComments,
} = require('./fixtures/sourceComments.cjs');

/**
 * A guard that scans source must not be able to read prose as code.
 *
 * `tests/fixtures/sourceComments.cjs` is the answer; this is what makes the
 * next guard use it. The flaw was fixed five times in the guard that happened
 * to fail - #1072/#1073 twice, #1171, #1173 - and the later occurrences were
 * written by people who had read the earlier fixes. A shared helper nobody is
 * obliged to reach for is the same defect with one more step in it (#1172).
 *
 * Scoped to the `#`-comment sources, because that is where every recorded
 * occurrence happened: `scripts/run-e2e-ldm.sh` and the workflow YAML. The
 * JavaScript scans were brought in by audit in the same change; discovering
 * those automatically means recognising "reads a module as text" apart from
 * the many tests that simply require it, and a loose net here would be its own
 * kind of wrong guard.
 *
 * The exemption is deliberately a list with reasons rather than a heuristic.
 * A new text scan has to either strip or write down why it does not, and
 * neither is something you do by accident.
 */
const TESTS = __dirname;

const HASH_SOURCE = /run-e2e-ldm\.sh|'workflows'/;

const sourceOf = (file) => fs.readFileSync(path.join(TESTS, file), 'utf8');

/**
 * The discovery strips the *test's own* comments before looking.
 *
 * Without that it finds `healthCheckTarget.test.cjs`, which names the script
 * only to say which host it deliberately does not use - a guard about comments
 * that is itself fooled by one. The joke would write itself.
 */
const readsHashSource = (file) =>
  HASH_SOURCE.test(withoutSlashComments(sourceOf(file)));

/**
 * The call, not the import.
 *
 * Matching the bare name passes on `const { withoutHashComments } = require(...)`
 * with every use deleted - a guard satisfied by a declaration instead of a
 * comment, which is the same hole wearing different clothes. Found by
 * perturbing a reader to drop the call and watching this stay green.
 */
const stripsComments = (file) =>
  /withoutHashComments\s*\(/.test(withoutSlashComments(sourceOf(file)));

// Files that read one of those sources but never match against its text: they
// slice a fragment out and execute it, or parse the document and assert on the
// result. Stripping would be harmless, and is not what protects them.
const MATCHES_BEHAVIOUR_NOT_TEXT = new Map([
  ['e2eShardPlan.test.cjs', 'extracts the shard-plan step and runs it'],
  ['e2eTargetAgreement.test.cjs', 'extracts the agreement step and runs it'],
  ['ldmNodeTarget.test.cjs', 'extracts `ldm_cmd` and runs it against a stub'],
  [
    'greenRunKeepsItsLogs.test.cjs',
    'parses the workflow and asserts on the parsed upload paths',
  ],
]);

/**
 * This file names those sources in a pattern and in the synthetic fixture
 * below, neither of which is a read, so it would otherwise flag itself. The
 * exclusion is by exact filename rather than a rule, because "the guard is
 * exempt from the guard" is the kind of thing that should take one name and
 * no cleverness.
 */
const SELF = path.basename(__filename);

const readers = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.cjs') && f !== SELF)
  .filter(readsHashSource)
  .sort();

describe('source scans cannot be satisfied or failed by a comment (#1172)', () => {
  test('the scan finds the files it is supposed to', () => {
    // Twenty-five today. An empty or halved list would make every case below
    // pass by finding nothing - #1073's lesson, which is this file's subject.
    expect(readers.length).toBeGreaterThanOrEqual(20);
    expect(readers).toContain('microserviceDiagnosticsCaptured.test.cjs');
    expect(readers).toContain('proxyDiagnosticsCaptured.test.cjs');
  });

  test('the only file exempt from discovery is this one', () => {
    // A second name here would be someone widening the exemption rather than
    // classifying their guard.
    expect(SELF).toBe('sourceScansAreStripped.test.cjs');
    expect(readers).not.toContain(SELF);
  });

  test('naming the script in a comment is not reading it', () => {
    // Synthetic rather than pointing at a real file, so this cannot quietly
    // stop testing anything when that file's comment is reworded.
    const prose = '// scripts/run-e2e-ldm.sh does the capture\nconst x = 1;\n';

    expect(HASH_SOURCE.test(prose)).toBe(true);
    expect(HASH_SOURCE.test(withoutSlashComments(prose))).toBe(false);
  });

  test.each(readers)('%s strips, or says why it need not', (file) => {
    if (MATCHES_BEHAVIOUR_NOT_TEXT.has(file)) return;

    expect(
      stripsComments(file),
      `${file} reads a '#'-commented source. Scan it through ` +
        `withoutHashComments from tests/fixtures/sourceComments.cjs, or add it ` +
        `to MATCHES_BEHAVIOUR_NOT_TEXT here with the reason it matches ` +
        `behaviour rather than text.`
    ).toBe(true);
  });

  test('no exemption outlives the file it exempts', () => {
    // A stale entry is a hole: the name stays, a rewritten file starts text
    // scanning, and the exemption covers it without anyone deciding so.
    for (const [file, reason] of MATCHES_BEHAVIOUR_NOT_TEXT) {
      expect(fs.existsSync(path.join(TESTS, file)), `${file} is gone`).toBe(
        true
      );
      expect(readers, `${file} no longer reads one`).toContain(file);
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  test('the exemption has not become the rule', () => {
    const stripping = readers.filter((f) => stripsComments(f));

    expect(stripping.length).toBeGreaterThanOrEqual(
      MATCHES_BEHAVIOUR_NOT_TEXT.size * 4
    );
  });

  test('the strippers are the shared ones, not local copies', () => {
    // Two of these files hand-rolled their own filter before #1172, and that
    // is how the class survived being fixed three times.
    const localFilter = /startsWith\(\s*['"]#['"]\s*\)/;

    for (const file of readers) {
      expect(
        localFilter.test(withoutSlashComments(sourceOf(file))),
        `${file} hand-rolls comment stripping; use the shared helper`
      ).toBe(false);
    }
  });
});
