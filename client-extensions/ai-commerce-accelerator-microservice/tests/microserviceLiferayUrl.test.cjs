const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * The microservice must be given a Liferay URL it cannot otherwise obtain.
 *
 * The SDK resolves one from four sources. Inside an LDM-run container all four
 * are empty: the LXC config trees the colocated builder reads are declared but
 * never mounted (liferay-docker-manager#1911), and host environment forwarding
 * does not reach a client-extension container at all (#1903).
 *
 * The consequence is not "no configuration". Liferay's /o/<cx>/ proxy forwards
 * an authenticated caller with a bearer token, and verifying that token needs
 * the URL:
 *
 *     verifyBearerToken(token, resolveLiferayUrl(req))
 *       .then((claims) => { req.user = { token, claims }; next(); })
 *
 * No URL, no req.user, and every request falls through to a signing
 * requirement it was meant to be exempt from - reported as "Missing required
 * request-signing headers", which names the fallback rather than the failure
 * (#1109).
 *
 * An extension's own LCP.json `env` block is read directly by LDM's compose
 * builder (`env_vars = ext.get("env", {})`), so it bypasses the forwarding
 * path and its blacklist entirely. That is the mechanism used here.
 */
const SCRIPT = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'run-e2e-ldm.sh'
);
const source = fs.readFileSync(SCRIPT, 'utf8');

function functionSource(name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.trim().startsWith(`${name}() {`));

  if (start === -1) throw new Error(`${name}() not found`);

  const indent = lines[start].search(/\S/);
  const end = lines.findIndex(
    (l, i) => i > start && l.search(/\S/) === indent && l.trim() === '}'
  );

  return lines.slice(start, end + 1).join('\n');
}

function inject({
  url = 'https://aica-e2e.demo',
  manifest = { env: { PORT: '3001' } },
  withManifest = true,
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcp-'));
  const cxDir = path.join(dir, 'proj', 'osgi', 'client-extensions');

  fs.mkdirSync(cxDir, { recursive: true });

  const stage = path.join(dir, 'stage');

  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(stage, 'other.txt'), 'x');
  if (withManifest) {
    fs.writeFileSync(
      path.join(stage, 'LCP.json'),
      JSON.stringify(manifest, null, 2)
    );
  }

  const zip = path.join(cxDir, 'ai-commerce-accelerator-microservice.zip');

  execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: stage });

  const stdout = execFileSync(
    'bash',
    [
      '-c',
      `${functionSource('inject_liferay_url_into_microservice')}\ninject_liferay_url_into_microservice`,
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        PROJECT_NAME: 'proj',
        LIFERAY_API_URL: url,
      },
    }
  );

  let env = null;

  if (withManifest) {
    env = JSON.parse(
      execFileSync('unzip', ['-p', zip, 'LCP.json'], { encoding: 'utf8' })
    ).env;
  }

  const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  return { stdout, env, names };
}

describe('the microservice is handed its Liferay URL', () => {
  it('declares LIFERAY_API_URL in the shipped manifest', () => {
    expect(inject().env.LIFERAY_API_URL).toBe('https://aica-e2e.demo');
  });

  it('keeps everything the manifest already declared', () => {
    // LIFERAY_ROUTES_* and PORT are what the container actually receives
    // today; losing them would trade one outage for another.
    const { env } = inject({
      manifest: {
        env: {
          PORT: '3001',
          LIFERAY_ROUTES_DXP: '/etc/liferay/lxc/dxp-metadata',
        },
      },
    });

    expect(env.PORT).toBe('3001');
    expect(env.LIFERAY_ROUTES_DXP).toBe('/etc/liferay/lxc/dxp-metadata');
  });

  it('leaves the rest of the archive intact', () => {
    expect(inject().names).toContain('other.txt');
  });

  it('takes the value from TARGET_URL, never a literal', () => {
    // A second source for the same fact is how the plan and the target came to
    // disagree in #1081. export_target_urls derives LIFERAY_API_URL from
    // TARGET_URL, and this must read it rather than restate the value.
    expect(source).toMatch(/python3 - "\$staged" "\$LIFERAY_API_URL"/);
  });

  it('is actually called, before the container is started', () => {
    // Every case above drives the function directly, so all of them pass with
    // the call deleted - the exact miss #1088 shipped with. Counted, because
    // the definition matches the name too.
    const mentions =
      source.match(/inject_liferay_url_into_microservice/g) || [];

    expect(mentions.length).toBeGreaterThanOrEqual(2);

    const calledAt = source.lastIndexOf('inject_liferay_url_into_microservice');
    const runAt = source.indexOf('RUN_ARGS=(');

    expect(calledAt).toBeLessThan(runAt);
  });

  it('does not set the pair LDM says are its own', () => {
    // COM_LIFERAY_LXC_DXP_* are blacklisted from forwarding because LDM owns
    // them. Declaring them here would win the argument by going round it.
    const { env } = inject();

    expect(Object.keys(env)).not.toContain('COM_LIFERAY_LXC_DXP_MAIN_DOMAIN');
    expect(Object.keys(env)).not.toContain(
      'COM_LIFERAY_LXC_DXP_SERVER_PROTOCOL'
    );
  });
});

describe('it never breaks a run it cannot help', () => {
  it('says so when no microservice archive is staged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcp-none-'));

    fs.mkdirSync(path.join(dir, 'proj', 'osgi', 'client-extensions'), {
      recursive: true,
    });

    const stdout = execFileSync(
      'bash',
      [
        '-c',
        `${functionSource('inject_liferay_url_into_microservice')}\ninject_liferay_url_into_microservice; echo "rc=$?"`,
      ],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          PROJECT_NAME: 'proj',
          LIFERAY_API_URL: 'https://x',
        },
      }
    );

    expect(stdout).toMatch(/No staged microservice client extension/);
    expect(stdout).toMatch(/rc=0/);
  });

  it('is a no-op on an archive with no manifest', () => {
    const { stdout } = inject({ withManifest: false });

    expect(stdout).toMatch(/has no LCP\.json/);
  });
});
