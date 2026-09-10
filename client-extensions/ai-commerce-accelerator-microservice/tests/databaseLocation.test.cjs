const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Where the workflow database lives (#868, #869).
 *
 * It has been destroyed twice by ordinary tooling: SDK #175, resolving inside
 * node_modules where every install removed it; then #868, `gradle clean`
 * removing it beside build/ and dist/ and taking a completed UAT run with it.
 *
 * These assert the two halves of the fix on the artefacts themselves, because
 * both live outside the JavaScript the rest of the suite covers - one is a
 * Gradle task, the other runs before any import.
 */
describe('The workflow database location', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  it('is not deleted by the microservice clean task', () => {
    const gradle = fs.readFileSync(path.join(repoRoot, 'build.gradle'), 'utf8');

    // build and dist are reproducible; a session is an hour of paid,
    // non-deterministic generation. Deleting them together is the defect.
    expect(gradle).not.toContain("delete 'data/workflows.db'");
    expect(gradle).not.toContain("delete 'data/workflows.json'");
    expect(gradle).toContain("delete 'build'");
    expect(gradle).toContain("delete 'dist'");
  });

  it('defaults outside the repository, before the SDK is required', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '../server.cjs'),
      'utf8'
    );

    // The SDK reads process.env when its constants are first required, so the
    // default has to be set before any SDK import - not in utils/constants.cjs.
    const dbBlock = server.indexOf('PERSISTENCE_DB_PATH');
    const firstSdkRequire = server.indexOf('@liferay/accelerator-sdk');

    expect(dbBlock).toBeGreaterThan(-1);
    if (firstSdkRequire > -1) {
      expect(dbBlock).toBeLessThan(firstSdkRequire);
    }

    expect(server).toContain('os.homedir()');
    expect(server).toContain("'.aica'");
  });

  it('lets an explicit path win, so a deployment can use a mounted volume', () => {
    const server = fs.readFileSync(
      path.join(__dirname, '../server.cjs'),
      'utf8'
    );

    // The guard is what makes this a default rather than an override.
    expect(server).toContain('if (!process.env.PERSISTENCE_DB_PATH)');
  });

  it('resolves to an absolute path the SDK keeps, and stays :memory: under test', () => {
    const {
      resolveDbPath,
    } = require('@liferay/accelerator-sdk/src/utils/dbPath.cjs');
    const home = path.join(os.homedir(), '.aica', 'data', 'workflows.db');

    expect(resolveDbPath(home, 'development')).toBe(home);
    // Tests must never touch the real database, whatever the default says.
    expect(resolveDbPath(home, 'test')).toBe(':memory:');
  });
});
