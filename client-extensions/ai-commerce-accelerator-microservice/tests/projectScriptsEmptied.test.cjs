const fs = require('node:fs');
const path = require('node:path');
const { withoutHashComments } = require('./fixtures/sourceComments.cjs');

/**
 * `ldm import .` copies this repository's scripts/ into the project, and
 * Liferay runs every script in /mnt/liferay/scripts at boot. The E2E empties
 * the project's copy, so none of our tooling runs inside Liferay. See #1365.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = withoutHashComments(fs.readFileSync(SCRIPT, 'utf8'));
const EMPTY = 'find "${PROJECT_NAME:?}/scripts" -mindepth 1 -delete';

describe("the project's scripts/ is emptied before Liferay boots (#1365)", () => {
  it('empties the contents and keeps the directory LDM mounts', () => {
    expect(source).toContain(EMPTY);
  });

  it('runs after ldm import, which is what copies the tooling in', () => {
    expect(source.indexOf(EMPTY)).toBeGreaterThan(
      source.indexOf('ldm_cmd import .')
    );
  });

  it('runs before the stack starts', () => {
    expect(source.indexOf(EMPTY)).toBeLessThan(
      source.indexOf('Starting Liferay container with tag')
    );
  });

  it('cannot reach /scripts when the project name is empty', () => {
    // `${PROJECT_NAME:?}` aborts on an empty name instead of expanding the
    // target to /scripts.
    expect(source).not.toMatch(/find "\$PROJECT_NAME\/scripts"/);
  });
});
