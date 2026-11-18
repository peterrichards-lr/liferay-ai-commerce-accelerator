const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * `deploy.sh` must not stage the shared bundles into a portal on another DXP
 * line.
 *
 * Its manifest check compares each bundle's `dxpLine` with
 * `EXPECTED_DXP_LINE`, and both come from this repo - #1485 moved them to
 * Q4.0 together. So a Liferay Cloud environment still running a Q3.0 image
 * passed it, and would have staged bundles that cannot resolve there: the
 * endpoints 404 and only the boot log says why. The portal's own line is read
 * from `portal-impl.jar`, as `build.gradle` does for a local bundle. See #1486.
 *
 * The script is sourced exactly as `configure_liferay.sh` sources it, with
 * `curl` replaced by a stub that records what was asked for and fails, so
 * nothing reaches the network and "modules were attempted" is observable.
 */
const DEPLOY_SH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'lcp-scripts',
  'deploy.sh'
);

function expectedLine() {
  const match = fs
    .readFileSync(DEPLOY_SH, 'utf8')
    .match(/^\s*EXPECTED_DXP_LINE=(\S+)\s*$/m);

  return match[1];
}

function portalImplJar(dir, displayName) {
  const staging = path.join(dir, 'jar');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(path.join(staging, 'META-INF'), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(
    path.join(staging, 'META-INF', 'MANIFEST.MF'),
    'Manifest-Version: 1.0\r\n' +
      'Liferay-Portal-Version: 7.4.13\r\n' +
      `Liferay-Portal-Version-Display-Name: ${displayName}\r\n\r\n`
  );

  const jar = path.join(dir, 'portal-impl.jar');
  execFileSync('zip', ['-q', '-r', jar, 'META-INF'], { cwd: staging });

  return jar;
}

function source({ jar }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-sh-'));
  const bin = path.join(dir, 'bin');
  const curlLog = path.join(dir, 'curl.log');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(bin);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.writeFileSync(
    path.join(bin, 'curl'),
    `#!/bin/sh\necho "$@" >> "${curlLog}"\nexit 22\n`,
    { mode: 0o755 }
  );

  const portalJar = jar ? jar(dir) : path.join(dir, 'absent.jar');

  // `set -u` after sourcing is the check that matters to the caller: a leak
  // of it crash-loops configure_liferay.sh on its own unset variables.
  const result = spawnSync(
    'bash',
    [
      '-c',
      `source "${DEPLOY_SH}"; status=$?; echo "status=$status"; echo "flags=$-"`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TMPDIR: path.join(dir, 'tmp'),
        DEPLOYDIR: path.join(dir, 'deploy'),
        PORTAL_IMPL_JAR: portalJar,
      },
    }
  );

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const curled = fs.existsSync(curlLog) ? fs.readFileSync(curlLog, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });

  return { stdout: result.stdout, curled };
}

function displayNameOf(line) {
  // dxp-2026.q4.0 -> 2026.Q4.0, the spelling the image's manifest uses.
  return line.replace(/^dxp-/, '').replace(/q/, 'Q');
}

describe('deploy.sh against the portal it runs in (#1486)', () => {
  it('stages the modules when the portal runs the pinned line', () => {
    const line = displayNameOf(expectedLine());
    const { stdout, curled } = source({
      jar: (dir) => portalImplJar(dir, line),
    });

    expect(stdout).toContain(`Portal runs ${line}`);
    expect(curled).toContain('/modules.json');
    expect(stdout).toContain('status=0');
  });

  it('stages nothing on a portal from another line, and lets the boot continue', () => {
    const { stdout, curled } = source({
      jar: (dir) => portalImplJar(dir, '2026.Q3.0'),
    });

    expect(stdout).toContain('ERROR: this portal runs 2026.Q3.0');
    expect(stdout).toContain('No modules deployed');
    expect(curled).toBe('');
    expect(stdout).toContain('status=0');
    expect(stdout).not.toMatch(/flags=\S*[eu]/);
  });

  it('carries on unchecked when the portal line cannot be read', () => {
    const { stdout, curled } = source({ jar: null });

    expect(stdout).toContain("WARNING: cannot read the portal's DXP line");
    expect(curled).toContain('/modules.json');
    expect(stdout).toContain('status=0');
  });
});
