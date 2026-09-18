const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_SH = path.join(ROOT, 'lcp-scripts', 'deploy.sh');
const GRADLE_PROPERTIES = path.join(ROOT, 'gradle.properties');

/**
 * The shared OSGi release is pinned twice: `gradle.properties` for the local
 * workspace, and `lcp-scripts/deploy.sh` for Liferay Cloud, which is sourced by
 * the image's configure_liferay.sh and cannot read Gradle properties. Nothing
 * related the two, so a bump could land on one environment and not the other -
 * and a bundle that is absent, or built for another line, fails silently: the
 * endpoint simply 404s and only the boot log names it.
 */
function shellAssignment(name) {
  const source = fs.readFileSync(DEPLOY_SH, 'utf8');
  const match = source.match(new RegExp(`^\\s*${name}=(\\S+)\\s*$`, 'm'));

  expect(match, `deploy.sh no longer assigns ${name}`).not.toBeNull();

  return match[1];
}

function gradleProperty(name) {
  const source = fs.readFileSync(GRADLE_PROPERTIES, 'utf8');
  const match = source.match(
    new RegExp(`^${name.replace(/\./g, '\\.')}=(\\S+)\\s*$`, 'm')
  );

  expect(match, `gradle.properties no longer declares ${name}`).not.toBeNull();

  return match[1];
}

describe('the shared OSGi pin (#1023)', () => {
  it('names the same release in both places that deploy it', () => {
    expect(shellAssignment('RELEASE')).toBe(
      gradleProperty('aica.shared.osgi.release')
    );
  });

  // build.gradle ties aica.shared.osgi.dxp.line to liferay.workspace.product
  // and asserts it against the release manifest, but deploy.sh carries a third
  // copy that nothing checked.
  it('expects the same DXP line in both places that deploy it', () => {
    expect(shellAssignment('EXPECTED_DXP_LINE')).toBe(
      gradleProperty('aica.shared.osgi.dxp.line')
    );
  });

  it('runs the bundles on the line the workspace declares', () => {
    expect(gradleProperty('aica.shared.osgi.dxp.line')).toBe(
      gradleProperty('liferay.workspace.product')
    );
  });
});
