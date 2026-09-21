const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Anything addressing a container must follow the target.
 *
 * `ldm_cmd` appends `--node`, so LDM's own calls reach the compute node. Nine
 * raw `docker` calls did not, and every one was written to tolerate failure -
 * so on a remote target they addressed this host's daemon, found nothing, and
 * said nothing (#1089).
 *
 * The microservice port lookup was the worst of them. When `docker port`
 * returned nothing it fell back to `find_free_port`, which succeeds *because*
 * nothing is listening, and that invented port became AICA_MICROSERVICE_URL
 * and Liferay's batch callback - announced as resolved.
 *
 * It also asked for the wrong container entirely; see #1099 and
 * microservicePortSource.test.cjs. This file guards the routing and the
 * refusal to invent, not which container is named.
 *
 * These drive the extracted functions with a recording `docker`/`ssh`, so the
 * guard cannot drift from what ships.
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

function functionSource(...names) {
  const lines = source.split('\n');
  const out = [];

  for (const name of names) {
    const start = lines.findIndex((l) => l.startsWith(`${name}() {`));

    if (start === -1) throw new Error(`${name}() not found`);

    const end = lines.findIndex((l, i) => i > start && l === '}');

    out.push(lines.slice(start, end + 1).join('\n'));
  }
  return out.join('\n\n');
}

function runRouting({ node, ldmrc, dockerHost }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dockerhost-'));

  if (ldmrc !== undefined) {
    fs.writeFileSync(path.join(dir, '.ldmrc'), JSON.stringify(ldmrc));
  }

  const script = [
    'set -u',
    functionSource('node_ssh_endpoint', 'route_docker_to_node'),
    'route_docker_to_node; echo "rc=$?"',
    'echo "DOCKER_HOST=${DOCKER_HOST:-<unset>}"',
  ].join('\n');

  let stdout;
  try {
    stdout = execFileSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        LDM_NODE_TARGET: node,
        ...(dockerHost === undefined ? {} : { DOCKER_HOST: dockerHost }),
      },
    });
  } catch (e) {
    stdout = `${e.stdout || ''}${e.stderr || ''}`;
  }
  return stdout;
}

const LDMRC = {
  targets: { 'aws-2': { host: '203.0.113.9', user: 'ldm-automation' } },
};

describe('docker follows the target', () => {
  it('routes every docker call to the node, not this host', () => {
    // One place, because the alternative is annotating nine call sites and
    // missing the tenth.
    expect(runRouting({ node: 'aws-2', ldmrc: LDMRC })).toContain(
      'DOCKER_HOST=ssh://ldm-automation@203.0.113.9'
    );
  });

  it('leaves a local target on the local daemon', () => {
    const out = runRouting({ node: 'local', ldmrc: LDMRC });

    expect(out).toContain('DOCKER_HOST=<unset>');
    expect(out).toContain('rc=0');
  });

  it('does not override a DOCKER_HOST the caller already set', () => {
    expect(
      runRouting({
        node: 'aws-2',
        ldmrc: LDMRC,
        dockerHost: 'ssh://someone@elsewhere',
      })
    ).toContain('DOCKER_HOST=ssh://someone@elsewhere');
  });

  it('stops the run when no address was recorded', () => {
    // Continuing would silently address this host for the whole run.
    const out = runRouting({ node: 'aws-2', ldmrc: undefined });

    expect(out).toMatch(/No SSH endpoint recorded/);
    expect(out).toContain('rc=1');
  });

  it('is invoked before the first docker call', () => {
    // The routing has to be in force by the time anything addresses a
    // container; after it, the earlier calls still hit the wrong daemon.
    const invoked = source.indexOf('if ! route_docker_to_node');
    const firstDocker = source.search(
      /^\s*(?:\w+=\$\()?docker (?:port|rm|exec)/m
    );

    expect(invoked).toBeGreaterThan(-1);
    expect(invoked).toBeLessThan(firstDocker);
  });
});

// The three cases that lived here asserted the microservice port lookup, the
// forward for it, and its teardown. None of those exist any more: the port was
// never published by anything, so the address was wrong in kind rather than in
// value, and the machinery is deleted (#1101). Their intent - never invent an
// address, never point a consumer at nothing - is asserted more directly in
// microservicePortSource.test.cjs, against the proxy URL that does work.
//
// Removed rather than loosened. A case kept alive by relaxing it until it
// passes is worse than no case.

describe('the ldm wrapper is defined before anything calls it', () => {
  it('precedes its first caller', () => {
    // It was defined below the stale-project cleanup, so that call reached the
    // raw binary rather than the python3.13 shim - silently, because it
    // discards its output.
    const defined = source.indexOf('\nldm() {');
    const firstCall = source.search(/^\s*ldm (?!rm <)[a-z]/m);

    expect(defined).toBeGreaterThan(-1);
    expect(defined).toBeLessThan(firstCall);
  });
});
