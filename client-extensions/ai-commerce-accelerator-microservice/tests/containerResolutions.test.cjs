const fs = require('node:fs');
const path = require('node:path');

/**
 * The image installs from the ROOT `yarn.lock` and the MICROSERVICE
 * `package.json`, because that is what `client-extension.yaml` assembles:
 * `from: ../..` carries the lockfile and nothing else. Inside the container
 * the microservice manifest IS the project root, and yarn honours
 * `resolutions` only at the project root.
 *
 * So an override declared only at the repository root is silently void in the
 * image. Yarn does not fail on it - it reports
 * `Lockfile has incorrect entry for "uuid@^8.3.2". Ignoring it.` and resolves
 * fresh from the registry. That is how the image came to ship `uuid@8.3.2`
 * while CI tested `11.1.1`, with Dependabot alert #181 (`< 11.1.1`) showing as
 * fixed the whole time. See #1277.
 *
 * Duplicating the block is inert at the workspace root - measured: yarn.lock
 * untouched, `--frozen-lockfile` still passes - and decisive in the container.
 * This test is what keeps the copy honest.
 */

const MICROSERVICE_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MICROSERVICE_DIR, '../..');

const readResolutions = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    .resolutions ?? {};

/** Keys the container would resolve differently from the repository root. */
function overridesLostInTheContainer(root, container) {
  return Object.entries(root)
    .filter(([name, range]) => container[name] !== range)
    .map(
      ([name, range]) =>
        `${name}: root wants ${range}, container has ${container[name] ?? 'nothing'}`
    );
}

describe('resolutions survive into the container (#1277)', () => {
  const root = readResolutions(REPO_ROOT);
  const container = readResolutions(MICROSERVICE_DIR);

  it('has something to check, so this cannot pass vacuously', () => {
    expect(Object.keys(root).length).toBeGreaterThan(0);
  });

  it('carries every root override into the manifest the image installs from', () => {
    expect(overridesLostInTheContainer(root, container)).toEqual([]);
  });

  it('declares no override the root does not, which would diverge the image', () => {
    expect(overridesLostInTheContainer(container, root)).toEqual([]);
  });

  // The perturbation. Without these, the two cases above would pass just as
  // happily against a comparison that always returns [].
  it('reports an override the container is missing', () => {
    expect(overridesLostInTheContainer({ uuid: '^11.1.1' }, {})).toEqual([
      'uuid: root wants ^11.1.1, container has nothing',
    ]);
  });

  it('reports an override the container pins differently', () => {
    expect(
      overridesLostInTheContainer({ undici: '^7.28.0' }, { undici: '^8.0.0' })
    ).toEqual(['undici: root wants ^7.28.0, container has ^8.0.0']);
  });
});
