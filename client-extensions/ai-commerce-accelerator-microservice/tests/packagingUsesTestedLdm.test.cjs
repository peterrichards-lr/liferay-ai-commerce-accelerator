const fs = require('node:fs');
const path = require('node:path');

/**
 * The release artifact must be built by the LDM the E2E verifies with.
 *
 * `package-ldmp.yml` installed LDM from `releases/latest/download`, and
 * GitHub's `latest` skips pre-releases - so it pinned, in effect, to the
 * newest stable while `e2e-verification.yml` used `vars.LDM_VERSION`. On
 * 2026-09-25 that was v2.25.0 against v2.26.0-pre.1.
 *
 * The packaging step runs LDM itself, so the `.ldmp` a customer downloads was
 * produced by a binary the E2E had never exercised, and a green nightly was
 * evidence about a different binary. Neither workflow said so. See #1148.
 *
 * This asserts the two agree on how they resolve it, rather than asserting a
 * particular version - a version would rot the moment the variable moved.
 */
const WORKFLOWS = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '.github',
  'workflows'
);

const read = (name) => fs.readFileSync(path.join(WORKFLOWS, name), 'utf8');

describe('packaging and verification use the same LDM (#1148)', () => {
  test('both resolve it from vars.LDM_VERSION', () => {
    for (const name of ['package-ldmp.yml', 'e2e-verification.yml']) {
      expect(read(name), `${name} should read vars.LDM_VERSION`).toMatch(
        /vars\.LDM_VERSION/
      );
    }
  });

  test('packaging does not reach for latest unconditionally', () => {
    const body = read('package-ldmp.yml');
    const installStep = body.slice(
      body.indexOf('Install Liferay Docker Manager'),
      body.indexOf('Setup Node.js')
    );

    // `latest` is still the fallback when the variable is unset, which is
    // correct. What must not come back is reaching for it directly, because
    // that silently means "newest stable" rather than "what we tested".
    const unconditional = installStep
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .filter((line) => line.includes('releases/latest/download'))
      .filter((line) => !line.includes('DOWNLOAD_URL='));

    expect(unconditional).toEqual([]);
  });

  test('the resolved version reaches the job log', () => {
    // The original failure mode was silence: nothing said which LDM built the
    // artifact, so the mismatch was invisible for months rather than wrong
    // in a way anyone could see.
    const body = read('package-ldmp.yml');
    const installStep = body.slice(
      body.indexOf('Install Liferay Docker Manager'),
      body.indexOf('Setup Node.js')
    );

    expect(installStep).toMatch(/echo .*LDM_VER|ldm --version/);
  });
});
